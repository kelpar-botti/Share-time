/**
 * ShareTime shift notifications. Gmail is accessed with gmail.readonly only.
 * Configure Script Properties, run previewLatest(), then run setup() yourself.
 * Never put passwords or tokens in this source file.
 * Manifest enables Gmail API for the default Apps Script Cloud project;
 * a standard Cloud project requires manually enabling Gmail API as well.
 */
var SHARE_TIME_SYNC_HANDLER = 'syncConfirmedShifts';
var SHARE_TIME_SYNC_ENDPOINT = 'https://share-time-lyart.vercel.app/api/integrations/jobcan';
var SHARE_TIME_DONE_PREFIX = 'SHARE_TIME_DONE_';
var SHARE_TIME_MAIL_QUERY = 'from:noreply@donuts.ne.jp subject:シフト確定 newer_than:45d -in:spam -in:trash';

/** Install exactly one five-minute trigger; preserve all unrelated triggers. */
function setup() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) throw safeFailure_('SETUP_BUSY');
  try {
    readConfiguration_();
    ScriptApp.getProjectTriggers().forEach(function(trigger) {
      if (trigger.getHandlerFunction() === SHARE_TIME_SYNC_HANDLER) ScriptApp.deleteTrigger(trigger);
    });
    ScriptApp.newTrigger(SHARE_TIME_SYNC_HANDLER).timeBased().everyMinutes(5).create();
    var result = { ok: true, intervalMinutes: 5 };
    console.log(JSON.stringify(result));
    return result;
  } catch (error) {
    throw sanitizedFailure_(error);
  } finally {
    lock.releaseLock();
  }
}

/** Disable only this integration's triggers. Previously processed IDs are retained. */
function stop() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) throw safeFailure_('STOP_BUSY');
  try {
    ScriptApp.getProjectTriggers().forEach(function(trigger) {
      if (trigger.getHandlerFunction() === SHARE_TIME_SYNC_HANDLER) ScriptApp.deleteTrigger(trigger);
    });
    var result = { ok: true, stopped: true };
    console.log(JSON.stringify(result));
    return result;
  } catch (error) {
    throw sanitizedFailure_(error);
  } finally {
    lock.releaseLock();
  }
}

/** Log successful counts for the execution screen. Failures are retried next run. */
function syncConfirmedShifts() {
  var result = runNotifications_(false);
  if (result.ok === true && !result.skipped) console.log(JSON.stringify(result));
  return result;
}

/** Read and preview the latest confirmation for each relevant month without saving. */
function previewLatest() {
  var result = runNotifications_(true);
  if (result.ok === true && !result.skipped) console.log(JSON.stringify(safePreviewLog_(result)));
  return result;
}

/** Log only known preview fields; never copy arbitrary API fields or diagnostics. */
function safePreviewLog_(result) {
  return { ok: true, dryRun: true, results: result.results.map(function(entry) {
    var source = entry.result;
    var preview = { ok: true, dryRun: true, persisted: false, month: entry.notification.month };
    if (typeof source.skipped === 'boolean') preview.skipped = source.skipped;
    if (['already_processed', 'stale_notification', 'old_month', 'unchanged'].indexOf(source.reason) !== -1) {
      preview.reason = source.reason;
    }
    ['created', 'updated', 'cancelled', 'unchanged', 'skippedPast', 'conflicts'].forEach(function(key) {
      if (typeof source[key] === 'number' && isFinite(source[key]) && source[key] >= 0) preview[key] = source[key];
    });
    if (Array.isArray(source.shifts)) {
      preview.shifts = source.shifts.map(function(shift) {
        if (!shift || !/^\d{4}-\d{2}-\d{2}$/.test(shift.date || '') ||
            !/^([01]\d|2[0-3]):[0-5]\d$/.test(shift.startTime || '') ||
            !/^([01]\d|2[0-3]):[0-5]\d$/.test(shift.endTime || '')) return null;
        return { date: shift.date, startTime: shift.startTime, endTime: shift.endTime };
      }).filter(function(shift) { return shift !== null; });
    }
    var notification = entry.notification;
    return { notification: {
      id: notification.id, sentAt: notification.sentAt, receivedAt: notification.receivedAt,
      subject: notification.subject, month: notification.month,
    }, result: preview };
  }) };
}

