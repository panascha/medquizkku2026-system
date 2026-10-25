# R1 Backup Exam: Cloudflare Worker + D1 API (replaces Firebase path)

Status: CONTRACT, not built (2026-10-25). Competition 1 Nov 2569. Tasks #22-#27 in `../../TASK_QUEUE.md`.

## Decisions (user-confirmed 2026-10-25)
- **Backend = Option C**: Cloudflare Worker + D1. Assumes venue internet survives a KKUEXAM outage.
- **Seat token** guards seats (no external auth): first claim returns a random token, client keeps it in localStorage, every student write sends it. Release Seat clears it.
- **Answer key never leaves the staff browser.** `/api/export` returns the raw RTDB-shaped tree; the staff page builds Moodle TSV with the existing `r1-backup-staff-engine.js` (`buildMcqTsv`/`buildUnseenTsvs`), so output still matches OnSite `_readMoodleExport`.
- **Seam = sync modules.** New `js/r1-backup-api.js` / `js/r1-backup-staff-api.js` export the same names as `r1-backup-sync.js` / `r1-backup-staff-sync.js`. Engines, their tests, and `?fixture=1` stay untouched.
- **Firebase path stays in the repo until #26 (300-client load test) passes**, then #27 retires it. Never delete it to make something work.

## File layout
```
www/medquizkku2026-system/
├── r1-backup-worker/          # NEW, own wrangler project
│   ├── wrangler.toml          # D1 binding R1DB, vars ALLOWED_ORIGINS, GRACE_MS; NO secrets
│   ├── schema.sql
│   ├── src/index.js           # router, CORS, handlers
│   ├── src/rules.js           # pure: id regexes + window/ownership checks ported from r1_backup_exam.rules.json
│   ├── src/tree.js            # pure: D1 rows -> RTDB-shaped root
│   └── test/*.test.mjs        # node --test, pure modules only
├── js/r1-backup-config.js     # NEW: export const API_BASE = 'https://<worker>.workers.dev'
├── js/r1-backup-api.js        # NEW student sync (same exports as r1-backup-sync.js)
├── js/r1-backup-staff-api.js  # NEW staff sync (same exports as r1-backup-staff-sync.js)
tools/build_r1_backup_json.py  # repo ROOT tools/ (not in any git); writes OUTSIDE git, see Ingestion
```
Secret: `ADMIN_TOKEN` via `wrangler secret put ADMIN_TOKEN`. Never in wrangler.toml, docs, or commits.

## D1 schema
```sql
CREATE TABLE seats    (username TEXT PRIMARY KEY, token_hash TEXT NOT NULL, claimed_at INTEGER NOT NULL, blur_count INTEGER NOT NULL DEFAULT 0);
CREATE TABLE answers  (username TEXT, qid TEXT, value TEXT NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY (username, qid));
CREATE TABLE flags    (username TEXT, item_id TEXT, PRIMARY KEY (username, item_id));
CREATE TABLE submitted(username TEXT, part TEXT, at INTEGER NOT NULL, client_completed_at INTEGER, client_time_taken INTEGER, PRIMARY KEY (username, part));
CREATE TABLE control  (part TEXT PRIMARY KEY, start_at INTEGER NOT NULL, end_at INTEGER NOT NULL);
CREATE TABLE questions(part TEXT PRIMARY KEY, json TEXT NOT NULL);
CREATE TABLE images   (name TEXT PRIMARY KEY, part TEXT NOT NULL, mime TEXT NOT NULL, data BLOB NOT NULL);
```
Token stored as SHA-256 hex only. Release Seat deletes the `seats` row (answers stay).

## Validation (port of rules.json, enforced server-side)
- username `^mq2026-(00[1-9]|0[1-9][0-9]|100)-[123]$`. Optional roster: var `ROSTER` (comma list of usernames, no PII) if 2-member teams must be rejected; empty = regex only.
- answers: SBA `m01`-`m21` value `A`-`E`; MTF `m22s1`-`m28s4` and Unseen `u1a1`-`u3b4` value `T`/`F`; `null` deletes.
- flags: `m01`-`m28`, `u1a`-`u3b`.
- Unseen writes (answers/flags/submit) only for `-1` seats.
- Writes for a part only when `startAt <= now <= endAt + GRACE_MS` (GRACE_MS default 5000, absorbs flush latency; old RTDB rule was exact `endAt` — assumption, confirm) and that part not yet submitted.
- `blurCount` monotonic non-decreasing, <= 100000.

