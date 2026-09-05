// js/essay-grading-fixture.js
//
// ข้อมูลตัวอย่างสำหรับพัฒนา/ทดสอบหน้าตรวจ Essay แบบไม่ต่อ API จริง
//
// ทำไมต้องมี: คิวตรวจ Essay จริงจะว่างจนกว่าจะรัน syncExamData() หลังสอบรอบ 0
// (5 ก.ย. 2569) จึงทดสอบ workflow ก่อนหน้าวันสอบไม่ได้
// ชื่อ/คำตอบ/โรงเรียน เป็นข้อมูลสมมติทั้งหมด ห้ามดึงจากไฟล์ CAUTION
//
// ใช้เมื่อเปิดหน้าด้วย ?fixture=1

const ESSAY_SLOTS = [
    { label: '1.1', max: 6 },
    { label: '1.2', max: 6 },
    { label: '2.1', max: 12 },
    { label: '3.1', max: 4 },
    { label: '3.2', max: 4 },
    { label: '3.3', max: 4 },
];

const FIXTURE_TEAMS = [
    {
        email: 'demo.school1@gmail.com',
        teamName: 'ทีมสมมติหนึ่ง',
        schoolName: 'โรงเรียนตัวอย่างวิทยา',
        quota: 'โรงเรียน',
        sheetName: 'เรียงทีมโรงเรียน',
        autoScore: 280,
        essayAnswers: [
            'อธิบายกลไกการเกิดโรคความดันโลหิตสูงจากภาวะไตขาดเลือด พร้อมระบุบทบาทของ renin-angiotensin system',
            'เปรียบเทียบฤทธิ์ของยา beta-blocker และ calcium channel blocker ในการรักษาโรคหัวใจ',
            'จงอธิบายวงจรการแข็งตัวของเลือดแบบ intrinsic pathway พร้อมระบุปัจจัยที่เกี่ยวข้องอย่างน้อย 4 ปัจจัย',
            'อธิบายพยาธิสภาพของโรคเบาหวานชนิดที่ 1 พร้อมอาการทางคลินิกที่สำคัญ',
            'จงระบุกลไกการออกฤทธิ์ของยา penicillin และอธิบายว่าเหตุใดยาจึงมีฤทธิ์เฉพาะต่อแบคทีเรีย',
            'อธิบายความแตกต่างระหว่าง innate immunity และ adaptive immunity พร้อมยกตัวอย่างเซลล์ที่เกี่ยวข้อง',
        ],
        currentScores: [0, 0, 0, 0, 0, 0],
        verifyStatus: '',
        // 🚨 SEVERE — ติดหลายมิติพร้อมกัน และ Essay ซ้ำกับทีมที่ "ไม่ได้อยู่ในคิว"
        // (คู่เทียบมาจากทั้ง cohort ไม่ใช่แค่ทีมตรงเส้นแบ่งโควตา) เพื่อทดสอบการปิดบัง
        // ชื่อในโหมด Blind กรณีที่หาเลขสุ่มตรวจของทีมคู่เทียบไม่ได้
        integrity: {
            severity: 'SEVERE',
            flags: [
                'ส่งเร็วผิดปกติ (34.5 นาทีหลังเปิดฟอร์ม)',
                'อัตราพิมพ์สูงผิดปกติ (อย่างน้อย 151 ตัว/นาที)',
                'ร่องรอย Markdown ในคำตอบ (4 จุด)',
                'Essay ซ้ำกับอีกทีม 88.0% (ต่างโรงเรียน)',
            ],
            flagTypes: ['speedrun', 'typing', 'markdown', 'similarity'],
            submitMinutes: 34.5,
            speedRank: 2,
            cpm: 151,
            charsTotal: 5210,
            maxSimilarity: 0.88,
            crossSchool: true,
            sharedRareAnswers: 7,
            speedFlagged: true,
            typingFlagged: true,
            markdownHits: 4,
            llmHits: 0,
            echoHits: 0,
            // มีเฉพาะใน payload ของคิว (_handleEssayQueue คำนวณจากคำตอบที่อ่านมาแล้ว)
            // — ตารางอันดับไม่มีคำตอบ จึงไม่มีฟิลด์นี้โดยตั้งใจ ใช้ทดสอบสองเส้นทาง
            // ของเช็กลิสต์: "รู้ว่าอยู่ข้อไหน" กับ "ไม่ทราบว่าอยู่ข้อไหน"
            markdownSlots: ['1.1', '2.1'],
            similarPairs: [
                {
                    otherEmail: 'outside.teamx@gmail.com', otherTeamName: 'ทีมนอกคิวเอ็กซ์',
                    similarity: 0.88, sharedRareAnswers: 7, sameSchool: false, severity: 'SEVERE',
                    topSlot: '2.1', topSlotSimilarity: 0.93,
                    otherSchoolName: 'โรงเรียนนอกคิวศึกษา', otherQuota: 'โรงเรียน',
                    otherSubmitMinutes: 41.8, deltaMinutes: 7.3,
                },
            ],
        },
    },
    {
        email: 'demo.mixed2@gmail.com',
        teamName: 'ทีมผสมสอง',
        schoolName: '',
        quota: 'ผสม',
        sheetName: 'เรียงทีมผสม',
        autoScore: 276,
        essayAnswers: [
            'อธิบายสรีรวิทยาของการหดตัวของกล้ามเนื้อลาย พร้อมบทบาทของแคลเซียมและ troponin',
            'จงอธิบายกระบวนการสร้างปัสสาวะที่ไต ตั้งแต่การกรองจนถึงการดูดซึมกลับ',
            'อธิบายกลไกการเกิดไข้และบทบาทของ prostaglandin ในกระบวนการอักเสบ',
            'จงระบุประเภทของ hypersensitivity reaction ทั้ง 4 ชนิด พร้อมยกตัวอย่างโรค',
            'อธิบาย pharmacokinetics ของยา ได้แก่ absorption, distribution, metabolism, excretion',
            'อธิบายบทบาทของวิตามินซีในกระบวนการสร้างคอลลาเจน และผลของการขาดวิตามินซีต่อร่างกาย',
        ],
        currentScores: [0, 0, 0, 0, 0, 0],
        verifyStatus: '',
        // ⚠️ WARN — ติดมิติเดียว (สำนวน LLM) ไม่มีคู่ Essay ซ้ำ
        integrity: {
            severity: 'WARN',
            flags: ['สำนวนที่พบบ่อยในข้อความจาก LLM (3 จุด)'],
            flagTypes: ['llm'],
            submitMinutes: 168.2,
            speedRank: 402,
            cpm: 44,
            charsTotal: 7400,
            maxSimilarity: 0,
            crossSchool: null,
            sharedRareAnswers: 0,
            speedFlagged: false,
            typingFlagged: false,
            markdownHits: 0,
            llmHits: 3,
            echoHits: 0,
            markdownSlots: [],
            similarPairs: [],
        },
    },
    {
        email: 'demo.school3@gmail.com',
        teamName: 'ทีมตัวอย่างสาม',
        schoolName: 'โรงเรียนจำลองศึกษา',
        quota: 'โรงเรียน',
        sheetName: 'เรียงทีมโรงเรียน',
        autoScore: 284,
        essayAnswers: [
            'อธิบายระบบ buffer ในเลือดและกลไกการรักษาดุลกรด-ด่างของร่างกาย',
            'จงเปรียบเทียบโครงสร้างและหน้าที่ของหลอดเลือดแดงกับหลอดเลือดดำ',
            'อธิบายวงจรชีวิตของ Plasmodium falciparum พร้อมระยะที่ก่อให้เกิดอาการมาลาเรีย',
            'อธิบายกลไกการเกิด allergic reaction แบบ anaphylaxis และวิธีการรักษาเบื้องต้น',
            'จงอธิบายการทำงานของ G-protein coupled receptor พร้อมยกตัวอย่างฮอร์โมนที่เกี่ยวข้อง',
            'อธิบายพยาธิวิทยาของโรคตับแข็ง และผลต่อระบบไหลเวียนเลือดที่ผ่านตับ',
        ],
        currentScores: [5, 4, 10, 3, 3, 2],
        verifyStatus: 'Graded',
        // ไม่มีธง — การ์ดคิวต้องไม่ขึ้น badge และแผงตรวจต้องไม่มีกล่องแจ้งเตือน
        integrity: {
            severity: 'NONE',
            flags: [],
            flagTypes: [],
            submitMinutes: 201.7,
            cpm: 38,
            charsTotal: 7700,
            maxSimilarity: 0,
            crossSchool: null,
            sharedRareAnswers: 0,
            similarPairs: [],
        },
    },
];

