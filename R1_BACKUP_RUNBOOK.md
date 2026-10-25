# Runbook: R1 Backup Exam (ใช้เมื่อ KKUEXAM ล่ม)

รายละเอียด RTDB contract และรูปแบบ JSON ดู `R1_BACKUP_EXAM.md` (เอกสารนี้ไม่ซ้ำ)

## 0. เตรียมก่อนวันสอบ (ทำล่วงหน้าอย่างน้อย 1 สัปดาห์)

1. Firebase console เปลี่ยนแพ็กเกจ RTDB เป็น **Blaze** (Spark จำกัด 100 connection พร้อมกัน; นักเรียน 300 + staff ต้องใช้ Blaze)
2. Authentication, Sign-in method: เปิด **Anonymous**
3. RTDB Rules: **merge** key `r1_backup_exam` จาก `r1_backup_exam.rules.json` เข้าไปใน `rules` เดิม (ห้ามวางทับทั้งไฟล์ และห้ามมี `.read/.write: true` ที่ root เพราะจะทะลุ rules ทั้งหมด) แล้วทดสอบใน Rules Playground
4. เตรียมไฟล์ 3 ไฟล์ **นอก repo** (ห้าม commit โจทย์/เฉลย):
   - `mcq.json` และ `unseen.json` รูปแบบตาม `R1_BACKUP_EXAM.md` (หัวข้อ Upload JSON shape)
   - `key.json` เฉลย รูปแบบ `{"key": {...}}` ต้องครบ 23 SBA + 20 MTF + 24 Unseen
5. ตัวอย่างค่าปลอม (FAKE) ของ key:
   ```json
   { "key": { "m01": "C", "m02": "A", "m24s1": "T", "m24s2": "F", "u1a1": "F", "u1a2": "T" } }
   ```
   ค่า SBA = A-E, MTF/Unseen = T หรือ F เท่านั้น
6. Whitelist: staff ที่จะใช้หน้า `pages/r1-backup-staff.html` ต้องอยู่ใน `staff_whitelist`
7. ซ้อมหน้าจอด้วย fixture: `r1-backup-exam.html?fixture=1&mins=1&u=mq2026-001-1` และ `pages/r1-backup-staff.html?fixture=1` (เปิดผ่าน `python -m http.server 5502` ในโฟลเดอร์นี้)

### Load test 300 client (ผู้ใช้เป็นคนรันเอง)

สคริปต์ `tools/r1-loadtest/loadtest.mjs` (Node 18+, ไม่มี dependency) เขียนเฉพาะ `r1_backup_exam_loadtest/` เท่านั้น ไม่แตะ `r1_backup_exam/`

```bash
cd tools/r1-loadtest
node loadtest.mjs run                 # dry-run (stub ในเครื่อง ไม่ต่อเน็ต) ใช้เช็คสคริปต์
node loadtest.mjs print-rules         # ได้ rules ของ subtree ทดสอบ: merge เข้า RTDB rules ชั่วคราว
node loadtest.mjs seed                # ได้ JSON: Import ที่ node /r1_backup_exam_loadtest ใน console (ต้อง seed ใหม่ทุกครั้งก่อนรัน เพราะหน้าต่างเวลา = ตอนนี้-1 นาที ถึง +2 ชม.)
# Windows PowerShell: $env:R1_LT_DB_URL="..."; $env:R1_LT_API_KEY="..."  (ค่าอยู่ใน js/firebase-config.js)
node loadtest.mjs run --live          # รันจริง
node loadtest.mjs cleanup --live      # ลบ subtree (ต้องมี env R1_LT_AUTH = staff ID token) หรือลบใน console เอง
```

- ตัวเลือก: `--clients N` (<=300) `--ramp-ms` (กระจายเวลา sign-in) `--think-min/--think-max` (หน่วง ms ต่อคำตอบ) `--burst-ms` (ช่วงที่ทุกคนกดส่ง)
- รายงาน: จำนวนสำเร็จ/ล้มเหลวต่อ operation (signUp, claimSeat, fetchQuestions, answerWrite, submitBurst) และ p50/p90/p95/p99/max
- สิ่งที่ต้องดู: `signUp` ล้มเหลวด้วย `TOO_MANY_ATTEMPTS_TRY_LATER` (anonymous sign-in จำกัดต่อ IP ประมาณ 100/ชม., 300 เครื่องหลัง NAT เดียวกันอาจโดนบล็อก) และ `answerWrite`/`submitBurst` ที่ล้มเหลว
- หลังทดสอบ: ลบ rules ชั่วคราวของ `r1_backup_exam_loadtest` ออก และลบ Anonymous users ที่สร้างไว้ใน Authentication, Users ถ้าต้องการ