## Endpoints
Public, `X-Seat-Token` where marked. Every response includes `now` (server ms) so the client re-syncs its clock without extra polls.

| Method | Path | Body / auth | Returns |
|---|---|---|---|
| POST | /api/claim | `{username}` + optional `X-Seat-Token` | `{status:"claimed", token}` new; `{status:"resumed"}` token matches; 409 `{status:"taken"}` |
| GET | /api/control | none | `{now, mcq:{startAt,endAt}?, unseen:{...}?}` |
| GET | /api/questions/:part | none | 403 before startAt; question JSON (no key, ever) |
| GET | /api/img/:name | none | image bytes; 403 before its part's startAt |
| GET | /api/seat | X-Seat-Token, `?username=` | own `{answers, flags, submitted, blurCount}` (= `loadRemote`) |
| POST | /api/submit | X-Seat-Token, `{username, part, answers:{qid:val\|null}, flags:{id:bool}, blurCount?, final?, timeTaken?, completedAt?}` | `{ok, now, rejected:[qid...]}`. Idempotent upsert of a **delta**; `final:true` stamps `submitted/{part}` = server now (client times stored for audit only). Called as autosave checkpoint AND final submit. |
| GET | /api/status | none / X-Seat-Token | public: `{now, claimed, submittedMcq, submittedUnseen}`; with token+username adds own seat's `submitted` |

Admin, `Authorization: Bearer <ADMIN_TOKEN>`:

| Method | Path | Purpose |
|---|---|---|
| GET | /api/admin/tree | RTDB-shaped root `{_control, {username}:{claimedAt, answers, flags, submitted, blurCount}}` (uid replaced by `claimed:true`). Feeds `monitorRows`, polled by `watchRoot`. |
| GET | /api/export | same tree as attachment `r1-backup-export.json` (raw, ungraded) |
| PUT | /api/admin/control/:part | `{startAt,endAt}` (endAt > startAt) |
| PUT | /api/admin/questions/:part | sanitized JSON; server rejects any field named `key`/`answer`/`correct` anywhere |
| PUT | /api/admin/img/:name?part= | raw bytes, png/jpeg only, <= 1 MB |
| POST | /api/admin/release/:username | delete seat row |

CORS: allow only origins in `ALLOWED_ORIGINS`; preflight for `X-Seat-Token` / `Authorization`.

## Client behaviour
- Student: localStorage autosave stays as is (outbox in `r1bk:v1:` keys). Outbox flushes as ONE `/api/submit` delta every 10 s and on `online` event, not per click. `watchControl` = poll `/api/control` every 30 s plus `now` piggybacked on every response. `fetchQuestions` keeps the jittered retry on 403.
- Seat token saved in the session key; resume sends it to `/api/claim`. `ensureAnon`/`UID_MISMATCH`/`STAFF_SESSION` branches in `r1-backup-app.js` replaced by token resume; 409 shows the existing "ที่นั่งนี้ถูกใช้งานแล้ว" message.
- Staff page: no Firebase, no `requireStaff`. Admin token typed once, kept in sessionStorage. `watchRoot` = poll `/api/admin/tree` every 5 s.

## Free-tier budget (check before 1 Nov)
Workers free = 100k requests/day; D1 free = 100k row writes/day. 300 clients x 90 min: control poll @30 s ~ 54k + checkpoints @10 s ~ 160k requests -> **exceeds free Workers quota**. Use Workers Paid ($5/month) for exam day, or raise checkpoint interval. Writes are delta-only (~20-30k rows), fine.

## Ingestion (live exam content: never print stems/keys to chat, docs, or commits)
Sources (filenames only): `Source MedQuiz 2026/Exam for MedQuiz 2026 CAUTION/Round 1 MTF MCQ/Round 1 KKUEXAM MQ2569 Aiken format.txt` (+ images dir) and `.../Round 1 Unseen/*/EDIT*.html` (+ images).
Output dir (no git anywhere above it): `Source MedQuiz 2026/Exam for MedQuiz 2026 CAUTION/Round 1 backup json/` -> `mcq.json`, `unseen.json`, `key.json`, `images/`.
Script prints counts and id lists only. Must hit 21 SBA + 7 MTF x 4 + 24 Unseen statements, else stop and report the mismatch. Images referenced as `https://<worker>/api/img/<name>`, uploaded via the staff page. Unseen has no image field in the current JSON shape: extend `normalizeQuestions` + `sanitizeQuestions` (with tests) only if the sources need images.