function runNotifications_(dryRun) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return { ok: true, skipped: 'busy', processed: 0 };
  try {
    var config = readConfiguration_();
    var properties = PropertiesService.getScriptProperties();
    var now = new Date();
    var notifications = latestNotifications_(now);
    var results = [];
    var processed = 0;
    notifications.forEach(function(notification) {
      var key = SHARE_TIME_DONE_PREFIX + notification.id;
      if (!dryRun && properties.getProperty(key)) return;
      var result = postNotification_(config, notification, dryRun);
      if (!dryRun) {
        // HTTP 200, a dry-run response or a config error is never sufficient.
        properties.setProperty(key, now.toISOString());
        processed += 1;
      } else {
        results.push({ notification: notification, result: result });
      }
    });
    if (!dryRun) pruneProcessed_(properties, now);
    return dryRun ? { ok: true, dryRun: true, results: results } : { ok: true, processed: processed };
  } catch (error) {
    // Never copy fetch exceptions, server bodies, email headers or tokens into logs.
    throw sanitizedFailure_(error);
  } finally {
    lock.releaseLock();
  }
}

function readConfiguration_() {
  var properties = PropertiesService.getScriptProperties();
  var url = (properties.getProperty('SHARE_TIME_SYNC_URL') || '').trim().replace(/\/$/, '');
  var token = properties.getProperty('SHARE_TIME_SYNC_TOKEN') || '';
  // The bearer token may only go to the known ShareTime endpoint, without redirects.
  if (url !== SHARE_TIME_SYNC_ENDPOINT) throw safeFailure_('INVALID_SYNC_URL');
  if (token.length < 32 || token.length > 256 || /\s/.test(token)) throw safeFailure_('INVALID_SYNC_TOKEN');
  return { url: url, token: token };
}

function latestNotifications_(now) {
  var oauthToken = ScriptApp.getOAuthToken();
  var base = 'https://gmail.googleapis.com/gmail/v1/users/me/messages';
  var listed = gmailGet_(base + '?maxResults=50&includeSpamTrash=false&q=' + encodeURIComponent(SHARE_TIME_MAIL_QUERY), oauthToken);
  if (listed.messages !== undefined && !Array.isArray(listed.messages)) throw safeFailure_('INVALID_GMAIL_RESPONSE');
  // Bound the scan even if an unexpected server/mock response exceeds maxResults.
  var references = (listed.messages || []).slice(0, 50);
  var latest = {};
  references.forEach(function(reference) {
    if (!reference || !/^[a-zA-Z0-9_-]{1,128}$/.test(reference.id || '')) throw safeFailure_('INVALID_GMAIL_MESSAGE_ID');
    var metadataUrl = base + '/' + encodeURIComponent(reference.id) +
      '?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date&fields=id,internalDate,payload%2Fheaders';
    var message = gmailGet_(metadataUrl, oauthToken);
    var notification = classifyMetadata_(message, now);
    if (!notification) return;
    var previous = latest[notification.month];
    if (!previous || notification.receivedAt > previous.receivedAt ||
        (notification.receivedAt === previous.receivedAt && notification.id > previous.id)) {
      latest[notification.month] = notification;
    }
  });
  return Object.keys(latest).sort().map(function(month) { return latest[month]; });
}

function gmailGet_(url, oauthToken) {
  var response;
  try {
    response = UrlFetchApp.fetch(url, {
      method: 'get', headers: { Authorization: 'Bearer ' + oauthToken },
      muteHttpExceptions: true, followRedirects: false, validateHttpsCertificates: true,
    });
  } catch (error) {
    throw safeFailure_('GMAIL_NETWORK_ERROR');
  }
  if (response.getResponseCode() !== 200) throw safeFailure_('GMAIL_HTTP_' + response.getResponseCode());
  var parsed = parseJson_(response, 'INVALID_GMAIL_JSON');
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw safeFailure_('INVALID_GMAIL_RESPONSE');
  return parsed;
}