// จำลอง occupancy สำหรับทีม 2 — มีผู้ตรวจคนอื่นกำลังใช้งานอยู่
// lastActive เป็น Date.now() เพื่อให้ยัง fresh (< STALE_MS)
const FIXTURE_OCCUPANCY = {
    'demo_mixed2@gmail_com': {
        occupancy: {
            graderEmail: 'grader_demo@kku.ac.th',
            graderName: 'อ.สมศรี ทดสอบ',
            claimedAt: Date.now() - 30000,
            lastActive: Date.now() - 10000,
        },
        draft: null,
    },
};

/** คืน payload หน้าตาเดียวกับ _handleEssayQueue ใน 7_EssayGradingApi.js */
export function essayFixturePayload() {
    return {
        status: 'success',
        teams: FIXTURE_TEAMS.map(t => ({ ...t })),
        // ทีมที่ผ่านแล้วแต่ติดธง SEVERE — คนละกลุ่มกับคิวตรวจ Essay
        integrityReviewTeams: FIXTURE_INTEGRITY_REVIEW.map(t => ({ ...t })),
        essaySlots: ESSAY_SLOTS.map(s => ({ ...s })),
        integrityAvailable: true,
        integritySummary: INTEGRITY_SUMMARY,
        generatedAt: new Date().toLocaleString('th-TH'),
        isFixture: true,
    };
}

