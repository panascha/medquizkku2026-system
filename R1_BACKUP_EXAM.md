# R1 Backup Exam (student page + Cloudflare Worker)

Public zero-auth page `r1-backup-exam.html` for the KKUEXAM-outage fallback. Backend = Cloudflare Worker + D1 (`r1-backup-worker/`). The seat token is the authentication (no password, no Google sign-in). The old Firebase/RTDB path was retired in task #27. Full endpoint contract: `R1_BACKUP_API.md`. Failover steps (Thai): `R1_BACKUP_RUNBOOK.md`.

## Deploy checklist (once, before exam day)
Run Worker commands from `r1-backup-worker/` (Wrangler via `npx wrangler`, logged in with `npx wrangler login`).
1. Create the D1 database: `npx wrangler d1 create r1-backup`. Copy the printed `database_id` into `r1-backup-worker/wrangler.toml` (`database_id = "REPLACE_BEFORE_DEPLOY"`); binding name stays `R1DB`.
2. Apply the schema: `npx wrangler d1 execute r1-backup --remote --file=schema.sql`.
3. Set the admin secret (prompted, never in files/commits): `npx wrangler secret put ADMIN_TOKEN`.
4. Set `ALLOWED_ORIGINS` in `wrangler.toml` `[vars]` to the deployed portal origin (comma list; default is localhost only). Optional `GRACE_MS` (default 5000) and `ROSTER` (comma list of usernames; empty = regex only).
5. Deploy: `npx wrangler deploy`. Note the printed `https://r1-backup.<subdomain>.workers.dev`.
6. Set `API_BASE` in `js/r1-backup-config.js` (replace `REPLACE_BEFORE_DEPLOY` in the URL; no trailing slash), then deploy the portal.
7. Free plan budget (decided 2026-10-26: stay on Workers Free). Limits: 100k requests/day, D1 5M rows read + 100k rows written/day, reset 00:00 UTC (07:00 Bangkok). Checkpoints only send when the outbox has changes, so 300 clients x 90 min = ~27k control polls (60 s) + ~20-30k submits. The staff monitor reads the whole `answers` table on every `/api/admin/tree` poll (~20k rows at the end), so polling every 60 s with ONE staff tab is ~1M rows read. Each extra staff tab adds the same again. Do not load-test against the same account on exam day.
8. Rebuild the exam JSON with the real Worker origin so image URLs point at it: from the project root (outside git) `python -I tools/build_r1_backup_json.py --base https://r1-backup.<subdomain>.workers.dev`. Outputs `mcq.json`, `unseen.json`, `key.json`, `images/` outside git. The script must report 23 SBA + 5 MTF x 4 statements + 24 Unseen statements, else stop. Never commit or print these files.
9. Item-order assumption: Part 1 = 23 SBA (`m01`-`m23`) then 5 MTF (`m24`-`m28`, statements `m24s1`-`m28s4`). Confirm against the real KKUEXAM order.

## Load test
`tools/r1-loadtest/loadtest.mjs` (Node 18+, no dependencies). Synthetic data only; it overwrites `control` and `questions` for both parts and leaves 300 seats, so use a throwaway D1 only.
- Local (`npx wrangler dev` in `r1-backup-worker/`, default `http://127.0.0.1:8787`): `node tools/r1-loadtest/loadtest.mjs run --base http://127.0.0.1:8787 --admin-token <T>`. Done in #26: 300 clients, exit 0, 0 failures.
- Deployed staging: same command with `--base https://<staging-worker>.workers.dev --admin-token <T> --confirm-test-db` (non-localhost bases require it). **Still pending, user step: not yet run against a deployed staging Worker.**
- Options: `--clients N` (1-300), `--ramp-ms`, `--think-min/--think-max`, `--burst-ms`, `--checkpoint-ms`, `--control-poll-ms`, `--json`.
- Reset: `node tools/r1-loadtest/loadtest.mjs cleanup` prints the reset SQL; run it with `npx wrangler d1 execute r1-backup --remote --command "<SQL>"` (`--local` for dev state).