## 1. ตัดสินใจเปลี่ยนมาใช้ระบบสำรอง

1. ยืนยันกับทีม KKUEXAM/ผู้ดูแลว่าระบบกู้ไม่ได้ภายในเวลาที่ยอมรับได้
2. ประกาศให้ห้องสอบทุกห้อง: ใช้ Google Chrome ปกติ (ไม่มี SEB) เปิด `r1-backup-exam.html` ผู้คุมสอบต้องเดินตรวจหน้าจอแทนระบบล็อก
3. นักเรียนกรอก username `mq2026-NNN-M` (NNN = 001-100, M = 1-3) แล้วยืนยัน seat
4. สมาชิกคนที่ 2/3 ทำเฉพาะ Part 1; Part 2 (Unseen) ส่งโดยหัวหน้าทีม (`-1`) เท่านั้น

## 2. Staff: เริ่ม / ต่อเวลา / ปิด (`pages/r1-backup-staff.html`)

1. Login ด้วยบัญชี KKU ที่อยู่ใน whitelist
2. อัปโหลดโจทย์ `mcq.json` และ `unseen.json` (หน้าเว็บจะปฏิเสธฟิลด์แปลกปลอม เช่น เฉลย) **ก่อนเริ่มเวลา** นักเรียนอ่านโจทย์ไม่ได้จนกว่าจะถึง `startAt`
3. กด "เริ่ม (45 นาที)" ต่อ Part; กด "ขยายเวลา (นาที)" เมื่อต้องเพิ่มเวลา (เช่น ระบบช้า); กด "จบทันที" เมื่อต้องปิดทันที
4. **Release seat**: นักเรียนเปลี่ยนเครื่อง/ล้างข้อมูลเบราว์เซอร์แล้วเข้า seat เดิมไม่ได้ ให้ staff กด Release seat ของ username นั้น (ล้างทั้ง `uid` และ `claimedAt`) แล้วให้นักเรียนกรอก username ใหม่
5. ดูตาราง "ติดตามสด": จับจอง, ตอบ Part 1/2, ส่ง P1/P2, Blur ต่อ username

## 3. หลังหมดเวลา: ตรวจคะแนน, TSV, นำเข้า OnSite

1. ในหน้า staff โหลด `key.json` (อยู่ในหน่วยความจำของเบราว์เซอร์เท่านั้น ปิดแท็บแล้วหาย)
2. ตรวจรายชื่อ `In progress` (ไม่ได้กดส่ง) ว่าจะนับคะแนนจากคำตอบที่ auto-save ไว้หรือไม่ ตามที่คณะกรรมการตัดสิน
3. กด "คำนวณคะแนน + สร้าง TSV" จะได้ TSV 4 ชุด (เฉพาะ username `-1` สำหรับ Unseen):
   - `From KKUEXAM` (หัวตาราง `Grade/112.00`)
   - `From UNSEEN 1`, `From UNSEEN 2`, `From UNSEEN 3` (หัวตาราง `Grade/8.00`)
4. วางลงแท็บชื่อตรงกันใน Sheet ของ OnSite (วางที่ A1 ทับของเดิมทั้งแท็บ)
5. รันเมนู OnSite: `importKKUEXAMScores()` แล้ว `importUnseenScores()` (ดู `www/appscript clasp/MedQuiz 2026 OnSite/MANUAL.md`) ถ้า `Grade/NN` ไม่ตรงค่าที่รองรับ import จะยกเลิกทั้งหมด ให้แก้ที่ต้นทาง ห้ามแก้ตัวเลขให้ผ่าน

## 4. ตรวจหลังจบ

- username ที่ import แล้วไม่อยู่ใน roster: ระบบรายงานรายชื่อ ให้ตรวจสะกด/ seat ที่ claim ผิด
- จำนวนแถวใน `From KKUEXAM` = จำนวนผู้เข้าสอบจริง; Unseen = จำนวนทีมที่หัวหน้าส่ง
- สุ่มเทียบคะแนน 3-5 คนกับคำตอบดิบใน RTDB
- เก็บ snapshot `r1_backup_exam/` (Export JSON ใน console) เป็นหลักฐาน เก็บนอก repo เพราะมีคำตอบนักเรียน
- หลังยืนยันผลแล้ว: ปิดเวลา Start ทั้งสอง Part, ลบ `_questions` และ `_control`, ถอด/ปิดสิทธิ์ที่ไม่ใช้, เปลี่ยน RTDB กลับ Spark ถ้าต้องการ
- ห้าม `git push` จนกว่าจะตรวจในเบราว์เซอร์ครบ