// ── Sheet View (ตารางอันดับแยกโควตา) ────────────────────────────────────────
// อันดับทั้งหมดต่อโควตา (ไม่ใช่แค่คิว Need Essay) เพื่อทดสอบตารางอันดับ
// สำคัญ: แถว colorKey==='NEED_ESSAY' ต้องใช้อีเมลเดียวกับ FIXTURE_TEAMS ด้านบน
// (demo.school1 / demo.school3 / demo.mixed2) ไม่งั้นคลิกเปิดตรวจไม่ได้ —
// selectTeam() หาไม่เจอในคิวแล้ว return เงียบ ๆ
// rank เว้นช่วง (1..3, 73..77, ...) เพื่อทดสอบเส้นแบ่งโควตากับข้อมูลห่าง ๆ
const FIXTURE_SCHOOL_ROSTER = [
    { rank: 1,   email: 'school.q1@gmail.com',    teamName: 'ทีมเรียนเก่งหนึ่ง',   schoolName: 'โรงเรียนตัวอย่างวิทยา', autoScore: 328, essayTotal: 0, totalScore: 328, verifyStatus: '',       qualifiedStatus: 'Qualified (Auto)',       colorKey: 'QUALIFIED' },
    { rank: 2,   email: 'school.q2@gmail.com',    teamName: 'ทีมเรียนเก่งสอง',    schoolName: 'โรงเรียนจำลองศึกษา',  autoScore: 322, essayTotal: 0, totalScore: 322, verifyStatus: '',       qualifiedStatus: 'Qualified (Auto)',       colorKey: 'QUALIFIED' },
    { rank: 3,   email: 'school.q3@gmail.com',    teamName: 'ทีมเรียนเก่งสาม',    schoolName: 'โรงเรียนสมมติพิทยา',  autoScore: 315, essayTotal: 0, totalScore: 315, verifyStatus: '',       qualifiedStatus: 'Qualified (Auto)',       colorKey: 'QUALIFIED' },
    // แถบคะแนนเท่ากันตรงเส้นแบ่ง (rank 73–77) — ต้องตรวจ Essay
    { rank: 73,  email: 'school.essayA@gmail.com', teamName: 'ทีมคะแนนเท่าเอ',     schoolName: 'โรงเรียนทดสอบศึกษา',  autoScore: 280, essayTotal: 0, totalScore: 280, verifyStatus: '',       qualifiedStatus: 'Need Essay Grading',     colorKey: 'NEED_ESSAY',
      integrity: { severity: 'SEVERE', flags: ['ส่งเร็วผิดปกติ (35 นาที)', 'อัตราพิมพ์สูงผิดปกติ (180 ตัว/นาที)'], flagTypes: ['speedrun', 'typing'], submitMinutes: 35, speedRank: 3, cpm: 180, charsTotal: 6300, maxSimilarity: 0, crossSchool: null, sharedRareAnswers: 0, speedFlagged: true, typingFlagged: true, markdownHits: 0, llmHits: 0, echoHits: 0, similarPairs: [] } },
    { rank: 74,  email: 'demo.school1@gmail.com',  teamName: 'ทีมสมมติหนึ่ง',      schoolName: 'โรงเรียนตัวอย่างวิทยา', autoScore: 280, essayTotal: 0, totalScore: 280, verifyStatus: '',       qualifiedStatus: 'Need Essay Grading',     colorKey: 'NEED_ESSAY',
      // ไม่มี markdownSlots โดยตั้งใจ — payload essaySheetView ไม่ได้ส่งคำตอบมาด้วย
      // เช็กลิสต์ต้องขึ้นว่า "ยังไม่ทราบว่าอยู่ข้อใด" ไม่ใช่ "ไม่พบ Markdown"
      integrity: { severity: 'WARN', flags: ['ร่องรอย Markdown ในคำตอบ (3 จุด)'], flagTypes: ['markdown'], submitMinutes: 120, cpm: 45, charsTotal: 5400, maxSimilarity: 0.72, crossSchool: true, sharedRareAnswers: 2, speedFlagged: false, typingFlagged: false, markdownHits: 3, llmHits: 0, echoHits: 0, similarPairs: [] } },
    { rank: 75,  email: 'demo.school3@gmail.com',  teamName: 'ทีมตัวอย่างสาม',      schoolName: 'โรงเรียนจำลองศึกษา',  autoScore: 280, essayTotal: 27, totalScore: 307, verifyStatus: 'Graded', qualifiedStatus: 'Need Essay Grading',     colorKey: 'NEED_ESSAY' },
    { rank: 76,  email: 'school.essayD@gmail.com', teamName: 'ทีมคะแนนเท่าดี',     schoolName: 'โรงเรียนสอบผ่านวิทยา', autoScore: 280, essayTotal: 0, totalScore: 280, verifyStatus: '',       qualifiedStatus: 'Need Essay Grading',     colorKey: 'NEED_ESSAY' },
    { rank: 77,  email: 'school.essayE@gmail.com', teamName: 'ทีมคะแนนเท่าอี',     schoolName: 'โรงเรียนใกล้เส้นศึกษา', autoScore: 280, essayTotal: 0, totalScore: 280, verifyStatus: '',       qualifiedStatus: 'Need Essay Grading',     colorKey: 'NEED_ESSAY' },
    // สำรอง (rank 78–85)
    { rank: 78,  email: 'school.res1@gmail.com',   teamName: 'ทีมสำรองหนึ่ง',      schoolName: 'โรงเรียนสำรองวิทยา',  autoScore: 275, essayTotal: 0, totalScore: 275, verifyStatus: '',       qualifiedStatus: 'Reserved',               colorKey: 'RESERVED' },
    { rank: 85,  email: 'school.res8@gmail.com',   teamName: 'ทีมสำรองแปด',        schoolName: 'โรงเรียนสำรองพิทยา',  autoScore: 268, essayTotal: 0, totalScore: 268, verifyStatus: '',       qualifiedStatus: 'Reserved',               colorKey: 'RESERVED' },
    // ไม่ผ่าน (rank 86+)
    { rank: 86,  email: 'school.nq1@gmail.com',    teamName: 'ทีมไม่ผ่านหนึ่ง',     schoolName: 'โรงเรียนไม่ผ่านศึกษา', autoScore: 260, essayTotal: 0, totalScore: 260, verifyStatus: '',       qualifiedStatus: 'Not Qualified',          colorKey: 'NOT_QUALIFIED' },
    // เกินโควตาโรงเรียน (Final Rank '-', สีแดงเข้ม)
    { rank: '-', email: 'school.oq1@gmail.com',    teamName: 'ทีมติดกฎโควตาโรงเรียน', schoolName: 'โรงเรียนตัวอย่างวิทยา', autoScore: 300, essayTotal: 0, totalScore: 300, verifyStatus: '',       qualifiedStatus: 'Reserved (Over Quota)',  colorKey: 'OVER_QUOTA' },
    // ทีมที่ถูกตัดสิทธิ์ (Disqualified)
    { rank: 5,   email: 'school.dq1@gmail.com',    teamName: 'ทีมถูกตัดสิทธิ์เอ',   schoolName: 'โรงเรียนตัดสิทธิ์ศึกษา', autoScore: 310, essayTotal: 0, totalScore: 310, verifyStatus: 'Verified', qualifiedStatus: 'Disqualified',         colorKey: 'DISQUALIFIED',
      eligibilityNote: 'ตัดสิทธิ์ (ทุจริต/ลอกข้อสอบ) — พบคำตอบ Essay ซ้ำกับทีมนอกโควตา 92%',
      decisionReviewer: 'admin@kkumail.com' },
];

const FIXTURE_MIXED_ROSTER = [
    { rank: 1,  email: 'mixed.q1@gmail.com',    teamName: 'ทีมผสมเก่งหนึ่ง',  schoolName: '', autoScore: 324, essayTotal: 0, totalScore: 324, verifyStatus: '', qualifiedStatus: 'Qualified (Auto)',   colorKey: 'QUALIFIED' },
    { rank: 2,  email: 'mixed.q2@gmail.com',    teamName: 'ทีมผสมเก่งสอง',   schoolName: '', autoScore: 318, essayTotal: 0, totalScore: 318, verifyStatus: '', qualifiedStatus: 'Qualified (Auto)',   colorKey: 'QUALIFIED' },
    // แถบคะแนนเท่ากันตรงเส้นแบ่ง (rank 23–27) — ต้องตรวจ Essay
    { rank: 23, email: 'mixed.essayA@gmail.com', teamName: 'ทีมผสมคะแนนเท่าเอ', schoolName: '', autoScore: 276, essayTotal: 0, totalScore: 276, verifyStatus: '', qualifiedStatus: 'Need Essay Grading', colorKey: 'NEED_ESSAY',
      integrity: { severity: 'SEVERE', flags: ['ส่งเร็วผิดปกติ (28 นาที)', 'โครงสร้างคำตอบสมมาตรเกินไป'], flagTypes: ['speedrun', 'structural'], submitMinutes: 28, speedRank: 1, cpm: 195, charsTotal: 5460, maxSimilarity: 0, crossSchool: null, sharedRareAnswers: 0, speedFlagged: true, typingFlagged: false, markdownHits: 0, llmHits: 0, echoHits: 0, similarPairs: [] } },
    { rank: 24, email: 'mixed.essayB@gmail.com', teamName: 'ทีมผสมคะแนนเท่าบี', schoolName: '', autoScore: 276, essayTotal: 0, totalScore: 276, verifyStatus: '', qualifiedStatus: 'Need Essay Grading', colorKey: 'NEED_ESSAY' },
    { rank: 25, email: 'demo.mixed2@gmail.com',  teamName: 'ทีมผสมสอง',       schoolName: '', autoScore: 276, essayTotal: 0, totalScore: 276, verifyStatus: '', qualifiedStatus: 'Need Essay Grading', colorKey: 'NEED_ESSAY' },
    { rank: 26, email: 'mixed.essayD@gmail.com', teamName: 'ทีมผสมคะแนนเท่าดี', schoolName: '', autoScore: 276, essayTotal: 0, totalScore: 276, verifyStatus: '', qualifiedStatus: 'Need Essay Grading', colorKey: 'NEED_ESSAY' },
    { rank: 27, email: 'mixed.essayE@gmail.com', teamName: 'ทีมผสมคะแนนเท่าอี', schoolName: '', autoScore: 276, essayTotal: 0, totalScore: 276, verifyStatus: '', qualifiedStatus: 'Need Essay Grading', colorKey: 'NEED_ESSAY' },
    // สำรอง (rank 28–35)
    { rank: 28, email: 'mixed.res1@gmail.com',   teamName: 'ทีมผสมสำรองหนึ่ง', schoolName: '', autoScore: 270, essayTotal: 0, totalScore: 270, verifyStatus: '', qualifiedStatus: 'Reserved',           colorKey: 'RESERVED' },
    { rank: 35, email: 'mixed.res8@gmail.com',   teamName: 'ทีมผสมสำรองแปด',   schoolName: '', autoScore: 262, essayTotal: 0, totalScore: 262, verifyStatus: '', qualifiedStatus: 'Reserved',           colorKey: 'RESERVED' },
    // ไม่ผ่าน (rank 36+)
    { rank: 36, email: 'mixed.nq1@gmail.com',    teamName: 'ทีมผสมไม่ผ่านหนึ่ง', schoolName: '', autoScore: 255, essayTotal: 0, totalScore: 255, verifyStatus: '', qualifiedStatus: 'Not Qualified',      colorKey: 'NOT_QUALIFIED' },
];

