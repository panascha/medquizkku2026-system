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
        essaySlots: ESSAY_SLOTS.map(s => ({ ...s })),
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
    { rank: 73,  email: 'school.essayA@gmail.com', teamName: 'ทีมคะแนนเท่าเอ',     schoolName: 'โรงเรียนทดสอบศึกษา',  autoScore: 280, essayTotal: 0, totalScore: 280, verifyStatus: '',       qualifiedStatus: 'Need Essay Grading',     colorKey: 'NEED_ESSAY' },
    { rank: 74,  email: 'demo.school1@gmail.com',  teamName: 'ทีมสมมติหนึ่ง',      schoolName: 'โรงเรียนตัวอย่างวิทยา', autoScore: 280, essayTotal: 0, totalScore: 280, verifyStatus: '',       qualifiedStatus: 'Need Essay Grading',     colorKey: 'NEED_ESSAY' },
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
];

const FIXTURE_MIXED_ROSTER = [
    { rank: 1,  email: 'mixed.q1@gmail.com',    teamName: 'ทีมผสมเก่งหนึ่ง',  schoolName: '', autoScore: 324, essayTotal: 0, totalScore: 324, verifyStatus: '', qualifiedStatus: 'Qualified (Auto)',   colorKey: 'QUALIFIED' },
    { rank: 2,  email: 'mixed.q2@gmail.com',    teamName: 'ทีมผสมเก่งสอง',   schoolName: '', autoScore: 318, essayTotal: 0, totalScore: 318, verifyStatus: '', qualifiedStatus: 'Qualified (Auto)',   colorKey: 'QUALIFIED' },
    // แถบคะแนนเท่ากันตรงเส้นแบ่ง (rank 23–27) — ต้องตรวจ Essay
    { rank: 23, email: 'mixed.essayA@gmail.com', teamName: 'ทีมผสมคะแนนเท่าเอ', schoolName: '', autoScore: 276, essayTotal: 0, totalScore: 276, verifyStatus: '', qualifiedStatus: 'Need Essay Grading', colorKey: 'NEED_ESSAY' },
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
