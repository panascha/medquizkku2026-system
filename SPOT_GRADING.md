# R2 Spot Grading Portal (Firebase RTDB)

Status: CONTRACT, not built (2026-10-25). Event 1 Nov 2569: Spot ends 12:00, grading about 12:05-12:45, Top 8 announced 13:00. Tasks #17-#21 in `../../TASK_QUEUE.md` (queued ahead of the R1 backup migration).

## Decisions (user-confirmed 2026-10-25)
- **Portal replaces the academic team's Spot sheet for score entry.** OnSite `SPOT_EXPORT` ("หน้าแรก") is not written with scores. The academic team must be told this (owner: user).
- **Tie at the 8/9 cut: no auto rule.** `setRound2Results()` sorts by score only, and no official R2 tie-break exists in any source. The dashboard flags every team tied across the cut and blocks Push until the chair picks.
- **Scores per item: q01-q30 = 0, 0.5 or 1; q31-q35 = 0 or 1** (academic team, 2026-10-30). Totals can be x.5 (still 0-35); the RTDB rules reject 0.5 on q31-q35.
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
scores/{qNN}/{MQxxx}: 0 | 0.5 | 1   (0.5 only q01-q30; q31-q35 are 0 | 1)
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
  - each score is a multiple of 0.5 in 0-35;
  - `passed` has 8 distinct IDs from that set;
  - the lowest score in `passed` >= the highest score outside it;
  - M is not already filled unless `overwrite`.
- Writes M and O for the 40 rows, `SpreadsheetApp.flush()`, `_invalidateOnSiteStatusCache()`.
- Verified with a node harness on stubbed sheet I/O before `clasp push` (memory: GAS verify = execute). The user deploys.

## Engine (pure, tested): `js/spot-grading-engine.js`
`normalizeTeamId(raw, teamSet)`, `progress(scores, teams, qids)`, `totals(scores)`, `rankWithCut(totals, 8)` returning `{ranked, cutTies}`, `laggards(progress)`, `buildPushPayload(totals, tieDecision)`, `lockState(grader, now)`.
Test: `node --test tests/spot-grading-engine.test.mjs`.

---

# Runbook (ภาษาไทย): R2 Spot วันงาน 1 พ.ย. 2569

ผู้รับผิดชอบ: IT (ประธาน/ผู้ดูแลระบบ). ห้ามวางไฟล์ข้อสอบ/เฉลย Spot ลงแชท เอกสาร หรือ commit. ไฟล์คำถามเก็บนอก git เท่านั้น.

## 0. ตัดสินใจแล้ว
- ไม่มี PIN สำรอง (Station PIN). ผู้ตรวจทุกคนต้อง login Google (`@kku.ac.th` / `@kkumail.com`) ที่อยู่ใน `staff_whitelist` ให้ได้ จึงบังคับตรวจ login ล่วงหน้า (ข้อ 3).

## 1. ตั้งค่าครั้งเดียว (ก่อนวันงาน)
1. **Rules**: merge key `spot_grading_2026` จาก `spot_grading.rules.json` เข้าใต้ `rules` เดิมในคอนโซล RTDB (ห้ามวางทับทั้งไฟล์, ห้ามมี `.read/.write: true` ที่ root เพราะทะลุทุก rule). ทดสอบใน Rules Playground: ผู้ใช้ที่ไม่อยู่ใน `staff_whitelist` อ่านไม่ได้, `questions` อ่านไม่ได้เมื่อ `isGradingOpen` ไม่เป็น `true`, เขียน `scores` ไม่ได้เมื่อปิดการตรวจ.
2. **Admins ในคอนโซล**: เพิ่ม `spot_grading_2026/admins/{escapedEmail}: true` ด้วยมือ (ประธาน + IT เท่านั้น; escape = เปลี่ยน `.` เป็น `_` ตัวพิมพ์เล็ก เช่นเดียวกับ `staff_whitelist`). คนที่ไม่อยู่ใน admins เห็นข้อความ "ไม่ได้อยู่ใน admins" และทำปุ่ม setup/Push ไม่ได้.
3. **OnSite GAS**: ตั้ง script property `SPOT_ADMINS` (comma list อีเมลตัวพิมพ์เล็ก = admins เดียวกับข้อ 2). `clasp push --force` แล้ว deploy action `setSpotResults` (ผู้ใช้ deploy เอง). Push จะ error `unauthorized` ถ้าอีเมลผู้กดไม่อยู่ใน `SPOT_ADMINS`.

## 2. ซ้อมด้วย fixture (ไม่แตะ Firebase)
- เปิด `pages/spot-grading.html?fixture=1` และ `pages/spot-dashboard.html?fixture=1` (ทีมปลอม 40 ทีม / ข้อปลอม 35 ข้อ). เพิ่ม `&complete=1` ที่ dashboard เพื่อดูสถานะ 1400/1400 และทดลองกรณีคะแนนเสมอที่ขอบ 8/9.
- ฝึกผู้ตรวจ: เลือกข้อ, พิมพ์เลขทีม (`15` / `015` / `MQ015`), กด `1` ถูก `0` ผิด, undo, คลิก badge เพื่อแก้คะแนน, ตัวนับ "รอส่ง N".
- ฝึกประธาน: ติ๊กทีมที่ผ่านเมื่อเสมอข้ามเส้นตัด 8/9 แล้วกด "บันทึกผลตัดสิน (tieDecision)".

