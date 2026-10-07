# R1 Backup Exam (student page)

Public zero-auth page `r1-backup-exam.html` for the KKUEXAM-outage fallback. Seat claim (anonymous Firebase auth) is the authentication; there is no password.

## Before the exam
1. Firebase console, Authentication, Sign-in method: enable **Anonymous**.
2. RTDB rules: **merge** the single `r1_backup_exam` key from `r1_backup_exam.rules.json` under your existing `rules` object. Pasting it as the whole ruleset replaces everything. Any ancestor `.read`/`.write: true` (check the root) cascades and defeats these rules. Check in Rules Playground; rules are untested in-repo.
3. RTDB plan: Spark caps at 100 simultaneous connections. 300 students + staff need Blaze. Check before exam day.
4. Anonymous sign-in creation is rate-limited per IP (documented ~100/hr). 300 students behind one lab NAT may be blocked. Mitigation: run a rehearsal where students open the page and claim seats beforehand (anon uid persists in IndexedDB), spread over hours / networks, or raise the limit via Identity Platform.
5. Item-order assumption: Part 1 = 21 SBA (`m01`-`m21`) then 7 MTF (`m22`-`m28`, statements `m22s1`-`m28s4`). Confirm against the real KKUEXAM order.

## Behaviour notes
- Members 2/3: Part 2 is read-only ("ส่งโดยหัวหน้าทีม (-1)"). Only `-1` writes Part 2.
- Clearing site data, or a staff Google sign-in in the same browser (staff-guard signs out), gives a new anon uid: the seat stays locked until staff clears `r1_backup_exam/{username}/uid` (Release Seat, task #15).
- Staff Google session in the same browser: page shows an error and does not sign out or sign in.
- Writes are rejected at server `now > endAt` exactly. Client locks at server-estimated 0 and flushes first; a last-millisecond click can lose.
- Submit = 2-step modal, mouse/Space only; Enter is blocked.

## RTDB contract (`r1_backup_exam/`)
- `_control/{mcq|unseen}` = `{startAt, endAt}` (ms epoch). Staff write.
- `_questions/{mcq|unseen}` = question JSON (below). Readable by students only after `startAt`. Never store an answer key here.
- `{username}` (`mq2026-NNN-M`, NNN 001-100, M 1-3): `uid`, `claimedAt`, `answers/{qid}`, `flags/{itemId}`, `submitted/{part}`, `blurCount`.
- ids: SBA `m01`-`m21` (A-E); MTF item `m22`-`m28`, statements `m22s1`-`m28s4` (T/F); Part 2 sections `u1a`..`u3b`, statements `u1a1`..`u3b4` (T/F).

### Upload JSON shape
```json
{ "version": 1, "part": "mcq", "title": "...",
  "items": {
    "m01": { "no": 1, "type": "sba", "stem": "...", "imageUrl": "https://... (optional)",
             "options": { "A": "...", "B": "..." } },
    "m22": { "no": 22, "type": "mtf", "stem": "...",
             "statements": { "m22s1": { "no": 1, "text": "..." } } } } }
```
```json
{ "version": 1, "part": "unseen", "title": "...",
  "articles": { "u1": { "no": 1, "title": "...",
    "sections": { "u1a": { "no": 1, "label": "1.1", "prompt": "...",
      "statements": { "u1a1": { "no": 1, "text": "..." } } } } } } }
```
Inline markup allowed: `<b> <i> <sub> <sup>`. `imageUrl` only if it starts with `https://`.

## Fixture mode (no Firebase, fake data)
`r1-backup-exam.html?fixture=1&mins=1&u=mq2026-001-1` (`mins` default 45, min 0.2). Local only; never automatic.
Serve with `python -m http.server 5502` from this folder.

## Tests
`node --test tests/r1-backup-engine.test.mjs` (engine only; `node --test tests/` fails on Node 22).
