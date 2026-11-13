# My Life, One Day at a Time

A private, single-owner Telegram journal: **reminder → write → preview → save**.

TypeScript runs on Cloudflare Workers Free with D1 Free. Telegram stores the permanent originals and media in your private channel. Optional Gemini edits text only, after setup verification and explicit consent. There are no runtime npm dependencies, paid bindings, buckets, subscriptions, or continuously running processes.

**Status:** live on Workers Free with a migrated D1 database and verified Telegram webhook. The owner confirmed bot replies and a saved private-channel link; the first entry contains text and two photos, with temporary text/captions cleared from D1. The deployed cron is verified. Gemini is configured after the owner's Free-tier confirmation and a successful synthetic generation probe; personal-text processing still requires `/ai_on` confirmation. Its setup verification expires December 14, 2026. See [setup progress](docs/SETUP_STATUS.md) and [verification results](docs/VERIFICATION.md). Credentials are kept in the ignored local configuration, not source files.

## What it does

- All requested commands: `/start`, `/help`, `/journal`, `/done`, `/save`, `/cancel`, `/status`, `/history`, `/today`, `/privacy`, `/ai_on`, `/ai_off`, `/settings`, `/id`, and `/date YYYY-MM-DD`.
- Additional `/preview`, `/revise wording request`, `/save original`, `/recover`, and `/reminder` operations.
- Multiple notes, photos, albums, captions, videos, voice, audio, documents, animations, video notes, and stickers, where Telegram permits copying.
- One unfinished or published entry per owner/date; confirmed cancellation allows a fresh draft. `/journal` always selects today's Philippine date. `/date` selects/resumes another day; future dates are rejected.
- Exact original messages copied server-side in source-message order. AI output is a separate, labeled interpretation. Voice is archived without transcription. No media is sent to Google.
- The AI editor detects English, Tagalog/Filipino, or Taglish from the original notes, preserving the source language and casual vocabulary. It produces one factual title and one continuous first-person paragraph, with no separate reflection, question, or summary. See [the editor update and language checks](docs/AI_EDITOR_UPDATE.md).
- Paged previews; saving requires reading through the last page. New notes or delivered edits invalidate the old preview and its buttons.
- New archive layout: journal date, bold title, polished paragraph, then unchanged original messages/media. Long paragraphs continue across Telegram message-size chunks. Legacy unpublished AI previews with the previous format require `/done` again; already-published content and frozen interrupted publication plans are retained.
- Atomic SQL state transitions, update deduplication, a cross-isolate owner lock, revision-bound callbacks, resumable publication, and conservative handling of uncertain external results.
- History links and daily reminders around 7 PM Asia/Manila, even without messages that day.
- Temporary text, captions, AI output, and publication payloads removed from live D1 rows after complete publication. Failed and unfinished drafts remain available.

Not implemented: image analysis, transcription, full-history AI summaries, automated verification of Google project billing, or automated verification that a human can open a private-channel link. These are not prerequisites for original-only journaling.

## Requirements and free-plan boundaries

Use Node.js **22.16+**, npm, a Telegram account, and a Cloudflare account on **Workers Free**. No domain purchase or credit card is needed for this design. Keep Cloudflare on Free and Google billing disabled. The app does not change either provider's plan, attach billing, enable paid broadcasting, or fall back to a paid model. Using a billing-enabled account would invalidate the zero-cost setup assumption.

Official limits reviewed **November 14, 2026**:

| Service | Relevant free allowance / behavior |
| --- | --- |
| Workers | 100,000 requests/day, 10 ms CPU/invocation, 128 MB memory, 50 subrequests/invocation; free limit exhaustion stops service |
| D1 | 5 million rows read/day, 100,000 rows written/day; 500 MB/database, 5 GB/account; queries fail at free limits |
| Telegram | Ordinary Bot API operations used here; paid broadcasts are explicitly blocked |
| Gemini | Optional; only an explicitly verified free API project and reviewed model; quotas depend on actual project/region and can change |