/** คืน payload หน้าตาเดียวกับ _handleEssaySheetView ใน 7_EssayGradingApi.js */
export function essaySheetViewFixture(quota) {
    const rows = quota === 'โรงเรียน' ? FIXTURE_SCHOOL_ROSTER : FIXTURE_MIXED_ROSTER;
    return {
        status: 'success',
        quota: quota,
        sheetName: quota === 'โรงเรียน' ? 'เรียงทีมโรงเรียน' : 'เรียงทีมผสม',
        rows: rows.map(r => ({ ...r })),
        generatedAt: new Date().toLocaleString('th-TH'),
        isFixture: true,
    };
}

/** คืน occupancy จำลอง (in-memory, ไม่แตะ Firebase) */
export function fixtureOccupancy() {
    // คืนสำเนาลึก + ปรับ lastActive ให้ fresh ทุกครั้ง
    const copy = {};
    for (const [k, v] of Object.entries(FIXTURE_OCCUPANCY)) {
        copy[k] = {
            occupancy: { ...v.occupancy, lastActive: Date.now() - 10000 },
            draft: v.draft ? { ...v.draft } : null,
        };
    }
    return copy;
}

// ── รายงานความผิดปกติ (Integrity Triage) ────────────────────────────────────
// หน้าตาเดียวกับ _handleIntegrityReport ใน 8_IntegrityTriage.js
// ของจริงอ่านจากชีต Integrity_Triage / Integrity_Similar_Pairs ที่เมนู GAS
// "ตรวจสอบความผิดปกติ" เขียนไว้ — ตัวเลขทุกตัวข้างล่างสมมติทั้งหมด
//
// สำคัญ: teams ที่นี่คือ "ทีมที่ถูกตั้งธงทั้ง cohort" ไม่ใช่แค่ทีมในคิวตรวจ Essay
// จึงมีทั้งทีมที่คลิกแล้วเปิดแผงตรวจได้ (อีเมลตรงกับ FIXTURE_TEAMS) และทีมที่
// คลิกแล้วขึ้น alert ว่าไม่อยู่ในคิว — ทั้งสองทางต้องทดสอบได้จาก fixture นี้

const INTEGRITY_SUMMARY = {
    teamsTotal: 815,
    flagged: 5,
    severe: 2,
    warn: 3,
    speedrun: 2,
    typing: 1,
    markdown: 2,
    llm: 2,
    similarPairs: 2,
    crossSchoolPairs: 1,
};

const INTEGRITY_FLAG_TYPES = [
    { key: 'speedrun', label: 'ส่งเร็วผิดปกติ' },
    { key: 'typing', label: 'อัตราพิมพ์สูงผิดปกติ' },
    { key: 'clump', label: 'ส่งพร้อมกันเป็นกลุ่ม' },
    { key: 'markdown', label: 'ร่องรอย Markdown' },
    { key: 'llm', label: 'สำนวน LLM' },
    { key: 'echo', label: 'ทวนโจทย์ (prompt echo)' },
    { key: 'structural', label: 'โครงสร้างคำตอบสมมาตรเกินไป' },
    { key: 'saq', label: 'คำตอบสั้นผิดธรรมชาติ' },
    { key: 'similarity', label: 'Essay ซ้ำกับทีมอื่น' },
    { key: 'rare', label: 'คำตอบหายากตรงกัน' },
];

