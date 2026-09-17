import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

// Run the actual data functions, server actions and public pages against an
// isolated in-memory Firestore substitute. Never connect to the real database.
function setup() {
  const records = new Map();
  const cache = new Map();
  const revalidated = [];
  let signedIn = true;
  let sequence = 0;
  const snapshot = id => ({ id, exists: records.has(id), data: () => records.get(id) });
  const doc = (id = `test-${++sequence}`) => ({
    id,
    get: async () => snapshot(id),
    set: async value => records.set(id, { ...value }),
    update: async value => records.set(id, { ...records.get(id), ...value }),
  });
  const query = (filters = []) => ({
    doc,
    where: (field, operator, value) => query([...filters, [field, operator, value]]),
    get: async () => ({ docs: [...records.keys()].filter(id => filters.every(([field, operator, value]) => {
      const actual = records.get(id)[field];
      return operator === "==" ? actual === value : operator === ">=" ? actual >= value : actual <= value;
    })).map(snapshot) }),
  });
  const db = {
    collection: () => query(),
    runTransaction: async callback => {
      const changes = [];
      await callback({ get: ref => ref.get(), update: (ref, value) => changes.push([ref, value]) });
      for (const [ref, value] of changes) await ref.update(value);
    },
  };
  const stubs = {
    "server-only": {},
    "@/auth": { auth: async () => signedIn ? { user: { email: "admin@example.test" } } : null },
    "next/navigation": { redirect: url => { throw new Error(`REDIRECT:${url}`); } },
    "next/cache": { revalidatePath: value => revalidated.push(value) },
    "next/link": ({ children, ...props }) => React.createElement("a", props, children),
  };
  const nodeRequire = createRequire(import.meta.url);
  const root = fileURLToPath(new URL("../", import.meta.url));
  function load(filename) {
    if (cache.has(filename)) return cache.get(filename).exports;
    if (filename.endsWith("firebase-admin.ts")) return { getDb: () => db };
    if (filename.endsWith("mailer.ts")) throw new Error("Owner schedules must not send email");
    const loadedModule = { exports: {} };
    cache.set(filename, loadedModule);
    const output = ts.transpileModule(readFileSync(filename, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
      fileName: filename,
    }).outputText;
    const imports = id => {
      if (id in stubs) return stubs[id];
      if (id.endsWith("/mailer") || id === "./mailer") return new Proxy({}, { get: () => async () => { throw new Error("Unexpected email"); } });
      if (id.startsWith(".") || id.startsWith("@/")) {
        const base = id.startsWith("@/") ? path.join(root, "src", id.slice(2)) : path.resolve(path.dirname(filename), id);
        return load(base + (base.includes(`${path.sep}app${path.sep}`) || base.includes(`${path.sep}components${path.sep}`) ? ".tsx" : ".ts"));
      }
      return nodeRequire(id);
    };
    vm.runInNewContext(`(function(require, module, exports) { ${output}\n})`, {
      Date, FormData, console, process: { env: { ADMIN_EMAIL: "admin@example.test" } },
    }, { filename })(imports, loadedModule, loadedModule.exports);
    return loadedModule.exports;
  }
  return {
    records, revalidated,
    bookings: load(path.join(root, "src/lib/bookings.ts")),
    actions: load(path.join(root, "src/lib/actions.ts")),
    date: load(path.join(root, "src/lib/date.ts")),
    renderDay: async date => renderToStaticMarkup(await load(path.join(root, "src/app/day/page.tsx")).default({ searchParams: Promise.resolve({ date }) })),
    renderBook: async date => renderToStaticMarkup(await load(path.join(root, "src/app/book/page.tsx")).default({ searchParams: Promise.resolve({ date }) })),
    signOut: () => { signedIn = false; },
  };
}