Sources: [Workers limits](https://developers.cloudflare.com/workers/platform/limits/), [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/), [D1 limits](https://developers.cloudflare.com/d1/platform/limits/), [D1 limit behavior](https://developers.cloudflare.com/d1/reference/faq/), [Telegram Bot API](https://core.telegram.org/bots/api), [Gemini pricing](https://ai.google.dev/gemini-api/docs/pricing), and [Gemini billing](https://ai.google.dev/gemini-api/docs/billing).

Publishing performs at most three archive operations per approval/continuation. Large entries take extra taps on Continue Save to stay within Worker limits. Drafts are capped at 500 messages and 48,000 Unicode text characters; AI input at 24,000 UTF-16 text units. There is no unattended large-job worker. Live CPU behavior still needs verification on your actual Free account; local tests do not certify Cloudflare's production CPU budget.

## Setup, in order

These PowerShell commands run from this repository. Never paste tokens into shell arguments, commit messages, issue trackers, or this README. Populate the ignored `.dev.vars` file in your editor. Do not share it.

### 1. Install and validate locally

```powershell
npm ci
npm run check
npm run test:runtime
if (-not (Test-Path -LiteralPath '.dev.vars')) { Copy-Item -LiteralPath '.dev.vars.example' -Destination '.dev.vars' }
```

`npm run check` runs TypeScript and the Node test suite against real SQLite with mocked external APIs. `test:runtime` bundles the Worker and runs it inside local Cloudflare workerd with emulated D1 and all external calls intercepted. Neither needs real credentials. Node 22.16 prints experimental type-stripping/SQLite warnings. The pinned Miniflare development dependency is a beta supplied alongside the pinned Wrangler release; it is not a production service.

### 2. Create your bot and private channel

1. Open **@BotFather** in Telegram, use `/newbot`, and choose a name/username. Store its token only in `TELEGRAM_BOT_TOKEN` in `.dev.vars`. Disable adding the bot to groups through BotFather if desired; application authorization rejects group operations regardless.
2. Open your bot's private conversation and send `/id`. Before deployment it will not respond, but this creates an update for the safe setup script.
3. Create a **private channel** named **My Life, One Day at a Time**. Do not assign a public username or link a discussion group.
4. Add the bot as an administrator with **Post Messages** permission. Keep only yourself and the bot as members. Revoke unused invite links. Do not enable content protection on source bot messages.
5. Post a temporary setup message in the channel, then run:

```powershell
npm run setup:ids
```

This uses official `getUpdates` before a webhook exists. It prints numeric ID candidates, never message text or tokens, and does not acknowledge/discard updates. Identify your own `/id` update and your channel. Record `OWNER_TELEGRAM_ID` and the full `-100…` numeric `JOURNAL_CHANNEL_ID` in `.dev.vars`. No third-party ID bot is necessary. Updates expire, so repeat the setup messages if needed. If a webhook already exists, the script stops; it never deletes an existing webhook.

Leave `TELEGRAM_WEBHOOK_SECRET` as the example placeholder for now: `setup:secrets` generates a random value into `.dev.vars`. You can instead supply 32–256 random base64url-safe characters. Keep AI off.

### 3. Authenticate to Cloudflare Free and create D1

Create a Cloudflare account and confirm the Workers plan is **Free**. Do not upgrade or enable paid products.

```powershell
npx wrangler login
npx wrangler whoami
npm run db:create
```

Login requires your browser/account authorization. If you are not authenticated, stop remote setup here and complete login; do not use temporary preview accounts as a substitute for a permanent personal archive.

Copy the returned real `database_id` into `wrangler.jsonc`, replacing the all-zero placeholder. Keep binding `DB` and database name `life-journal`. Optionally change the Worker name before first deployment. Set a Cloudflare account ID in Wrangler only if you need to choose between multiple accounts; it is an ID, not a token.

```powershell
npm run db:local
npm run db:remote
npm run build
```

Local and remote D1 are separate. Both migrations must apply remotely before use. `compatibility_date` is pinned to `2026-11-13`, supported by the included local runtime. No paid-only limits or bindings are configured.

### 4. Deploy and store secrets securely

Deploy the Worker shell first so secret storage has an existing Worker. Its webhook returns 503 until required secrets are present; Telegram is not registered yet.

```powershell
npm run check
npx wrangler deploy
npm run setup:secrets
```

`setup:secrets` validates local IDs/token format, generates the webhook secret if necessary, and passes each value to `wrangler secret put` through stdin. Secret values never appear in command arguments. It stores bot token, webhook secret, owner ID, channel ID, and optional Gemini key. Wrangler applies secret changes to the Worker. Keep this local file secure or remove it after setup if you will supply values from a trusted secret manager. Removing it affects the setup scripts until values are supplied again.

Record the HTTPS `https://YOUR-WORKER.YOUR-SUBDOMAIN.workers.dev` URL printed by deployment. It is free; no custom domain is required.

### 5. Verify the channel and register Telegram

```powershell
npm run check:channel
npm run setup:webhook -- https://YOUR-WORKER.YOUR-SUBDOMAIN.workers.dev
npm run check:webhook
```

Replace the example URL with the actual deployed URL. Registration verifies `/health`, channel identity, private status, owner-as-creator, posting rights, member count, and lack of linked discussion chat. It sets the HTTPS endpoint `/telegram/webhook`, secret header, `max_connections: 1`, and only message, edited-message, callback, channel-post, and bot-membership updates. Existing pending updates are preserved. Irrelevant setup/channel updates are safely ignored by the application. Channel membership must also be checked manually because the bot cannot enumerate/revoke every invite link or prevent later owner changes.

Webhook diagnostics print only operational fields; remote error strings and URLs are omitted. `/health` is a liveness check and exposes no configuration or database contents.

### 6. Run the real acceptance check

Send `/start`, then follow [the manual test guide](docs/MANUAL_TESTING.md). Start with a harmless sample containing two notes, an album with captions, a video, and a voice note. Read `/done` through all pages, then `/save`. If Continue Save appears, tap until complete. Open the returned channel link as the owner and verify every original, caption, album, and recording. Do not delete or edit source messages while publication is running.

Check the Cloudflare dashboard trigger is `0 11 * * *`: **11:00 UTC = 19:00 Asia/Manila** year-round. Cron delivery is best effort around 7 PM, and trigger changes can take time to propagate. The bot must have been started by you and must not be blocked. Saved days skip the reminder. [Cron documentation](https://developers.cloudflare.com/workers/configuration/cron-triggers/).

## Optional Gemini setup

Original-only journaling works indefinitely without AI. **Skip this section to keep AI disabled.**

1. Create a Gemini API key for a separately verified API project in [Google AI Studio](https://aistudio.google.com/). Confirm **Free tier**, **billing not linked/enabled**, available regional access, and free text input/output quota for the exact model. A Gemini Plus subscription provides no API entitlement. If any step asks for billing/payment, stop and leave AI off.
2. Official [pricing](https://ai.google.dev/gemini-api/docs/pricing) and [model capabilities](https://ai.google.dev/gemini-api/docs/models/gemini-3.5-flash-lite), reviewed November 14, 2026, list `gemini-3.5-flash-lite` with free text generation and structured-output support. It is the only reviewed allowlisted ID in this release. Availability for **your project** has not been verified here. Do not substitute a guessed model or silently follow a deprecated alias.
3. Put the API key and `GEMINI_MODEL="gemini-3.5-flash-lite"` in `.dev.vars`. Run `npm run check:gemini`. It requires your interactive `FREE_ONLY` attestation after checking billing, then checks model metadata and a synthetic structured generation. No personal journal text is used by this setup probe.
4. The script prints a verification expiration up to 30 days away. Set non-secret Wrangler variables `AI_ENABLED: "true"`, `GEMINI_MODEL`, and `GEMINI_FREE_TIER_VERIFIED_UNTIL: "YYYY-MM-DD"`. Set the same values in `.dev.vars` for local use, run `npm run setup:secrets`, then `npm run deploy`.
5. In Telegram, use `/ai_on`, read the notice, and explicitly confirm. AI consent starts off even if `AI_ENABLED` is true. `/ai_off` revokes future requests and outstanding consent buttons. Existing previews remain available.

The models API verifies existence/capability, **not billing eligibility**. There is no supported billing-proof check here; your attestation must be accurate. Configuration expires after at most 31 days and fails closed until reviewed again. API requests use `v1beta/models/{model}:generateContent`, validated JSON schema, and exact application date. No tools, grounding, media, caching, model fallback, or automatic request retry is enabled. Up to 3 attempts/draft and 10/Philippine day are recorded before attempts. Quota errors, timeouts, invalid structure, missing models, and invalid keys fall back to an original preview. Invalid key/model/permission responses also revoke app AI consent. Expired configuration disables future generation.

Text, captions, and revision requests may be used to improve Google products under its applicable free-service terms. Review [Google's terms](https://ai.google.dev/gemini-api/terms) before enabling this for sensitive writing. Generated facts and emotional interpretation cannot be guaranteed correct; human review is mandatory. [Structured outputs](https://ai.google.dev/gemini-api/docs/structured-output) validate format, not factual accuracy.

## Local development and updates

```powershell
npm run db:local
npm run dev
```

Wrangler runs a local server at the printed URL, usually `http://localhost:8787`. `GET /health` works without secrets. `/telegram/webhook` requires valid test/local secrets and owner identity. **Development with real credentials can send real Telegram messages**; use the fully mocked `npm run test:runtime` for isolated development. Telegram cannot reach localhost for a normal production webhook.

For updates:

```powershell
npm ci
npm run check
npm run test:runtime
npm run db:remote
npm run deploy
npm run check:webhook
```

Use new additive SQL migrations; never edit an already-applied migration. Keep the same Worker URL, database ID, owner ID, and channel ID. Re-register the webhook after rotating its secret. Avoid changing owner/channel identity on an existing database; this app is permanently scoped to one owner. Migrations are not automatically reversed by Worker rollback.

To inspect minimal operational logs use `npx wrangler tail --format json` or the dashboard metrics. Application logs contain only an event code and update ID; no journal text, media, tokens, headers, or Gemini payloads. Keep platform debug logging off and avoid adding request/body logging. Set alerts for free-plan usage without upgrading. Request/D1 exhaustion can make the bot temporarily unavailable; Telegram retry storage is finite, so retain your original chat messages and check `/status` after recovery.

For a bad deployment:

```powershell
npx wrangler deployments list
npx wrangler rollback VERSION_ID
npm run check:webhook
```

Choose an actual compatible previous version ID from the list. Check its schema/secrets compatibility first. Rollback restores Worker code/configuration, not Telegram posts or D1 data. Do not blindly restore an older D1 snapshot after publishing: losing publication progress can cause duplicates. See [recovery](docs/RECOVERY.md) before any database restore. D1 Free has a [seven-day Time Travel window](https://developers.cloudflare.com/d1/platform/limits/), which also means deleted temporary draft text may persist in provider backups during that window.

## Configuration checklist

| Value | Where | Required |
| --- | --- | --- |
| `TELEGRAM_BOT_TOKEN` | Cloudflare secret; ignored local `.dev.vars` | Yes |
| `TELEGRAM_WEBHOOK_SECRET` | Cloudflare secret; same value used at registration | Yes; generated by setup if placeholder |
| `OWNER_TELEGRAM_ID` | Cloudflare secret; numeric account ID | Yes |
| `JOURNAL_CHANNEL_ID` | Cloudflare secret; full private `-100…` ID | Yes |
| D1 `database_id` | `wrangler.jsonc` | Yes; real ID, not the placeholder |
| `GEMINI_API_KEY` | Cloudflare secret | Only for optional AI |
| `GEMINI_MODEL` | Wrangler non-secret variable | Blank by default; reviewed ID only |
| `AI_ENABLED` | Wrangler non-secret variable | `false` by default |
| `GEMINI_FREE_TIER_VERIFIED_UNTIL` | Wrangler non-secret date | Only for AI; fresh attestation ≤31 days |
| Owner text-AI consent | D1, set by `/ai_on` confirmation | Only for personal AI processing |

`.dev.vars`, `.env*`, local databases, generated bundles, and dependencies are ignored. This repository uses the `edge405` GitHub identity and targets `https://github.com/edge405/dear-future-me.git`. Run `git check-ignore .dev.vars` and review staged files before every commit. Do not put real secrets into the example file.

## Recovery and troubleshooting

| Symptom | What to check |
| --- | --- |
| Bot does not respond | Start the bot privately, check the exact owner ID, Worker deployment/secrets, `/health`, and `npm run check:webhook`. Unauthorized users/groups are silently ignored. |
| Invalid webhook | Use HTTPS workers.dev URL and the identical secret on both sides; rerun secret setup and registration after rotation. POST only. |
| Wrong owner/channel ID | Compare numeric setup candidates against your own account/channel; preserve the full `-100` prefix. Never send journal content to a guessed destination. |
| Missing admin rights | Run `npm run check:channel`; bot must be an administrator allowed to post. You must be channel creator, with only owner/bot members. |
| Missing media or copy failure | Keep sources in the bot conversation, inspect `/status`, then follow [recovery](docs/RECOVERY.md). Unsupported/protected/deleted source messages cannot be magically recovered by Bot API. |
| Duplicate messages | Do not resend a whole entry. Inspect item progress and returned IDs before reconciliation. Telegram/D1 are not one transaction. |
| Gemini invalid key/model | Check the separately verified free project and reviewed model; fix setup, redeploy, then `/ai_on` again. Save Original always remains available. |
| Gemini free quota exhausted | Save Original; wait for the project's actual quota reset before a later attempt. No upgrade/fallback occurs. |
| D1 migration problems | Verify the configured real database ID and local versus remote target. Apply migrations in order; do not drop a database containing drafts or metadata. |
| Cloudflare free limit reached | Wait for daily reset or reduce use; storage exhaustion requires reviewed cleanup/export. Keep originals; do not upgrade or retry in a tight loop. |
| Reminder missing | Bot may be blocked, day may already be saved, cron may be delayed, D1 unavailable, or delivery uncertain. Check trigger and reminder row metadata. `/reminder` is an explicit same-day retry after inspection. |
| Old preview button | New content/edits invalidate approval. Use `/done` and read the new preview. |

## Design, security, and remaining limitations

See [file structure](docs/FILES.md), [architecture](docs/ARCHITECTURE.md), [security review](docs/SECURITY.md), [recovery](docs/RECOVERY.md), [manual acceptance tests](docs/MANUAL_TESTING.md), and [executed verification](docs/VERIFICATION.md).

Telegram private channels are cloud chats, **not end-to-end encrypted**. Telegram is the canonical archive; D1 is not a media backup. Loss/deletion of the Telegram account/channel can lose the archive. Periodically use Telegram Desktop's supported export workflow for your own offline backup; that computer is not needed for daily app operation.

Bot API cannot generally retrieve arbitrary historical private-channel content. Future historical AI summaries need a separate consent-based retention design. Source deletion has no reliable Bot API deletion notification; source edits delivered before saving are tracked, but edits/delayed updates during publication can race copies. Wait for albums, check the preview counts, and keep source messages unchanged until completion. Three seconds of quiet helps settle albums but cannot prove every Telegram update has arrived.

External calls and D1 cannot provide perfect exactly-once publication. Unknown results stop for owner reconciliation, never automatic whole-entry replay. Retrying missing items may place them later in the channel or split an album; deleting a partially copied batch and explicitly retrying restores order at the cost of recopying it. A finite owner-lock lease and provider outages cannot provide a mathematical distributed-transaction guarantee. These limits are documented, tested where mockable, and still require live acceptance checks.

This instance is deployed and connected. Use `/journal` for the current daily entry or `/date YYYY-MM-DD` for a past day; published entries remain closed and linkable. The setup instructions above also cover a fresh installation. Gemini passed its synthetic setup probe and is available after owner consent through `/ai_on`. Recheck Free-tier eligibility before the verification date expires to keep AI available; original-only journaling remains available.