const INTEGRITY_REPORT_TEAMS = [
    {
        // ผ่านโควตาแล้ว (Qualified (Auto)) แต่ติดธง 🔴 — ทดสอบกลุ่ม
        // integrityReviewTeams และปุ่ม "ดูหลักฐาน & ตัดสิน" กับทีมที่ไม่ได้อยู่ในคิว
        email: 'school.q3@gmail.com', teamName: 'ทีมเรียนเก่งสาม',
        schoolName: 'โรงเรียนตัวอย่างวิทยา', quota: 'โรงเรียน',
        severity: 'SEVERE', submitMinutes: 28.0, speedRank: 1, cpm: 233, charsTotal: 6520,
        clumpSize: 0, markdownHits: 0, llmHits: 0, echoHits: 0,
        structuralUniform: false, saqFlag: false,
        maxSimilarity: 0, crossSchool: null, sharedRareAnswers: 0, sharedRareTerms: 0,
        speedFlagged: true, typingFlagged: true, clumped: false,
        flagTypes: ['speedrun', 'typing'],
        flags: [
            'ส่งเร็วผิดปกติ (28.0 นาทีหลังเปิดฟอร์ม)',
            'อัตราพิมพ์สูงผิดปกติ (อย่างน้อย 233 ตัว/นาที)',
        ],
        similarPairs: [],
    },
    {
        // อยู่ในคิว — คลิกแล้วเปิดแผงตรวจได้
        email: 'demo.school1@gmail.com', teamName: 'ทีมสมมติหนึ่ง',
        schoolName: 'โรงเรียนตัวอย่างวิทยา', quota: 'โรงเรียน',
        severity: 'SEVERE', submitMinutes: 34.5, speedRank: 2, cpm: 151, charsTotal: 5210,
        clumpSize: 0, markdownHits: 4, llmHits: 0, echoHits: 0,
        structuralUniform: false, saqFlag: false,
        maxSimilarity: 0.88, crossSchool: true, sharedRareAnswers: 7, sharedRareTerms: 2,
        speedFlagged: true, typingFlagged: true, clumped: false,
        flagTypes: ['speedrun', 'typing', 'markdown', 'similarity', 'rare'],
        flags: [
            'ส่งเร็วผิดปกติ (34.5 นาทีหลังเปิดฟอร์ม)',
            'อัตราพิมพ์สูงผิดปกติ (อย่างน้อย 151 ตัว/นาที)',
            'ร่องรอย Markdown ในคำตอบ (4 จุด)',
            'Essay ซ้ำกับอีกทีม 88.0% (ต่างโรงเรียน)',
            'เลือกคำตอบหายากตรงกับอีกทีม 7 ข้อ',
        ],
        similarPairs: [
            { otherEmail: 'outside.teamx@gmail.com', otherTeamName: 'ทีมนอกคิวเอ็กซ์', similarity: 0.88, sharedRareAnswers: 7, sameSchool: false, severity: 'SEVERE' },
        ],
    },
    {
        // ไม่อยู่ในคิว — คลิกแล้วต้องขึ้น alert ว่าเปิดตรวจไม่ได้
        email: 'outside.teamx@gmail.com', teamName: 'ทีมนอกคิวเอ็กซ์',
        schoolName: 'โรงเรียนนอกคิวศึกษา', quota: 'โรงเรียน',
        severity: 'SEVERE', submitMinutes: 41.8, speedRank: 4, cpm: 96, charsTotal: 4010,
        clumpSize: 0, markdownHits: 0, llmHits: 0, echoHits: 0,
        structuralUniform: false, saqFlag: false,
        maxSimilarity: 0.88, crossSchool: true, sharedRareAnswers: 7, sharedRareTerms: 2,
        speedFlagged: true, typingFlagged: false, clumped: false,
        flagTypes: ['speedrun', 'similarity', 'rare'],
        flags: [
            'ส่งเร็วผิดปกติ (41.8 นาทีหลังเปิดฟอร์ม)',
            'Essay ซ้ำกับอีกทีม 88.0% (ต่างโรงเรียน)',
            'เลือกคำตอบหายากตรงกับอีกทีม 7 ข้อ',
        ],
        similarPairs: [
            { otherEmail: 'demo.school1@gmail.com', otherTeamName: 'ทีมสมมติหนึ่ง', similarity: 0.88, sharedRareAnswers: 7, sameSchool: false, severity: 'SEVERE' },
        ],
    },
    {
        email: 'demo.mixed2@gmail.com', teamName: 'ทีมผสมสอง',
        schoolName: '', quota: 'ผสม',
        severity: 'WARN', submitMinutes: 168.2, speedRank: 402, cpm: 44, charsTotal: 7400,
        clumpSize: 0, markdownHits: 0, llmHits: 3, echoHits: 0,
        structuralUniform: false, saqFlag: false,
        maxSimilarity: 0, crossSchool: null, sharedRareAnswers: 0, sharedRareTerms: 0,
        speedFlagged: false, typingFlagged: false, clumped: false,
        flagTypes: ['llm'],
        flags: ['สำนวนที่พบบ่อยในข้อความจาก LLM (3 จุด)'],
        similarPairs: [],
    },
    {
        // คู่ซ้ำ "โรงเรียนเดียวกัน" — ระดับ WARN ตามกติกาใน _itFinalizePairs
        email: 'outside.pairA@gmail.com', teamName: 'ทีมคู่ซ้ำเอ',
        schoolName: 'โรงเรียนจำลองศึกษา', quota: 'โรงเรียน',
        severity: 'WARN', submitMinutes: 152.4, speedRank: 331, cpm: 61, charsTotal: 9300,
        clumpSize: 3, markdownHits: 0, llmHits: 0, echoHits: 0,
        structuralUniform: false, saqFlag: false,
        maxSimilarity: 0.91, crossSchool: false, sharedRareAnswers: 4, sharedRareTerms: 1,
        speedFlagged: false, typingFlagged: false, clumped: true,
        flagTypes: ['clump', 'similarity'],
        flags: [
            'ส่งพร้อมกับทีมอื่นในกรอบเวลาเดียวกัน (3 ทีม)',
            'Essay ซ้ำกับอีกทีม 91.0% (โรงเรียนเดียวกัน)',
        ],
        similarPairs: [
            { otherEmail: 'outside.pairB@gmail.com', otherTeamName: 'ทีมคู่ซ้ำบี', similarity: 0.91, sharedRareAnswers: 4, sameSchool: true, severity: 'WARN' },
        ],
    },
    {
        email: 'outside.pairB@gmail.com', teamName: 'ทีมคู่ซ้ำบี',
        schoolName: 'โรงเรียนจำลองศึกษา', quota: 'โรงเรียน',
        severity: 'WARN', submitMinutes: 153.1, speedRank: 333, cpm: 58, charsTotal: 8880,
        clumpSize: 3, markdownHits: 2, llmHits: 0, echoHits: 0,
        structuralUniform: false, saqFlag: false,
        maxSimilarity: 0.91, crossSchool: false, sharedRareAnswers: 4, sharedRareTerms: 1,
        speedFlagged: false, typingFlagged: false, clumped: true,
        flagTypes: ['clump', 'markdown', 'similarity'],
        flags: [
            'ส่งพร้อมกับทีมอื่นในกรอบเวลาเดียวกัน (3 ทีม)',
            'ร่องรอย Markdown ในคำตอบ (2 จุด)',
            'Essay ซ้ำกับอีกทีม 91.0% (โรงเรียนเดียวกัน)',
        ],
        similarPairs: [
            { otherEmail: 'outside.pairA@gmail.com', otherTeamName: 'ทีมคู่ซ้ำเอ', similarity: 0.91, sharedRareAnswers: 4, sameSchool: true, severity: 'WARN' },
        ],
    },
];

