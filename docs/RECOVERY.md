# Publication and reminder recovery

Keep source messages in the bot conversation until saving is complete. A repeated `/save` continues the frozen plan and skips successful items. For long journals, Continue Save is expected. A published draft returns its existing link; it never creates a second archive.

## Definite failures

If Telegram rejects a copy with a definite 4xx error, the app records the item as failed, preserves all draft text, and reports its source IDs. Fix permissions or source availability, then retry `/save`. A 429 also records Telegram's requested wait; retry after that interval. Only unfinished operations run. If Telegram cannot copy a deleted/protected/unsupported source, there is no reliable server-side way to recover it; preserve the rest and consult your source chat/export. The app never marks an omitted original as successfully archived.

## Uncertain outcomes

A timeout, connection failure, 5xx response, database failure after an external success, or a partial nonempty `copyMessages` response may mean some content was posted. The app stops. `/save` does not resend that item. Use `/status` to identify its ID, source IDs, and returned destination IDs. The warning may show `[]` if Telegram's response never arrived; that does **not** prove nothing was posted.

Inspect the channel in Telegram Desktop or another Telegram client and compare originals. Copy Message Link gives a destination message ID as the final number in `https://t.me/c/CHANNEL/DESTINATION`. Links work only for accounts with channel access. Never guess destination IDs. Owner reconciliation is an assertion based on your inspection; Bot API cannot fetch arbitrary channel history to verify it automatically.

If **all** sources in item 12 were posted, confirm all destination IDs in source order:

```text
/recover 12 801,802,803
/save
```

For a heading/story/reflection item, supply its one destination ID. This retains the completed result and continues missing operations.

If only source 102 and 104 were copied to 801 and 802, while source 103 is missing, map the confirmed copies:

```text
/recover 12 map:102=801,104=802
/save
```

The app requires every returned destination ID to be mapped once. It records those sources as done and creates a pending item containing only missing source IDs. This avoids copying confirmed originals again. Missing copies are appended after existing posts, so physical order and album grouping may change. If preserving exact visual order is more important, use the next option instead.

If a partial batch cannot be reconciled, first **manually remove all channel messages created by that uncertain item**, including any whose response was lost. Leave other completed items alone. Only after inspecting/cleaning the channel:

```text
/recover 12 retry
/save
```

`retry` is explicit owner permission to retry this item and accepts duplicate risk. The bot does not delete channel posts for you and does not infer that no content exists. Do not use retry before checking. This is also the way to recopy a whole album after cleaning its partial copies. It cannot reconstruct a source deleted from Telegram.

## Interrupted preparation

If `/status` shows preparing after an interrupted request, `/done` prepares again under the owner lock. Continue Writing reopens collection. Attempts already sent to Gemini remain counted even if their response was lost. AI failure always permits an original preview. An invalid/oversized source edit blocks preparation until that source is restored/shortened; old approval cannot save it.

## Reminders

One reminder is tracked per Manila date. Delivered reminders and active sends are never automatically resent. A stale sending row becomes uncertain; cron leaves uncertain results alone. After checking the reminder was not delivered, `/reminder` explicitly retries today's failed/uncertain delivery. It skips a saved day. A delivered reminder is never resent even through that command. The command can also send an initial test reminder before the usual time, which consumes that day's reminder slot.

Cron does not provide a guaranteed automatic retry after a provider outage or owner-lock collision. Check your chat/dashboard and use the owner command after inspection. Delivery times are best effort.

## Database loss or restore

Never restore D1 simply to retry a failed save. Restoring an older snapshot can forget already posted channel items and update/reminder claims. Worker code rollback does not roll back D1 or Telegram. If D1 must be restored after corruption, pause use, preserve the current database where possible, inspect the channel, and manually reconcile publication metadata before resuming. This is an operator recovery task, not an automated exactly-once guarantee. Telegram remains the canonical archive, but its Bot API cannot rebuild arbitrary history automatically.