function classifyMetadata_(message, now) {
  if (!message || !/^[a-zA-Z0-9_-]{1,128}$/.test(message.id || '')) return null;
  var headers = message.payload && message.payload.headers;
  if (!Array.isArray(headers)) return null;
  var relevant = {};
  var duplicates = false;
  headers.forEach(function(header) {
    var name = String(header.name || '').toLowerCase();
    if (name !== 'from' && name !== 'subject' && name !== 'date') return;
    if (Object.prototype.hasOwnProperty.call(relevant, name)) duplicates = true;
    relevant[name] = String(header.value || '').trim();
  });
  if (duplicates || !isExactSender_(relevant.from)) return null;
  var subject = decodeSubjectHeader_(relevant.subject || '');
  var validSubject = /^来月シフト確定のお知らせ(?:\s+じゃんぱら|\s*\(じゃんぱら\)|\s*（じゃんぱら）|\s*【じゃんぱら】|\s*\[じゃんぱら\])?$/;
  if (!validSubject.test(subject)) return null;
  // A Date without an explicit offset is timezone-dependent and is rejected.
  if (!/(?:[+-]\d{4}|GMT|UT|UTC)(?:\s+\([^)]*\))?\s*$/i.test(relevant.date || '')) return null;
  var sent = new Date(relevant.date);
  if (!isFinite(sent.getTime())) return null;
  var parts = Utilities.formatDate(sent, 'Asia/Tokyo', 'yyyy-MM').split('-').map(Number);
  var nextYear = parts[0] + (parts[1] === 12 ? 1 : 0);
  var nextMonth = parts[1] === 12 ? 1 : parts[1] + 1;
  var month = nextYear + '-' + ('0' + nextMonth).slice(-2);
  var current = Utilities.formatDate(now, 'Asia/Tokyo', 'yyyy-MM');
  var maximum = Utilities.formatDate(new Date(now.getTime() + 180 * 86400000), 'Asia/Tokyo', 'yyyy-MM');
  if (month < current || month > maximum) return null;
  var internal = /^\d{1,16}$/.test(String(message.internalDate || '')) ? new Date(Number(message.internalDate)) : null;
  var received = internal && isFinite(internal.getTime()) ? internal : sent;
  return { id: message.id, sentAt: sent.toISOString(), receivedAt: received.toISOString(), subject: subject, month: month };
}

function isExactSender_(from) {
  if (typeof from !== 'string') return false;
  if (from.toLowerCase() === 'noreply@donuts.ne.jp') return true;
  var displayAddress = /^(?:"[^"\r\n]*"|[^",<>\r\n]+)\s*<([^<>\s]+)>$/.exec(from);
  return !!displayAddress && displayAddress[1].toLowerCase() === 'noreply@donuts.ne.jp';
}

/** Gmail metadata may retain RFC 2047 encoded words for Japanese Subject headers. */
function decodeSubjectHeader_(value) {
  if (value.length > 4096) return '';
  // Whitespace between adjacent encoded words is not displayed (RFC 2047 6.2).
  var joined = value.replace(/(\?=)[ \t\r\n]+(?==\?)/g, '$1');
  var failed = false;
  var decoded = joined.replace(/=\?([a-zA-Z0-9_-]+)\?([bBqQ])\?([^?\s]+)\?=/g, function(word, charset, encoding, text) {
    if (!/^(utf-8|utf8|iso-2022-jp|shift_jis|shift-jis|us-ascii)$/i.test(charset)) {
      failed = true;
      return '';
    }
    try {
      var bytes;
      if (encoding.toUpperCase() === 'B') {
        if (!/^(?:[a-zA-Z0-9+/]{4})*(?:[a-zA-Z0-9+/]{2}==|[a-zA-Z0-9+/]{3}=)?$/.test(text)) throw new Error();
        bytes = Utilities.base64Decode(text);
      } else {
        bytes = [];
        for (var index = 0; index < text.length; index++) {
          var byte;
          if (text[index] === '=') {
            var hex = text.slice(index + 1, index + 3);
            if (!/^[a-fA-F0-9]{2}$/.test(hex)) throw new Error();
            byte = parseInt(hex, 16);
            index += 2;
          } else {
            byte = text[index] === '_' ? 32 : text.charCodeAt(index);
            if (byte < 33 && byte !== 32 || byte > 126) throw new Error();
          }
          bytes.push(byte > 127 ? byte - 256 : byte);
        }
      }
      return Utilities.newBlob(bytes).getDataAsString(charset);
    } catch (error) {
      failed = true;
      return '';
    }
  });
  return failed ? '' : decoded.trim();
}