const INTEGRITY_REPORT_PAIRS = [
    {
        severity: 'SEVERE', similarity: 0.88, sharedRareAnswers: 7, sharedRareTerms: 2, sameSchool: false,
        aEmail: 'demo.school1@gmail.com', aTeamName: 'ทีมสมมติหนึ่ง',
        bEmail: 'outside.teamx@gmail.com', bTeamName: 'ทีมนอกคิวเอ็กซ์',
        topSlot: '2.1', topSlotSimilarity: 0.93,
    },
    {
        severity: 'WARN', similarity: 0.91, sharedRareAnswers: 4, sharedRareTerms: 1, sameSchool: true,
        aEmail: 'outside.pairA@gmail.com', aTeamName: 'ทีมคู่ซ้ำเอ',
        bEmail: 'outside.pairB@gmail.com', bTeamName: 'ทีมคู่ซ้ำบี',
        topSlot: '1.2', topSlotSimilarity: 0.95,
    },
];

// เติม metadata ของทีมคู่เทียบ (ข้อที่ซ้ำมากที่สุด / โรงเรียน / เวลาส่ง / Δt) แบบ
// เดียวกับที่ _itBuildIntegrityIndex() ทำหลังสร้าง byEmail — เขียนเป็นรอบเดียวแทน
// การก๊อปฟิลด์เดิมลงทุกคู่ ทั้งรายงานและหน้าต่างหลักฐานจึงได้ข้อมูลชุดเดียวกัน
(() => {
    const byEmail = new Map(INTEGRITY_REPORT_TEAMS.map(t => [t.email, t]));
    const pairOf = (a, b) => INTEGRITY_REPORT_PAIRS.find(x =>
        (x.aEmail === a && x.bEmail === b) || (x.aEmail === b && x.bEmail === a));
    INTEGRITY_REPORT_TEAMS.forEach(t => {
        t.similarPairs.forEach(p => {
            const other = byEmail.get(p.otherEmail);
            const pair = pairOf(t.email, p.otherEmail);
            p.topSlot = pair ? pair.topSlot : '';
            p.topSlotSimilarity = pair ? pair.topSlotSimilarity : 0;
            p.otherSchoolName = other ? other.schoolName : '';
            p.otherQuota = other ? other.quota : '';
            p.otherSubmitMinutes = other ? other.submitMinutes : null;
            p.deltaMinutes = other
                ? Number(Math.abs(other.submitMinutes - t.submitMinutes).toFixed(1)) : null;
        });
    });
})();

/** คืน payload หน้าตาเดียวกับ _handleIntegrityReport ใน 8_IntegrityTriage.js */
export function essayIntegrityReportFixture() {
    return {
        status: 'success',
        available: true,
        summary: { ...INTEGRITY_SUMMARY },
        flagTypes: INTEGRITY_FLAG_TYPES.map(f => ({ ...f })),
        thresholds: {
            speedrunFloorMin: 45,
            speedrunSevereMin: 30,
            cpmWatch: 150,
            cpmImpossible: 200,
            similarityFlag: 0.80,
            similaritySevere: 0.90,
        },
        teams: INTEGRITY_REPORT_TEAMS.map(t => ({ ...t, similarPairs: t.similarPairs.map(p => ({ ...p })) })),
        pairs: INTEGRITY_REPORT_PAIRS.map(p => ({ ...p })),
        caveat: 'เกณฑ์คัดกรองเบื้องต้นเท่านั้น — ใช้เพื่อ "เพ่งเล็งเป็นพิเศษ" ตอนตรวจ Essay ' +
            'ห้ามใช้ตัดสิทธิ์อัตโนมัติ และห้ามใช้ข้อกล่าวหา "ใช้ AI" เพียงลำพัง',
        generatedAt: new Date().toLocaleString('th-TH'),
        isFixture: true,
    };
}

// ── หลักฐาน & การตัดสิน (Integrity Evidence) ────────────────────────────────
// ตัวอย่างสำหรับ ?action=getIntegrityEvidence เพื่อทดสอบหน้าต่างหลักฐานก่อนมี
// ข้อมูลจริง. ทีม demo.school1 กับ outside.teamx ถูกเขียนให้มีย่อหน้าที่ตรงกัน
// แบบคำต่อคำ (และย่อหน้าที่ต่างกันคั่น) เพื่อให้เห็นทั้งช่วงที่ไฮไลต์และไม่ไฮไลต์
//
// ช่วงไฮไลต์คำนวณด้วยสูตรเดียวกับฝั่ง server (_itSharedGramRanges) แทนการ
// hard-code ตัวเลข index — index ที่พิมพ์มือบนข้อความไทยผิดง่ายและตรวจไม่เจอ

const EV_NGRAM = 3;

