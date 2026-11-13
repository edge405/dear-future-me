# Security and privacy review

Reviewed locally November 14, 2026. This is an implementation review and automated verification, not an independent penetration test or provider compliance audit.

## Controls implemented

- POST-only webhook with a random shared secret header, bounded JSON parsing (256 KiB), and structure validation. Secret comparison avoids content-dependent early exits after the length check.
- Owner ID, sender identity, private-chat type, and chat ID checked before D1 access for every message/edit/callback. Group/unauthorized requests are silently acknowledged. No public journal endpoints or exports exist.
- Revision-bound compact callbacks, persisted AI confirmation nonce/expiration, and state checks before destructive cancellation or approval. All pages must be delivered before preview approval is accepted.
- Parameterized SQL; foreign keys, unique constraints, lookup indexes, and a database state-transition trigger. Batched writes atomically create plans, invalidate previews, or complete publication/purge text.
- Leased update claims and owner serialization, plus source uniqueness. No automatic replay of ambiguous external writes. Explicit, owner-only reconciliation preserves successful work.
- Channel ID/private type, creator ownership, bot posting rights, member count ≤2, and no discussion group checked before initial publication and continuations. This is a snapshot; membership changes later remain the owner's responsibility.
- Secrets supplied through Cloudflare secrets and stdin setup scripts; ignored local files and placeholder examples. No token, media, personal text, auth header, remote error body, or Gemini request body is logged. Operational logs contain fixed codes/update IDs only. Health is non-sensitive liveness.
- Gemini requires the deployment switch, reviewed model, fresh project attestation, and owner opt-in. Keys stay in headers. Requests cannot include photos/audio/media files. No paid API fallback, tools, grounding, or paid Telegram broadcasting. Date/structured output validated and attempts limited before calls.
- No runtime npm dependencies. Dev tools pinned and lockfile provided; audit results recorded in VERIFICATION.md. No external analytic service or persistent background helper.
- Delivered source edits invalidate approval. Unsupported/oversized edits block preparation until corrected. Exact source copies retain captions and Telegram entities without generated replacement.

## Remaining risks and operator responsibilities

- Telegram bot/private-channel messages are not end-to-end encrypted. Telegram and Cloudflare process private content under their own terms; channel privacy is not a cryptographic privacy guarantee. Free Gemini may use submitted text/captions to improve Google products. Keep AI off for content unsuitable for those terms.
- D1 live text purge does not instantly erase provider backup history. Free D1 Time Travel keeps up to seven days; local ignored databases/config files also remain on your computer until you remove them securely. Unfinished drafts persist intentionally.
- Anyone with a bot token/webhook secret or account access can impersonate integration traffic. Protect local files, account sessions, browser login, and recovery codes. Rotate leaked tokens and webhook secrets, redeploy, and re-register. There is no automatic secret-rotation service.
- Model metadata APIs do not prove Google project billing status. The script requires manual attestation and expires configuration. If you enable billing outside this app or provider pricing changes, this code cannot prove every request costs zero. Keep billing disabled and review pricing at each renewal. Cloudflare must remain on Workers Free.
- AI can misinterpret, hallucinate, or obey hostile text despite prompts. Format checks do not prove factual fidelity. Review generated text; originals are always copied separately. No diagnosis/transcription/image understanding is claimed.
- No shared transaction exists across Telegram and D1. Lost responses, severe stalls beyond the three-minute owner-lock lease, provider outages, or operator mistakes in `/recover` can still produce duplicates/missing/reordered items. Unknown operations stop for inspection; this system does not promise perfect exactly-once behavior.
- Albums can be delayed indefinitely. Quiet-period checks and stale-button rejection reduce races but cannot prove completeness. Edits during a copy race, Telegram-side deletions without notifications, or expired/unavailable source messages require owner inspection. Already published entries are not automatically edited.
- Bot API checks cannot prove a human opened a history link or continuously enforce channel membership/invite privacy. Test links as the owner and keep only owner/bot access. A leaked private link alone does not grant membership.
- Free-plan CPU, request, database, storage, and Telegram flood limits can interrupt work. HTTP 503 encourages finite Telegram retries, but Telegram does not retain updates indefinitely. Keep source messages and verify status after outages. Do not enable paid upgrades as a recovery step.
- D1 stores minimal archive metadata long term. It is not an independent media/text backup and cannot reconstruct a lost Telegram channel. Use your own Telegram export backup if needed.

At initial local verification, no credentials or cloud resources were present. Subsequent setup uses ignored local credentials and a provisioned D1 database; see SETUP_STATUS.md for current progress. Source files contain no real tokens. No production audit or complete live workflow is claimed by this review.
