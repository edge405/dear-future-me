# Architecture

## Request path

`Telegram → POST /telegram/webhook → secret/schema check → private owner check → D1 owner lock → update claim → command/callback → persist result → HTTP 200`.

Invalid secrets return 403. Invalid/bounded-overflow JSON returns 400. Wrong methods return 405. Strangers, groups, channel posts, and irrelevant updates are acknowledged without touching D1. Busy or failed processing returns 503 so Telegram can retry. Long work is bounded and awaited inside the request; it is not abandoned into a short-lived background task. No queues, Durable Objects, buckets, or local daemon are required.

## Data model and state

`collecting → preparing → preview_ready → publishing → published`.

Collecting/preparing/preview/failed drafts may be cancelled. Preparing can recover to collecting, preview, or failed. A delivered new note/edit reopens a preview for collection and clears its approval. Publishing cannot be cancelled or rewritten. Terminal published/cancelled states do not reopen. A SQL trigger enforces allowed transitions, and migration 0003 changes the partial unique index to enforce one unfinished owner/date draft. Starting again after publication or cancellation creates a new ID and leaves prior archives unchanged. `/today` selects the most recent completed archive for today.

The selected draft is explicit in `app_settings`. `/journal` selects today's Asia/Manila draft; `/date` can select a past one. Commands operate on the selection. Buttons include draft UUID and revision, fit Telegram's 64-byte callback limit, and never contain content. Confirmed AI consent has a separate short-lived nonce. The webhook checks sender, private chat, and matching chat ID before any data read.

Messages keep source chat/message/update IDs, album IDs, Telegram timestamp, receipt time, type, and temporary text/caption. Source message ID is the stable private-chat sequence. Albums are grouped from all received items, sorted, and batched at 100 without splitting known contiguous albums at a batch boundary. Telegram performs copying; the Worker never downloads a media file.

`journal_archives` is metadata. New `archive_items` plans contain a dated heading with an explicitly bold title, one logical story paragraph in Telegram-size chunks, then original-copy batches. They do not create reflection/question/summary posts. Each item stores source IDs, returned destination IDs, state, retry time, and a temporary text payload. A single SQL transaction creates the plan and enters publishing. Each item is marked inflight before its external call and done after recording the result. At most three items run per `/save`. Existing frozen plans, including legacy text/reflection items, resume unchanged to preserve earlier approval and progress.

Successful plan items never replay on ordinary `/save`. Definite Telegram errors are retryable. Timeout, 5xx, malformed success, partial nonempty copy result, and interrupted inflight operations stop as uncertain. No mapping is guessed after Telegram skips some sources. Owner reconciliation is recorded separately; see RECOVERY.md.

After every item completes, one D1 batch marks archive/draft published and removes live draft text, captions, AI preview/reflection/question, and temporary archive payloads. Original source IDs and channel destination IDs remain for deduplication/history/recovery. Cancel removes its draft messages and temporary preview. Unfinished and failed draft text stays until cancellation or successful publication. Provider backups can retain earlier versions briefly.

## Concurrency, limits, and scheduling

Database constraints handle duplicate source/update IDs. `processed_updates` uses a three-minute leased processing claim and a terminal done state. A D1 owner lock serializes owner operations across Worker isolates, including cron. A lock token prevents an older request from releasing a newer request's lock. Telegram registration also uses one delivery connection. These mechanisms reduce ordinary races, but are not a distributed transaction; a severely stalled invocation outliving its lease is a residual risk.

Cron is UTC `0 11 * * *`. It computes the Asia/Manila date from scheduled time, ignores stale/mismatched invocations, skips published dates, and atomically claims one reminder/date. Definite delivery failures can retry; ambiguous sends are not automatically repeated. Cleanup removes up to 1,000 old update IDs per daily invocation after 14 days and AI attempt counts older than 30 days. Metadata grows slowly and must be monitored against D1's finite storage.

Runtime uses native fetch, JSON, Web APIs, and parameterized SQL. All external API calls have timeouts and no automatic model retries. Paged preview delivery and three publication operations cap request work. No paid broadcast flag, paid Cloudflare service, grounding, model fallback, file upload, or continuously running service is used.

## AI trust boundary

Both a deployment kill switch/fresh free-project attestation and owner consent are required. Only reviewed `gemini-3.5-flash-lite` is allowlisted. Model metadata is checked on each generation, then `v1beta` structured generation sends text/captions only. The system prompt treats notes and revision requests as untrusted and requires preservation of language, meaning, chronology, and expressed feelings. Runtime validation rejects wrong dates, extra/missing/wrong-type fields, oversized output, safety/incomplete responses, and invalid JSON. Validation cannot prove factual fidelity; the owner approves the result. Attempts are counted before calls, up to 3/draft and 10/Manila day. No response or request body is logged.

The structured fields are `language`, `title`, `entry_date`, and `story`. Gemini infers language from all source notes together, without a user-selected target. English, Tagalog/Filipino, and Taglish keep their language/register; other source languages retain the prior no-translation behavior. Titles and stories reject line/control separators; the story is one paragraph, up to 32,000 UTF-16 units. The 12,000-output-token ceiling allows detailed notes without requiring a short summary. Truncated/invalid output falls back to an original preview. Revisions include previous wording plus unchanged original notes, with originals explicitly designated the sole factual source. Regeneration starts again from originals.

Gemini requests use `redirect: 'manual'` and reject non-success status codes. This is compatible with Cloudflare Workers, which does not support `redirect: 'error'`; no redirected API-key request is followed. Old preview reflection/question columns remain for schema compatibility but new previews clear them. Old-format unpublished AI previews require a fresh preparation before an AI save; Save Original stays available. No migration or source-message deletion is needed.
