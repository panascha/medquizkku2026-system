# R2 Spot Grading Portal (Firebase RTDB)

Status: CONTRACT, not built (2026-10-25). Event 1 Nov 2569: Spot ends 12:00, grading about 12:05-12:45, Top 8 announced 13:00. Tasks #17-#21 in `../../TASK_QUEUE.md` (queued ahead of the R1 backup migration).

## Decisions (user-confirmed 2026-10-25)
- **Portal replaces the academic team's Spot sheet for score entry.** OnSite `SPOT_EXPORT` ("หน้าแรก") is not written with scores. The academic team must be told this (owner: user).
- **Tie at the 8/9 cut: no auto rule.** `setRound2Results()` sorts by score only, and no official R2 tie-break exists in any source. The dashboard flags every team tied across the cut and blocks Push until the chair picks.
- **Scores are 0/1 only.** No partial credit.
- Firebase RTDB + Google login (`@kku.ac.th`/`@kkumail.com`) + `requireStaff()` (`js/staff-guard.js`), the same as the other portal pages. Look matches `checking.html` / `check-onsite-staff.html` (Tailwind CDN + Sarabun + Font Awesome), so no new design direction is needed.

## Corrections to the original proposal
- **Team IDs are not 1-40.** The 40 qualifiers are the `MQ001`-`MQ100` teams with `R1_Passed = TRUE`. Badges show those 40 real IDs. Typed input accepts `15`, `015` or `MQ015`, normalizes it to `MQ015`, and rejects any ID not in the 40 (red error, no write).
- **The web RTDB SDK has no disk persistence.** Offline writes are lost on reload. Graders keep a localStorage outbox (`spot:v1:outbox`) flushed on `.info/connected` and every 5 s, with a visible "รอส่ง N" counter. The same pattern is used in `js/r1-backup-sync.js`.
- **Push does not call `setRound2Results()`**, which would re-cut ties arbitrarily. The new GAS action writes col M (R2_Score) and col O (R2_Passed) directly from the chair-confirmed list.
- **Bottleneck alert = completion count** per question (for example "q22: 25/40") against the median. There is no speed estimate.

## RTDB contract (`spot_grading_2026/`)
```
config/      { isGradingOpen: bool, pushedAt?: ms, pushedBy?: email }
admins/{escapedEmail}: true         # chair + IT, set by hand in console
teams/{MQxxx}: { name, r1Rank }     # exactly 40, loaded from OnSite getAllOnSiteTeams (K = TRUE)
questions/{q01..q35}: { no, subject, type: "MCQ"|"SAQ", key, rubric }
graders/{qNN}: { email, name, lastActive }   # advisory lock, heartbeat 20 s, stale after 60 s
scores/{qNN}/{MQxxx}: 0 | 1
scoreMeta/{qNN}/{MQxxx}: { by: email, at: ms }   # audit, written with the score in one update()
tieDecision: { passed: [8 MQ ids], by, at }
```
Rules snippet `spot_grading.rules.json` gets merged under the existing `rules`, exactly as in `R1_BACKUP_EXAM.md`:
- Read/write needs whitelisted staff (same expression as `r1_backup_exam.rules.json`).
- `questions` readable only while `config/isGradingOpen === true`. Upload the key after the exam ends (12:00), not before.
- `scores/$q/$team`: write only while grading is open, `$q` matches `^q(0[1-9]|[12][0-9]|3[0-5])$`, `$team` exists under `teams`, value 0 or 1.
- `config`, `admins`, `teams`, `questions`, `tieDecision`: write only by `admins`.

Question upload file (`{"questions": {"q01": {...}}}`, 35 entries) lives **outside any git repo**. Its contents are never pasted into chat, docs or commits.

## Pages
**`pages/spot-grading.html`** (graders, phone/tablet/laptop)
1. Question picker showing lock holders. Picking a question held by a fresh lock shows "<name> กำลังตรวจข้อนี้" plus a confirm-gated "ตรวจแทน" takeover.
2. Pinned header: no., subject, key, rubric.
3. Team input (autofocus), then keys `1` = correct and `0` = wrong (also two big buttons). After a write the field clears and refocuses, and a last-action line with undo appears (`MQ015 = 1`). Space and Enter never score.
4. A strip of 40 badges: green = 1, red = 0, gray = not graded. Click a badge to re-score that team.

**`pages/spot-dashboard.html`** (chair/IT projector, admins only for actions)
1. Setup: load the 40 teams from OnSite, upload the questions JSON, and an open/close grading toggle.
2. Live 35 x 40 heatmap, progress `n / 1400`, per-question completion with laggards highlighted.
3. Leaderboard (total out of 35). Teams tied across the 8/9 boundary are flagged, and the chair ticks which ones pass, which writes `tieDecision`.
4. **Push**, enabled only at 1400/1400 with no unresolved tie. It sends one staff-gated POST to OnSite GAS. A success sets `config/pushedAt`.
- Both pages support `?fixture=1` (fake 40 teams / 35 questions, no Firebase).

## OnSite GAS action `setSpotResults` (POST)
Payload `{action, idToken, scores: {MQxxx: int}, passed: [8 ids], overwrite?: bool}`.
- `requireWhitelistedStaff_` plus the caller's email in script property `SPOT_ADMINS` (comma list).
- Validates:
  - score keys are exactly the K = TRUE set (40);
  - each score is an integer 0-35;
  - `passed` has 8 distinct IDs from that set;
  - the lowest score in `passed` >= the highest score outside it;
  - M is not already filled unless `overwrite`.
- Writes M and O for the 40 rows, `SpreadsheetApp.flush()`, `_invalidateOnSiteStatusCache()`.
- Verified with a node harness on stubbed sheet I/O before `clasp push` (memory: GAS verify = execute). The user deploys.

## Engine (pure, tested): `js/spot-grading-engine.js`
`normalizeTeamId(raw, teamSet)`, `progress(scores, teams, qids)`, `totals(scores)`, `rankWithCut(totals, 8)` returning `{ranked, cutTies}`, `laggards(progress)`, `buildPushPayload(totals, tieDecision)`, `lockState(grader, now)`.
Test: `node --test tests/spot-grading-engine.test.mjs`.
