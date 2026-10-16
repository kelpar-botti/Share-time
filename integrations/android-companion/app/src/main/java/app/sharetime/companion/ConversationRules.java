package app.sharetime.companion;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.time.format.DateTimeFormatter;
import java.time.format.DateTimeParseException;
import java.time.format.ResolverStyle;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.regex.Pattern;

/** Pure Java rules; these only decide when to ask the server, never whether to block a day. */
final class ConversationRules {
    static final int MAX_MESSAGES = 80;
    static final long RETENTION_MS = 7L * 24 * 60 * 60 * 1000;
    static final int MAX_TEXT = 1500;
    private static final Pattern CUE = Pattern.compile(
            "(?iu)(?:(?<![a-z])(?:ok(?:ay)?|yes|sure|agreed|cancel(?:led)?|reschedule)(?![a-z])|"
            + "了解|りょうかい|オッケ|おっけ|おけ|承知|わかった|わかりました|分かった|分かりました|賛成|"
            + "その(?:日|時間|日程|予定|日時)でお願い|それで|それにし|じゃあ|では.{0,12}(?:で|に)|"
            + "決まり|確定|決定|大丈夫|だいじょうぶ|行ける|いける|いいよ|いいね|いいです|そうしよう|"
            + "行こう|いこう|行きましょう|いきましょう|よろしく|楽しみ|予約した|"
            + "変更|中止|キャンセル|延期|やめよう|無し|なしに|無理にな|都合.*悪)");

    static boolean shouldAnalyze(String text) {
        return text != null && CUE.matcher(text).find();
    }

    static String notificationIdentity(String source, int profile, String shortcut,
                                       String notificationKey, long postTime) {
        String identity = shortcut != null && !shortcut.trim().isEmpty()
                ? "shortcut:" + shortcut
                : "snapshot:" + notificationKey + ":" + postTime;
        return digest(source + ":profile:" + profile + ":" + identity);
    }

    static long retryDelay(String value, long now) {
        long delay = 60_000L;
        if (value != null) {
            try { delay = Math.multiplyExact(Long.parseLong(value.trim()), 1000L); }
            catch (ArithmeticException overflow) { delay = 60 * 60_000L; }
            catch (NumberFormatException ignored) {
                try {
                    delay = ZonedDateTime.parse(value.trim(), DateTimeFormatter.RFC_1123_DATE_TIME)
                            .toInstant().toEpochMilli() - now;
                } catch (RuntimeException invalidHeader) { /* Use a one-minute fallback. */ }
            }
        }
        return Math.max(60_000L, Math.min(60 * 60_000L, delay));
    }

    static String digest(String value) {
        try {
            byte[] bytes = MessageDigest.getInstance("SHA-256")
                    .digest(value.getBytes(StandardCharsets.UTF_8));
            StringBuilder result = new StringBuilder();
            for (byte item : bytes) result.append(String.format(Locale.ROOT, "%02x", item & 255));
            return result.toString();
        } catch (Exception impossible) { throw new IllegalStateException(impossible); }
    }

    static String limit(String text) {
        if (text.length() <= MAX_TEXT) return text;
        int end = Character.isHighSurrogate(text.charAt(MAX_TEXT - 1)) ? MAX_TEXT - 1 : MAX_TEXT;
        return text.substring(0, end);
    }

    static List<String> dates(String value) {
        LinkedHashSet<String> result = new LinkedHashSet<>();
        for (String item : value.split("[\\s,、]+")) {
            if (item.isEmpty()) continue;
            if (!item.matches("\\d{4}-\\d{2}-\\d{2}")) throw new IllegalArgumentException();
            String normalized = LocalDate.parse(item).toString();
            result.add(normalized);
        }
        if (result.isEmpty() || result.size() > 31) throw new IllegalArgumentException();
        return new ArrayList<>(result);
    }

    static String timestamp(String value) {
        try {
            return LocalDateTime.parse(value.trim(), localTimeFormat())
                    .atZone(ZoneId.of("Asia/Tokyo")).toInstant().toString();
        } catch (DateTimeParseException legacyInput) {
            return Instant.parse(value.trim()).toString();
        }
    }

    static String localTimestamp() {
        return LocalDateTime.now(ZoneId.of("Asia/Tokyo")).format(localTimeFormat());
    }

    private static DateTimeFormatter localTimeFormat() {
        return DateTimeFormatter.ofPattern("uuuu-MM-dd HH:mm", Locale.ROOT)
                .withResolverStyle(ResolverStyle.STRICT);
    }
}
