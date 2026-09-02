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