function postNotification_(config, notification, dryRun) {
  var payload = { notification: notification };
  if (dryRun) payload.dryRun = true;
  var response;
  try {
    response = UrlFetchApp.fetch(config.url, {
      method: 'post', contentType: 'application/json',
      headers: { Authorization: 'Bearer ' + config.token }, payload: JSON.stringify(payload),
      muteHttpExceptions: true, followRedirects: false, validateHttpsCertificates: true,
    });
  } catch (error) {
    throw safeFailure_('ENDPOINT_NETWORK_ERROR');
  }
  if (response.getResponseCode() !== 200) {
    var safeCode = safeEndpointErrorCode_(response);
    throw safeFailure_('ENDPOINT_HTTP_' + response.getResponseCode() + (safeCode ? '_' + safeCode : ''));
  }
  var result = parseJson_(response, 'INVALID_ENDPOINT_JSON');
  if (!result || result.ok !== true) throw safeFailure_('ENDPOINT_REJECTED');
  if (dryRun) {
    if (result.dryRun !== true || result.persisted !== false) throw safeFailure_('PREVIEW_NOT_CONFIRMED');
  } else if (result.persisted !== true || result.dryRun === true) {
    throw safeFailure_('PERSISTENCE_NOT_CONFIRMED');
  }
  return result;
}

/** Expose fixed server codes in exceptions without its body, message or credentials. */
function safeEndpointErrorCode_(response) {
  var allowed = [
    'JOBCAN_PARSE', 'JOBCAN_LOGIN', 'JOBCAN_INCOMPLETE', 'JOBCAN_NETWORK',
    'JOBCAN_TIMEOUT', 'JOBCAN_CONFIG', 'JOBCAN_IDENTITY',
    'SYNC_BUSY', 'SYNC_LEASE_LOST', 'SYNC_FAILED', 'CONFIG_REQUIRED', 'NOT_ENABLED',
    'INVALID_NOTIFICATION', 'UNAUTHORIZED', 'SERVICE_ONLY', 'BODY_TOO_LARGE',
    'INVALID_JSON', 'METHOD_NOT_ALLOWED',
  ];
  try {
    var parsed = JSON.parse(response.getContentText());
    var code = parsed && parsed.error && parsed.error.code;
    return typeof code === 'string' && /^[A-Z_]{1,40}$/.test(code) && allowed.indexOf(code) !== -1 ? code : '';
  } catch (error) {
    return '';
  }
}

function parseJson_(response, code) {
  try { return JSON.parse(response.getContentText()); } catch (error) { throw safeFailure_(code); }
}

function pruneProcessed_(properties, now) {
  var cutoff = now.getTime() - 180 * 86400000;
  var saved = properties.getProperties();
  Object.keys(saved).forEach(function(key) {
    if (key.indexOf(SHARE_TIME_DONE_PREFIX) !== 0) return;
    var time = new Date(saved[key]).getTime();
    if (!isFinite(time) || time < cutoff) properties.deleteProperty(key);
  });
}

function safeFailure_(code) {
  var error = new Error('ShareTime sync: ' + code);
  error.shareTimeSafe = true;
  return error;
}

function sanitizedFailure_(error) {
  return error && error.shareTimeSafe === true ? error : safeFailure_('UNEXPECTED_ERROR');
}
