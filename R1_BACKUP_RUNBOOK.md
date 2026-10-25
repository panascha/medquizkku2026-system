# Runbook: R1 Backup Exam (ใช้เมื่อ KKUEXAM ล่ม)

ระบบสำรองใช้ Cloudflare Worker + D1 (`r1-backup-worker/`) แทน Firebase เดิม (เลิกใช้ใน #27) รายละเอียด API ดู `R1_BACKUP_API.md` รูปแบบ JSON และคำสั่ง deploy ดู `R1_BACKUP_EXAM.md` (เอกสารนี้ไม่ซ้ำ)

## 0. เตรียมก่อนวันสอบ (ทำล่วงหน้าอย่างน้อย 1 สัปดาห์)

รันคำสั่ง Worker จากโฟลเดอร์ `r1-backup-worker/`

1. ล็อกอิน Cloudflare: `npx wrangler login`
2. สร้างฐานข้อมูล: `npx wrangler d1 create r1-backup` แล้วนำ `database_id` ที่ได้ไปใส่ใน `wrangler.toml` (แทน `REPLACE_BEFORE_DEPLOY`)
3. สร้างตาราง: `npx wrangler d1 execute r1-backup --remote --file=schema.sql`
4. ตั้งรหัสผู้ดูแล: `npx wrangler secret put ADMIN_TOKEN` (พิมพ์เมื่อระบบถาม ห้ามใส่ในไฟล์/commit/แชต)
5. แก้ `ALLOWED_ORIGINS` ใน `wrangler.toml` ให้เป็น origin ของหน้าพอร์ทัลที่ deploy จริง (คั่นด้วย comma)
6. Deploy: `npx wrangler deploy` จดค่า URL `https://r1-backup.<subdomain>.workers.dev`
7. แก้ `API_BASE` ใน `js/r1-backup-config.js` เป็น URL ข้างบน (ไม่มี `/` ท้าย) แล้ว deploy พอร์ทัล
8. **ใช้แพ็กเกจฟรี (ตัดสินใจ 2026-10-26)**: โควตาฟรีคือ 100,000 request/วัน และ D1 อ่านได้ 5 ล้านแถว/วัน รีเซ็ตเวลา 07:00 น. ตามเวลาไทย นักเรียนตรวจสถานะทุก 60 วินาที หน้า staff รีเฟรชทุก 60 วินาที **เปิดหน้า staff monitor ได้แค่ 1 แท็บ** เพราะเปิดเพิ่มหนึ่งแท็บจะใช้โควตาการอ่าน D1 เพิ่มอีกเท่าหนึ่ง และห้ามรัน load test กับบัญชีนี้ในวันสอบ
9. สร้างไฟล์โจทย์ใหม่ด้วย origin จริง (รันที่ root โปรเจกต์ ซึ่งอยู่นอก git): `python -I tools/build_r1_backup_json.py --base https://r1-backup.<subdomain>.workers.dev` ต้องรายงานจำนวน 23 SBA + 5 MTF x 4 ข้อย่อย + 24 ข้อย่อย Unseen ถ้าไม่ตรงให้หยุดและแจ้ง ไฟล์ผลลัพธ์ (`mcq.json`, `unseen.json`, `key.json`, `images/`) อยู่นอก repo ห้าม commit ห้ามแสดงเนื้อหาโจทย์/เฉลย
10. `key.json` รูปแบบ `{"key": {...}}` ต้องครบ 23 SBA + 20 MTF + 24 Unseen ค่า SBA = A-E, MTF/Unseen = T หรือ F เท่านั้น ตัวอย่างค่าปลอม (FAKE): `{ "key": { "m01": "C", "m24s1": "T", "u1a1": "F" } }`
11. เตรียมรหัส `ADMIN_TOKEN` ให้ staff ที่จะใช้หน้า `pages/r1-backup-staff.html` (หน้านี้ไม่ใช้ล็อกอิน Google ใช้รหัสนี้อย่างเดียว ส่งผ่านช่องทางส่วนตัว)
12. ซ้อมหน้าจอด้วย fixture: `r1-backup-exam.html?fixture=1&mins=1&u=mq2026-001-1` และ `pages/r1-backup-staff.html?fixture=1` (เปิดผ่าน `python -m http.server 5502` ในโฟลเดอร์นี้) ซ้อมกับ Worker จริงในเครื่อง: `npx wrangler dev` แล้วเปิดหน้าด้วย `?api=http://127.0.0.1:8787`

### Load test 300 client

สคริปต์ `tools/r1-loadtest/loadtest.mjs` (Node 18+, ไม่มี dependency) ใช้ข้อมูลสังเคราะห์ ทับ `control`/`questions` และทิ้ง seat 300 รายการไว้ จึงต้องใช้ D1 ทดสอบที่ทิ้งได้เท่านั้น

- ผลในเครื่อง (#26): `npx wrangler dev` + 300 client ผ่าน exit 0, ล้มเหลว 0
- **ยังค้าง (ผู้ใช้ต้องรันเอง): รันกับ Worker staging ที่ deploy จริง ยังไม่ได้ทำ**
  ```bash
  node tools/r1-loadtest/loadtest.mjs run --base https://<staging-worker>.workers.dev --admin-token <ADMIN_TOKEN> --confirm-test-db
  ```
  (base ที่ไม่ใช่ localhost ต้องใส่ `--confirm-test-db`) ตัวเลือก: `--clients N` (1-300) `--ramp-ms` `--think-min/--think-max` `--burst-ms` `--checkpoint-ms` `--control-poll-ms` `--json`
- ล้างข้อมูลทดสอบ: `node tools/r1-loadtest/loadtest.mjs cleanup` จะพิมพ์ SQL สำหรับรีเซ็ต แล้วรันด้วย `npx wrangler d1 execute r1-backup --remote --command "<SQL>"` (ใช้ `--local` สำหรับข้อมูลของ `wrangler dev`) ห้ามรันกับ D1 ที่ใช้สอบจริง

## 1. ตัดสินใจเปลี่ยนมาใช้ระบบสำรอง (Failover)

เงื่อนไข: ระบบสำรองนี้สมมติว่าอินเทอร์เน็ตของสถานที่สอบยังใช้ได้เมื่อ KKUEXAM ล่ม

1. ยืนยันกับทีม KKUEXAM/ผู้ดูแลว่าระบบกู้ไม่ได้ภายในเวลาที่ยอมรับได้ และผู้รับผิดชอบตัดสินใจสลับ
2. Staff เปิด `pages/r1-backup-staff.html` ใส่ `ADMIN_TOKEN` แล้วอัปโหลดโจทย์ `mcq.json`, `unseen.json` และรูปใน `images/` ถ้ายังไม่ได้อัปโหลด (หน้าเว็บ/เซิร์ฟเวอร์ปฏิเสธฟิลด์แปลกปลอม เช่น เฉลย) **ก่อนเริ่มเวลา** นักเรียนอ่านโจทย์ไม่ได้จนกว่าจะถึง `startAt`
3. ประกาศให้ห้องสอบทุกห้อง: ใช้ Google Chrome ปกติ (ไม่มี SEB) เปิด `r1-backup-exam.html` ผู้คุมสอบต้องเดินตรวจหน้าจอแทนระบบล็อก
4. นักเรียนกรอก username `mq2026-NNN-M` (NNN = 001-100, M = 1-3) แล้วยืนยัน seat (ระบบเก็บ token ไว้ในเบราว์เซอร์ ห้ามล้างข้อมูลเว็บไซต์ หรือเปลี่ยนเครื่องระหว่างสอบ)
5. สมาชิกคนที่ 2/3 ทำเฉพาะ Part 1; Part 2 (Unseen) ส่งโดยหัวหน้าทีม (`-1`) เท่านั้น

## 2. Staff: เริ่ม / ต่อเวลา / ปิด (`pages/r1-backup-staff.html`)

1. ใส่ `ADMIN_TOKEN` (เก็บใน sessionStorage ปิดแท็บแล้วต้องใส่ใหม่)
2. กด "เริ่ม (45 นาที)" ต่อ Part; กด "ขยายเวลา (นาที)" เมื่อต้องเพิ่มเวลา (เช่น ระบบช้า); กด "จบทันที" เมื่อต้องปิดทันที เซิร์ฟเวอร์รับคำตอบถึง `endAt` + `GRACE_MS` (ค่าตั้งต้น 5 วินาที)
3. **Release seat**: นักเรียนเปลี่ยนเครื่อง/ล้างข้อมูลเบราว์เซอร์แล้วเข้า seat เดิมไม่ได้ (409 "ที่นั่งนี้ถูกใช้งานแล้ว") ให้ staff กด Release seat ของ username นั้น (ลบแถว seat คำตอบเดิมยังอยู่) แล้วให้นักเรียนกรอก username ใหม่
4. ดูตาราง "ติดตามสด" (อัปเดตทุก 5 วินาที): จับจอง, ตอบ Part 1/2, ส่ง P1/P2, Blur ต่อ username

## 3. หลังหมดเวลา: ตรวจคะแนน, TSV, นำเข้า OnSite

1. ในหน้า staff โหลด `key.json` (อยู่ในหน่วยความจำของเบราว์เซอร์เท่านั้น ปิดแท็บแล้วหาย; เฉลยไม่เคยถูกส่งไป Worker)
2. ตรวจรายชื่อ `In progress` (ไม่ได้กดส่ง) ว่าจะนับคะแนนจากคำตอบที่ auto-save ไว้หรือไม่ ตามที่คณะกรรมการตัดสิน
3. กด "คำนวณคะแนน + สร้าง TSV" จะได้ TSV 4 ชุด (เฉพาะ username `-1` สำหรับ Unseen):
   - `From KKUEXAM` (หัวตาราง `Grade/112.00`)
   - `From UNSEEN 1`, `From UNSEEN 2`, `From UNSEEN 3` (หัวตาราง `Grade/8.00`)
4. วางลงแท็บชื่อตรงกันใน Sheet ของ OnSite (วางที่ A1 ทับของเดิมทั้งแท็บ)
5. รันเมนู OnSite: `importKKUEXAMScores()` แล้ว `importUnseenScores()` (ดู `www/appscript clasp/MedQuiz 2026 OnSite/MANUAL.md`) ถ้า `Grade/NN` ไม่ตรงค่าที่รองรับ import จะยกเลิกทั้งหมด ให้แก้ที่ต้นทาง ห้ามแก้ตัวเลขให้ผ่าน

## 4. ตรวจหลังจบ และ Rollback

- username ที่ import แล้วไม่อยู่ใน roster: ระบบรายงานรายชื่อ ให้ตรวจสะกด/ seat ที่ claim ผิด
- จำนวนแถวใน `From KKUEXAM` = จำนวนผู้เข้าสอบจริง; Unseen = จำนวนทีมที่หัวหน้าส่ง
- สุ่มเทียบคะแนน 3-5 คนกับคำตอบดิบจาก export
- เก็บ export ดิบ (ปุ่มส่งออกในหน้า staff = `/api/export`, ไฟล์ `r1-backup-export.json`) เป็นหลักฐาน เก็บนอก repo เพราะมีคำตอบนักเรียน
- **Rollback (KKUEXAM กลับมาใช้ได้ก่อนเริ่มสอบ)**: staff ไม่ต้องกดเริ่มเวลา Part ใด ๆ นักเรียนอ่านโจทย์ไม่ได้และเขียนไม่ได้ก่อน `startAt` ประกาศให้กลับไปใช้ KKUEXAM ตามเดิม ถ้าสอบไปแล้วบางส่วน ให้คณะกรรมการตัดสินว่าจะใช้คะแนนจากระบบใด ห้ามรวมสองระบบโดยไม่มีมติ
- หลังยืนยันผลแล้ว: ตั้ง `ADMIN_TOKEN` ใหม่ (`npx wrangler secret put ADMIN_TOKEN`) หรือลบ Worker/D1 (`npx wrangler delete`, `npx wrangler d1 delete r1-backup`) เมื่อไม่ใช้แล้ว และลดแพ็กเกจกลับเป็นฟรีถ้าต้องการ
- ห้าม `git push` จนกว่าจะตรวจในเบราว์เซอร์ครบ
