# AI and command workflow repair

November 14, 2026. Deployed Worker version: `002fc2be-30c6-478f-b62f-389da6d6567a`.

The production webhook had no delivery errors or pending updates. All recorded owner updates were complete, no owner lock was held, and no AI attempt had been recorded. AI consent was off. The selected draft was today's already-published entry, so `/journal` selected a closed entry and `/done` could not prepare another journal. Separately, an original preview prepared before consent was cached even after enabling AI. Gemini itself passed a fresh live synthetic English check with the existing key/model.

The repair keeps saved archives immutable and allows a fresh draft for the same date. Migration `0003_followup_entries.sql` only replaces the daily uniqueness index: there can be one unfinished draft per owner/date, alongside earlier completed entries. `/today` selects the latest completed save; `/history` keeps links to earlier saves. Starting or cancelling a draft never rewrites an archive.

The original-preview screen and settings now explain when AI is off and offer an Enable AI button. Consent still requires the owner's confirmation. `/done` prepares a fresh AI preview when consent was enabled after an original preview; an existing current AI preview remains reusable without another request. AI preparation sends a progress reply. Regeneration, revision, original fallback, attempt limits, review and explicit save remain available.

The owner-scoped Telegram menu now contains 19 commands, including `/ai_on`, `/preview`, `/regenerate` and `/continue`. `/date` and `/revise` sent alone explain their required arguments. Commands tolerate surrounding whitespace and capitalization. Unrecognized slash commands are not stored as journal text. Original note spacing is preserved. `npm run setup:commands` refreshes and verifies the menu without altering the webhook.

Verification:

- `npm run check`: TypeScript passed and all 44 Node/SQLite tests passed.
- `npm run test:runtime`: both workerd/D1 integration tests passed, including two saves on one date and original-preview to consent to AI-preview to approval with photo/video references.
- A fresh live synthetic English Gemini check passed; no personal journal notes were sent for this check.
- The remote migration and existing Worker deployment succeeded. Gemini model, secrets, D1 binding and daily reminder cron were retained.
- The 19-command menu and menu button were verified through Telegram. Live owner-chat command checks returned HTTP 200, including standalone `/date`, `/revise`, `/journal`, `/settings` and `/ai_on` after deployment.
- The live `/journal` check starts an empty follow-up draft. The `/ai_on` check presents the confirmation notice; it does not enable consent or publish content.

The owner still needs to tap the current AI confirmation button before personal text can be processed. No test journal was published into the private archive.