/** สำเนา _itNormText() ของ 8_IntegrityTriage.js — ต้องตรงกันเป๊ะ */
const evNorm = (s) => String(s || '')
    .toLowerCase()
    .replace(/[\s ]+/g, '')
    .replace(/[.,;:!?()\[\]{}"'`~\-_/\\|*#]/g, '');

/** สำเนา _itNormWithMap() */
function evNormWithMap(str) {
    let text = '';
    const map = [];
    for (let i = 0; i < str.length; i++) {
        const c = evNorm(str.charAt(i));
        if (c) { text += c; map.push(i); }
    }
    return { text, map };
}

/** สำเนา _itSharedGramRanges() — รวมช่วงใน normalised space แล้ว map กลับ */
function evSharedRanges(aText, bText) {
    const a = evNormWithMap(aText), b = evNormWithMap(bText);
    if (a.text.length < EV_NGRAM || b.text.length < EV_NGRAM) return [];
    const bGrams = new Set();
    for (let i = 0; i + EV_NGRAM <= b.text.length; i++) bGrams.add(b.text.substr(i, EV_NGRAM));
    const mark = [];
    for (let i = 0; i + EV_NGRAM <= a.text.length; i++) {
        if (bGrams.has(a.text.substr(i, EV_NGRAM))) {
            for (let j = i; j < i + EV_NGRAM; j++) mark[j] = true;
        }
    }
    const runs = [];
    for (let k = 0; k < a.map.length; k++) {
        if (!mark[k]) continue;
        const last = runs[runs.length - 1];
        if (last && k === last.to + 1) last.to = k;
        else runs.push({ from: k, to: k });
    }
    return runs.map(r => ({ start: a.map[r.from], end: a.map[r.to] + 1 }));
}

/** Jaccard บนชุด n-gram — สำเนา _itJaccard() แบบย่อ */
function evJaccard(aText, bText) {
    const grams = (t) => {
        const n = evNorm(t), set = new Set();
        for (let i = 0; i + EV_NGRAM <= n.length; i++) set.add(n.substr(i, EV_NGRAM));
        return set;
    };
    const A = grams(aText), B = grams(bText);
    if (!A.size || !B.size) return 0;
    let inter = 0;
    A.forEach(g => { if (B.has(g)) inter++; });
    return Number((inter / (A.size + B.size - inter)).toFixed(4));
}

// คำตอบสมมติของทีมคู่เทียบ — ข้อ 1.1 / 2.1 เขียนให้ตรงกับ demo.school1 เกือบทั้ง
// ย่อหน้า ส่วนข้ออื่นเขียนใหม่หมด เพื่อให้เห็นความต่างระหว่างข้อที่ซ้ำกับไม่ซ้ำ
const EV_OUTSIDE_ESSAYS = [
    'ภาวะไตขาดเลือดกระตุ้นให้ juxtaglomerular cell หลั่ง renin ออกมา renin เปลี่ยน angiotensinogen เป็น angiotensin I แล้วถูก ACE เปลี่ยนต่อเป็น angiotensin II ซึ่งทำให้หลอดเลือดหดตัวและกระตุ้นการหลั่ง aldosterone ผลรวมคือความดันโลหิตสูงขึ้น',
    'ยา beta-blocker ลดอัตราการเต้นของหัวใจ ส่วน calcium channel blocker ทำให้หลอดเลือดคลายตัว จึงเลือกใช้ต่างกันตามภาวะของผู้ป่วยแต่ละราย',
    'intrinsic pathway เริ่มจากการสัมผัสผิวที่มีประจุลบ ทำให้ factor XII ถูกกระตุ้น ตามด้วย factor XI factor IX และ factor VIII จนได้ factor X ที่ทำงาน แล้วเข้าสู่ common pathway ต่อไป',
    'เบาหวานชนิดที่ 1 เกิดจากภูมิคุ้มกันทำลายเบตาเซลล์ ทำให้ขาดอินซูลินอย่างสิ้นเชิง ผู้ป่วยจึงมีอาการดื่มน้ำมาก ปัสสาวะบ่อย และน้ำหนักลด',
    'penicillin ยับยั้งเอนไซม์ transpeptidase ที่ใช้เชื่อม peptidoglycan ของผนังเซลล์แบคทีเรีย เซลล์มนุษย์ไม่มีผนังชนิดนี้ ยาจึงออกฤทธิ์เฉพาะกับแบคทีเรีย',
    'innate immunity ตอบสนองทันทีและไม่จำเพาะ ส่วน adaptive immunity ใช้เวลาสร้างแต่จำเพาะและมีความจำ',
];

// คำตอบของทีมที่ถูกพิจารณา — ให้ข้อ 1.1 กับ 2.1 ตรงกับคู่เทียบเกือบทั้งย่อหน้า
// และแทรกร่องรอย Markdown / สำนวน LLM / การทวนโจทย์ ไว้ให้ทดสอบไฮไลต์ครบทุกสี
const EV_TARGET_ESSAYS = [
    'ภาวะไตขาดเลือดกระตุ้นให้ juxtaglomerular cell หลั่ง renin ออกมา renin เปลี่ยน angiotensinogen เป็น angiotensin I แล้วถูก ACE เปลี่ยนต่อเป็น angiotensin II ซึ่งทำให้หลอดเลือดหดตัวและกระตุ้นการหลั่ง aldosterone ผลรวมคือความดันโลหิตสูงขึ้น\n\n**สรุป** กลไกนี้เป็นเป้าหมายของยากลุ่ม ACE inhibitor',
    'คำถาม: เปรียบเทียบ beta-blocker กับ calcium channel blocker\nตอบ: beta-blocker ลดแรงบีบตัวและอัตราการเต้นของหัวใจ ส่วน calcium channel blocker ออกฤทธิ์คลายกล้ามเนื้อเรียบของหลอดเลือด\n- ข้อบ่งใช้ต่างกันตามภาวะผู้ป่วย\n- ผลข้างเคียงต่างกัน',
    'intrinsic pathway เริ่มจากการสัมผัสผิวที่มีประจุลบ ทำให้ factor XII ถูกกระตุ้น ตามด้วย factor XI factor IX และ factor VIII จนได้ factor X ที่ทำงาน แล้วเข้าสู่ common pathway ต่อไป โดยมี calcium และ phospholipid เป็นปัจจัยร่วม',
    'เบาหวานชนิดที่ 1 เกิดจากการทำลายเบตาเซลล์ของตับอ่อนโดยระบบภูมิคุ้มกันของร่างกายเอง ส่งผลให้ร่างกายขาดอินซูลิน',
    'penicillin จับกับ penicillin-binding protein แล้วยับยั้งการสร้างผนังเซลล์ของแบคทีเรีย\n\nin summary, ยานี้จึงมีความจำเพาะสูงต่อแบคทีเรีย',
    'innate immunity ทำงานทันทีโดยไม่ต้องเคยพบเชื้อมาก่อน ขณะที่ adaptive immunity สร้างความจำทางภูมิคุ้มกันไว้ใช้ครั้งต่อไป',
];

/** hit ของ Markdown / สำนวน LLM / การทวนโจทย์ — หา offset จริงบนข้อความสมมติ */
function evPatternHits(text) {
    const lib = [
        { kind: 'markdown', name: 'bold-markdown', re: /\*\*[^*\n]+\*\*/g },
        { kind: 'markdown', name: 'bullet-list', re: /(^|\n)\s*[-*•]\s+\S/g },
        { kind: 'llm', name: 'en-in-summary', needle: 'in summary,' },
        { kind: 'echo', name: 'th-echo-question2', needle: 'คำถาม:' },
        { kind: 'echo', name: 'th-echo-answer2', needle: 'ตอบ:' },
    ];
    const out = [];
    const lower = text.toLowerCase();
    lib.forEach(p => {
        if (p.re) {
            let m;
            const re = new RegExp(p.re.source, 'g');
            while ((m = re.exec(text)) !== null) {
                if (!m[0].length) { re.lastIndex++; continue; }
                out.push({ kind: p.kind, name: p.name, start: m.index, end: m.index + m[0].length });
            }
        } else {
            let from = 0, i;
            while ((i = lower.indexOf(p.needle, from)) !== -1) {
                out.push({ kind: p.kind, name: p.name, start: i, end: i + p.needle.length });
                from = i + p.needle.length;
            }
        }
    });
    return out.sort((a, b) => a.start - b.start);
}

// ทีมที่ผ่านแล้วแต่ติดธง SEVERE — กลุ่ม integrityReviewTeams ของ _handleEssayQueue
const FIXTURE_INTEGRITY_REVIEW = [
    {
        email: 'school.q3@gmail.com',
        teamName: 'ทีมเรียนเก่งสาม',
        schoolName: 'โรงเรียนตัวอย่างวิทยา',
        quota: 'โรงเรียน',
        sheetName: 'เรียงทีมโรงเรียน',
        autoScore: 318,
        essayAnswers: EV_TARGET_ESSAYS.slice(),
        currentScores: [0, 0, 0, 0, 0, 0],
        verifyStatus: '',
        qualifiedStatus: 'Qualified (Auto)',
        queueGroup: 'integrity',
        integrity: {
            severity: 'SEVERE',
            flags: [
                'ส่งเร็วผิดปกติ (28.0 นาทีหลังเปิดฟอร์ม)',
                'อัตราพิมพ์สูงผิดปกติ (อย่างน้อย 233 ตัว/นาที)',
            ],
            flagTypes: ['speedrun', 'typing'],
            submitMinutes: 28.0,
            speedRank: 1,
            cpm: 233,
            charsTotal: 6520,
            maxSimilarity: 0,
            crossSchool: null,
            sharedRareAnswers: 0,
            speedFlagged: true,
            typingFlagged: true,
            markdownHits: 0,
            llmHits: 0,
            echoHits: 0,
            markdownSlots: [],
            similarPairs: [],
        },
    },
];

/** สร้าง payload หน้าตาเดียวกับ _handleIntegrityEvidence ใน 8_IntegrityTriage.js */
export function essayEvidenceFixture(email) {
    const t = INTEGRITY_REPORT_TEAMS.find(x => x.email === email);
    const roster = [...FIXTURE_SCHOOL_ROSTER, ...FIXTURE_MIXED_ROSTER].find(r => r.email === email);
    if (!t && !roster) {
        return { status: 'success', available: false, message: 'ไม่พบทีมนี้ในรายงาน (fixture)' };
    }

    // ทีมที่มีคู่เทียบใช้คำตอบชุดเต็ม ทีมอื่นใช้ชุดเดียวกันแต่ไม่มี diff
    const mine = EV_TARGET_ESSAYS;
    const scores = [0, 0, 0, 0, 0, 0];

    const excerpts = ESSAY_SLOTS.map((slot, i) => ({
        label: slot.label,
        max: slot.max,
        score: scores[i],
        chars: mine[i].length,
        text: mine[i],
        hits: evPatternHits(mine[i]),
    }));

    const diffs = (t?.similarPairs || [])
        .filter(p => p.similarity >= 0.80)
        .map(p => ({
            pairId: [email, p.otherEmail].sort().join('|'),
            otherEmail: p.otherEmail,
            otherTeamName: p.otherTeamName,
            otherSchoolName: p.otherSchoolName,
            otherFound: true,
            similarity: p.similarity,
            sameSchool: p.sameSchool,
            severity: p.severity,
            sharedRareAnswers: p.sharedRareAnswers,
            topSlot: p.topSlot,
            topSlotSimilarity: p.topSlotSimilarity,
            otherSubmitMinutes: p.otherSubmitMinutes,
            deltaMinutes: p.deltaMinutes,
            // ตัดข้อที่คำตอบสั้นกว่าเกณฑ์ MIN_CHARS_PER_SLOT ออก เหมือนฝั่ง server
            slots: ESSAY_SLOTS
                .map((slot, i) => ({ slot, i }))
                .filter(({ i }) => mine[i].length >= 40 && EV_OUTSIDE_ESSAYS[i].length >= 40)
                .map(({ slot, i }) => ({
                    label: slot.label,
                    similarity: evJaccard(mine[i], EV_OUTSIDE_ESSAYS[i]),
                    aRanges: evSharedRanges(mine[i], EV_OUTSIDE_ESSAYS[i]),
                    bText: EV_OUTSIDE_ESSAYS[i],
                    bRanges: evSharedRanges(EV_OUTSIDE_ESSAYS[i], mine[i]),
                })),
        }));

    // ทีมที่ไม่ติดธง (ไม่อยู่ใน INTEGRITY_REPORT_TEAMS) — ใช้ข้อมูลเฉพาะเจาะจงจาก roster
    // ให้ตัวเลขสมมติที่ "ปกติ" (ตรงกลาง cohort, ไม่มีธง)
    const isFlagged = !!t;
    const cleanDefaults = {
        severity: 'NONE',
        flags: [],
        flagTypes: [],
        submitMinutes: 180,
        speedRank: roster?.rank || 0,
        cpm: 38,
        charsTotal: 5800,
        speedFlagged: false,
        typingFlagged: false,
        similarPairs: [],
    };
    const eff = t || cleanDefaults;

    return {
        status: 'success',
        available: true,
        team: {
            email,
            teamName: t?.teamName || roster?.teamName || '',
            schoolName: t?.schoolName || roster?.schoolName || '',
            quota: t?.quota || (roster && roster.schoolName ? 'โรงเรียน' : 'ผสม'),
            sheetName: (t?.quota || (roster && roster.schoolName ? 'โรงเรียน' : 'ผสม')) === 'โรงเรียน'
                ? 'เรียงทีมโรงเรียน' : 'เรียงทีมผสม',
            severity: eff.severity,
            flags: eff.flags,
            flagTypes: eff.flagTypes,
            autoScore: roster?.autoScore || 280,
            essayTotal: roster?.essayTotal || 0,
            finalRank: roster?.rank ?? '-',
            qualifiedStatus: roster?.qualifiedStatus || 'Need Essay Grading',
            verifyStatus: roster?.verifyStatus || '',
        },
        timing: {
            submitMinutes: eff.submitMinutes,
            speedRank: eff.speedRank,
            percentile: isFlagged ? 0.4 : 50,
            cohort: { n: 815, p5: 73.6, q1: 136.6, median: 181.3, q3: 214.0 },
            floorMin: 45,
            severeMin: 30,
            flagged: eff.speedFlagged,
        },
        typing: {
            cpm: eff.cpm,
            charsTotal: eff.charsTotal,
            percentile: isFlagged ? 99.1 : 50,
            cohort: { n: 815, median: 38, q3: 57, p95: 96 },
            watch: 150,
            impossible: 200,
            flagged: eff.typingFlagged,
        },
        excerpts,
        diffs,
        similarityFlag: 0.80,
        similaritySevere: 0.90,
        caveat: 'หลักฐานประกอบการพิจารณาของกรรมการเท่านั้น — ตัวเลขทุกตัวเป็นเกณฑ์คัดกรอง ' +
            'ไม่ใช่ข้อพิสูจน์ และห้ามใช้ข้อกล่าวหา "ใช้ AI" เพียงลำพังในการตัดสิทธิ์',
        generatedAt: new Date().toLocaleString('th-TH'),
        isFixture: true,
    };
}