test("owner titles default to private; publishing and hiding control both public pages", async () => {
  const env = setup();
  const booking = await env.bookings.createOwnerBlock({ date: "2026-10-01", startTime: "10:00", endTime: "11:00", label: "PRIVATE_OWNER_TITLE" });
  assert.equal(booking.titlePublic, false);
  assert.doesNotMatch(await env.renderDay(booking.date), /PRIVATE_OWNER_TITLE/);
  assert.doesNotMatch(await env.renderBook(booking.date), /PRIVATE_OWNER_TITLE/);
  await env.actions.updateOwnerTitleVisibility(booking.id, true);
  assert.match(await env.renderDay(booking.date), /PRIVATE_OWNER_TITLE/);
  assert.match(await env.renderBook(booking.date), /PRIVATE_OWNER_TITLE/);
  await env.actions.updateOwnerTitleVisibility(booking.id, false);
  assert.doesNotMatch(await env.renderDay(booking.date), /PRIVATE_OWNER_TITLE/);
  assert.ok(env.revalidated.includes("/day"));
});

test("legacy labels stay private until the owner explicitly publishes them", async () => {
  const env = setup();
  env.records.set("legacy", { source: "owner", status: "approved", date: "2026-10-01", startTime: "10:00", endTime: "11:00", name: "LEGACY_PRIVATE", title: "" });
  assert.doesNotMatch(await env.renderDay("2026-10-01"), /LEGACY_PRIVATE/);
  await env.actions.updateOwnerTitleVisibility("legacy", true);
  assert.match(await env.renderDay("2026-10-01"), /LEGACY_PRIVATE/);
});

test("owner publication cannot change visitor consent, cancelled or missing schedules", async () => {
  const env = setup();
  for (const [id, data] of [["visitor", { source: "visitor", status: "approved" }], ["old-visitor", { status: "approved" }], ["cancelled", { source: "owner", status: "cancelled" }]]) {
    env.records.set(id, { ...data, title: "PRIVATE", titlePublicAllowed: false, titlePublic: false });
    await assert.rejects(env.actions.updateOwnerTitleVisibility(id, true));
    assert.equal(env.records.get(id).titlePublicAllowed, false);
  }
  await assert.rejects(env.actions.updateOwnerTitleVisibility("missing", true));
});

test("signed-out requests cannot publish an owner title", async () => {
  const env = setup();
  const booking = await env.bookings.createOwnerBlock({ date: "2026-10-01", startTime: "10:00", endTime: "11:00", label: "PRIVATE" });
  env.signOut();
  await assert.rejects(env.actions.updateOwnerTitleVisibility(booking.id, true), /管理者/);
  assert.equal(env.records.get(booking.id).titlePublic, false);
});

test("bulk registration carries publication choice to every selected date", async () => {
  for (const visible of [false, true]) {
    const env = setup();
    const date = env.date.addDays(env.date.todayInJapan(), 1);
    const form = new FormData();
    for (const [key, value] of Object.entries({ month: date.slice(0, 7), startTime: "22:00", endTime: "02:00", label: "OWNER_EVENT" })) form.set(key, value);
    if (visible) form.set("titlePublic", "on");
    form.append("dates", date);
    form.append("dates", env.date.addDays(date, 2));
    await assert.rejects(env.actions.createOwnerScheduleBlocks(form), /REDIRECT:.*created=2/);
    assert.equal(env.records.size, 2);
    for (const record of env.records.values()) assert.equal(record.titlePublic, visible);
    const nextDay = await env.renderDay(env.date.addDays(date, 1));
    assert.equal(nextDay.includes("OWNER_EVENT"), visible);
  }
});

test("public titles require a name and enforce the server-side length limit", async () => {
  for (const label of ["", " ", "x".repeat(101)]) {
    const env = setup();
    const form = new FormData();
    form.set("titlePublic", "on");
    form.set("label", label);
    await assert.rejects(env.actions.createOwnerScheduleBlocks(form), /error=title/);
    assert.equal(env.records.size, 0);
  }
});