## 3. ตรวจ login ล่วงหน้า (บังคับ, ก่อน 1 พ.ย.)
ผู้ตรวจ Spot ทุกคนต้องผ่านข้อนี้ ไม่มี PIN สำรอง:
1. รวมรายชื่อผู้ตรวจ Spot ทั้งหมด (อีเมลที่จะใช้จริง) ตรวจว่าทุกอีเมลอยู่ใน `staff_whitelist` (คอนโซล RTDB) และเป็นโดเมน `@kku.ac.th` / `@kkumail.com`. ขาด: เพิ่มก่อน.
2. ให้แต่ละคน login ด้วยอุปกรณ์ที่จะใช้ตรวจจริง (มือถือ/แท็บเล็ต/แล็ปท็อป) ที่ `pages/spot-grading.html` บนเครือข่ายสถานที่จริงถ้าทดสอบได้. ต้องเข้าหน้าได้ ไม่ถูกเด้งออก และเห็นตัวเลือกข้อ.
3. ทำ **pass list**: ชื่อ / อีเมล / อุปกรณ์ / login ผ่าน (วันที่-เวลา) / ผู้ตรวจสอบ. ต้องผ่านครบทุกคนก่อนวันงาน.
4. คนที่ไม่ผ่าน: แก้ whitelist/บัญชี/เบราว์เซอร์ แล้วทดสอบซ้ำจนผ่าน. ถ้ายังไม่ผ่านให้เปลี่ยนตัวผู้ตรวจเป็นคนที่ผ่านแล้ว (ไม่มีทางเลี่ยงด้วย PIN). วันงานเตรียมอุปกรณ์สำรองที่ login ผ่านแล้วอย่างน้อย 1 เครื่อง.
5. หลังซ้อม ถ้าเขียน Firebase จริง ให้ล้าง `scores`, `scoreMeta`, `graders`, `tieDecision` และตั้ง `config/isGradingOpen` เป็น `false`.

## 4. วันงาน 1 พ.ย. (Spot จบ 12:00, ตรวจ ~12:05-12:45, ประกาศ Top 8 13:00)
1. ก่อน 12:00: dashboard (admin) กด "โหลด 40 ทีมจาก OnSite" (ทีมที่ `R1_Passed = TRUE`; ตรวจว่าได้ 40). `isGradingOpen` ยังเป็น **false**. อย่าอัปโหลดข้อสอบก่อนสอบจบ.
2. **12:00 อัปโหลดเฉลย**: หลัง Spot จบ เลือกไฟล์ JSON (35 ข้อ) จากที่เก็บนอก git ในช่อง "อัปโหลดข้อสอบ (JSON)" แล้วกดปุ่มสลับ "การตรวจ" เป็นเปิด. ห้ามเก็บไฟล์ในโฟลเดอร์ repo; ห้ามส่งต่อทางแชท.
3. ผู้ตรวจ login แล้วเลือกข้อ (ถ้ามีคนตรวจอยู่จะขึ้น "กำลังตรวจข้อนี้"; ใช้ "ตรวจแทน" หลังยืนยันเท่านั้น). ดู progress/ข้อที่ตรวจช้าบน dashboard.
4. ครบ 1400/1400 และไม่มีคะแนนเสมอที่ยังไม่ตัดสิน: ประธานติ๊กทีมผ่านในกรณีเสมอ, บันทึก tieDecision, ตรวจรายชื่อ 8 ทีม แล้วกด **Push**. ตรวจคอลัมน์ M และ O ของ `LS_OnSite` ด้วยตาอีกครั้ง.
5. ปิดการตรวจ (`isGradingOpen = false`) หลัง Push และจัดการข้อมูลเฉลยใน `questions` ตามที่ตกลง.
- ถ้า Push ฟ้องว่า M มีข้อมูลอยู่แล้ว: ใช้ `overwrite` เฉพาะเมื่อประธานยืนยัน.

## 5. แจ้งฝ่ายวิชาการ (ผู้แจ้ง: ผู้ใช้)
ก่อนวันงานต้องแจ้งฝ่ายวิชาการ: **ชีทตรวจ Spot ของฝ่ายวิชาการไม่ถูกใช้เป็นคะแนนทางการ** คะแนน R2 ทั้งหมดมาจากพอร์ทัลนี้และถูก Push เข้า `LS_OnSite` (`SPOT_EXPORT` / "หน้าแรก" ไม่ถูกเขียนคะแนน). ถ้าฝ่ายวิชาการจดคะแนนในชีทของตน ถือเป็นเอกสารอ้างอิงเท่านั้น.

## 6. Checklist ก่อนวันงาน
- [ ] rules merge แล้ว + Rules Playground ผ่าน
- [ ] admins ในคอนโซล = `SPOT_ADMINS` ใน GAS
- [ ] ซ้อม fixture ทั้งสองหน้าเสร็จ
- [ ] pass list login ครบทุกผู้ตรวจ
- [ ] ไฟล์เฉลย 35 ข้ออยู่นอก git และเข้าถึงได้ ณ 12:00
- [ ] แจ้งฝ่ายวิชาการแล้ว