## Behaviour notes
- Members 2/3: Part 2 (Unseen) is read-only ("ส่งโดยหัวหน้าทีม (-1)"). Only `-1` seats write Part 2 (server-enforced).
- First claim returns a random seat token kept in the browser (localStorage). Clearing site data loses it: the seat stays locked until staff use Release Seat (deletes the `seats` row; answers stay).
- Writes are accepted for `startAt <= now <= endAt + GRACE_MS` and only while the part is not submitted. `final:true` stamps the submit time from server time.
- Autosave outbox flushes as one `/api/submit` delta every 10 s and on `online`; control poll every 60 s.
- Submit = 2-step modal, mouse/Space only; Enter is blocked.

## D1 / API summary
Tables: `seats`, `answers`, `flags`, `submitted`, `control`, `questions`, `images` (`r1-backup-worker/schema.sql`). ids: SBA `m01`-`m23` (A-E); MTF item `m24`-`m28`, statements `m24s1`-`m28s4` (T/F); Part 2 sections `u1a`..`u3b`, statements `u1a1`..`u3b4` (T/F). Usernames `mq2026-NNN-M`, NNN 001-100, M 1-3. Never store an answer key in the Worker: the server rejects any `key`/`answer`/`correct` field in uploaded questions.

### Upload JSON shape
```json
{ "version": 1, "part": "mcq", "title": "...",
  "items": {
    "m01": { "no": 1, "type": "sba", "stem": "...", "imageUrl": "https://... (optional)",
             "options": { "A": "...", "B": "..." } },
    "m24": { "no": 24, "type": "mtf", "stem": "...",
             "statements": { "m24s1": { "no": 1, "text": "..." } } } } }
```
```json
{ "version": 1, "part": "unseen", "title": "...",
  "articles": { "u1": { "no": 1, "title": "...",
    "sections": { "u1a": { "no": 1, "label": "1.1", "prompt": "...",
      "statements": { "u1a1": { "no": 1, "text": "..." } } } } } } }
```
Rich markup (#25a): stems, Unseen prompts and statement text allow `<b> <i> <sub> <sup> <strong> <em> <br> <p> <ul> <ol> <li> <hr> <table> <thead> <tbody> <tr> <td> <th>` and `<img src="https://<worker>/api/img/<name>">`; checked by `checkRichHtml`; no other attributes except numeric td/th `colspan`/`rowspan`. `imageUrl` only if it starts with `https://`.

## Fixture mode (no network, fake data)
`r1-backup-exam.html?fixture=1&mins=1&u=mq2026-001-1` (`mins` default 45, min 0.2). Local only; never automatic. Serve with `python -m http.server 5502` from this folder. Local Worker for the live path: `?api=http://127.0.0.1:8787` (loopback only; other values ignored).

## Staff page (`pages/r1-backup-staff.html`)
No Google sign-in: staff type the `ADMIN_TOKEN` once (kept in sessionStorage). Upload questions and images (sanitiser refuses any unknown field, so no key), per-part start/extend/end, live monitor (polls `/api/admin/tree` every 60 s), Release Seat, grade + Moodle TSV export (tabs `From KKUEXAM` = `Grade/112.00`, `From UNSEEN 1/2/3` = `Grade/8.00`, `-1` usernames only). `/api/export` returns the raw ungraded tree; grading happens in the browser.
Answer key file: `{"key": {"m01": "C", "m24s1": "T", "u1a1": "F", ...}}`, complete (23 SBA + 20 MTF + 24 Unseen statements); held in browser memory only.
Unsubmitted students export as `In progress` with `-` for Completed/Time taken and a score from their autosaved answers.
Fixture: `pages/r1-backup-staff.html?fixture=1` (fake tree and key, no network).

## Tests
Portal, one file at a time (`node --test tests/` fails on Node 22): `node --test tests/r1-backup-engine.test.mjs`, `tests/r1-backup-staff-engine.test.mjs`. Worker: `cd r1-backup-worker && node --test test/<file>`.
