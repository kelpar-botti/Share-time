package app.sharetime.companion;

/** Run with plain JDK 17+; does not substitute for an Android build or device test. */
public final class ConversationRulesTest {
    private static int checks;
    private static void check(boolean value, String explanation) {
        checks++;
        if (!value) throw new AssertionError(explanation);
    }

    public static void main(String[] args) {
        for (String text : new String[]{"20日の14時でOKです", "了解！", "そうしよう", "いいよー", "変更したい", "行けるよ", "yes!", "中止になりました",
                "わかった", "分かりました", "賛成です", "その日でお願い"}) {
            check(ConversationRules.shouldAnalyze(text), "Expected context trigger: " + text);
        }
        for (String text : new String[]{"20日の14時はどう？", "今日の写真", "look at this book", "yesterday", ""}) {
            check(!ConversationRules.shouldAnalyze(text), "Unexpected context trigger: " + text);
        }
        check(ConversationRules.dates("2028-02-29, 2028-03-01、2028-02-29").size() == 2, "Unique valid dates");
        for (String invalid : new String[]{"2026-02-29", "2026-13-01", "2026-2-3", "tomorrow", ""}) {
            boolean rejected = false;
            try { ConversationRules.dates(invalid); } catch (RuntimeException expected) { rejected = true; }
            check(rejected, "Must reject invalid date: " + invalid);
        }
        check(ConversationRules.digest("line:thread1").length() == 64, "Hashed conversation identity");
        check(!ConversationRules.digest("line:thread1").equals(ConversationRules.digest("discord:thread1")), "Separate apps");
        check(!ConversationRules.digest("line:group1").equals(ConversationRules.digest("line:group2")), "Separate groups");
        String snapshot = ConversationRules.notificationIdentity("line", 0, null, "reused-slot", 1000);
        check(!snapshot.equals(ConversationRules.notificationIdentity("line", 0, null, "reused-slot", 1001)),
                "Reusable notification slots cannot merge different posted snapshots");
        check(snapshot.equals(ConversationRules.notificationIdentity("line", 0, null, "reused-slot", 1000)),
                "Replay of one snapshot retains stable message IDs");
        check(!snapshot.equals(ConversationRules.notificationIdentity("line", 10, null, "reused-slot", 1000)),
                "Work and personal profiles remain separate");
        check(ConversationRules.notificationIdentity("line", 0, "chat-A", "slot1", 1000)
                .equals(ConversationRules.notificationIdentity("line", 0, "chat-A", "slot2", 2000)),
                "Conversation shortcut retains context across notification updates");
        check(!ConversationRules.notificationIdentity("line", 0, "chat-A", "slot", 1000)
                .equals(ConversationRules.notificationIdentity("line", 0, "chat-B", "slot", 1000)),
                "Distinct conversation shortcuts do not share context");
        check(ConversationRules.retryDelay("120", 0) == 120_000L, "Respect Retry-After seconds");
        check(ConversationRules.retryDelay("Thu, 15 Oct 2026 12:02:00 GMT",
                        java.time.Instant.parse("2026-10-15T12:00:00Z").toEpochMilli()) == 120_000L,
                "Respect Retry-After HTTP date");
        check(ConversationRules.retryDelay("0", 0) == 60_000L, "Avoid rapid retries");
        check(ConversationRules.retryDelay("9223372036854775807", 0) == 3_600_000L, "Bound overflowing retry values");
        check(ConversationRules.retryDelay("invalid", 0) == 60_000L, "Malformed retry header has safe fallback");
        check(ConversationRules.limit("a".repeat(1600)).length() == 1500, "Per-message server bound");
        String emojiBoundary = "a".repeat(1499) + "😀";
        check(ConversationRules.limit(emojiBoundary).length() == 1499, "Never truncate a surrogate pair");
        check(ConversationRules.timestamp("2026-10-15T12:00:00+09:00").equals("2026-10-15T03:00:00Z"), "Normalize UTC reference time");
        check(ConversationRules.timestamp("2026-10-16 18:00").equals("2026-10-16T09:00:00Z"),
                "Manual conversation reference time uses Japan time");
        boolean invalidLocalTime = false;
        try { ConversationRules.timestamp("2026-02-30 18:00"); }
        catch (RuntimeException expected) { invalidLocalTime = true; }
        check(invalidLocalTime, "Reject invalid Japan-time calendar date");
        System.out.println("ConversationRules: " + checks + " checks passed (pure Java only)");
    }

}
