// js/dashboard-fixture.js
//
// ข้อมูลตัวอย่างสำหรับพัฒนา/ทดสอบหน้า Dashboard แบบไม่ต่อ API จริง
//
// ทำไมต้องมี: ชีต "Final 100 ทีม" ยังไม่มีข้อมูลจริงเลย (รอบ 0 สอบ 12 ก.ย. 2569)
// จึงทดสอบหน้าเว็บกับข้อมูลจริงไม่ได้ และ **ห้าม** เขียนข้อมูลตัวอย่างลงชีตจริง
// ไฟล์นี้จึงจำลอง payload ที่ 6_DashboardApi.js → doGet() ส่งกลับมาแทน
//
// ใช้เมื่อ DASHBOARD_API_URL ว่าง หรือเปิดหน้าด้วย ?fixture=1
// ชื่อ/โรงเรียน/โรค เป็นข้อมูลสมมติทั้งหมด

// สำเนาของ DASH_DEPT_COLS ใน 6_DashboardApi.js — ใช้เฉพาะโหมดตัวอย่างเท่านั้น
// (ของจริงหัวคอลัมน์มาจาก API เสมอ ถ้าสองที่ไม่ตรงกันให้ยึดฝั่ง GAS)
const FIXTURE_IDENTITY = ['Team ID', 'Team Category', 'Team Name', 'School Name', 'Email Address'];

const FIXTURE_DEPT_COLS = {
    overview: ['Advisor Name', 'Advisor Joining? (Yes/No)', 'Line_Joined_Status',
        'Payment_Verification_Status', 'On-site_Check-in_Status', 'หมายเหตุ (Remark)'],
    registration: ['Member 1 Name', 'Member 2 Name', 'Member 3 Name', 'Advisor Name',
        'Advisor Joining? (Yes/No)', 'Team Photo Link', 'Line_Joined_Status', 'หมายเหตุ (Remark)'],
    finance: ['Payment_Slip_Link', 'Transfer_Bank', 'Transfer_Account_Name',
        'Advisor_Welfare_Opted_In (+200)', 'Advisor_Welfare_Slip_Link', 'School_Tax_ID',
        'School_Address_for_Receipt', 'Combined_Receipt? (รวมใบเสร็จไหม)', 'ยอดเงินที่ต้องชำระ',
        'ยอดเงินที่โอนจริง', 'Transfer_Date_Time', 'Payment_Verification_Status', 'Verified_By',
        'On-site_Check-in_Status', 'หมายเหตุ (Remark)'],
    firstaid: ['Member 1 Name', 'Member 2 Name', 'Member 3 Name', 'Advisor Name',
        'Chronic_Disease_Summary', 'Medicine_Allergy_Summary', 'M1_Disease_Medication',
        'M2_Disease_Medication', 'M3_Disease_Medication', 'Advisor_Disease_Medication',
        'M1_Chronic_Disease', 'M1_Medicine_Allergy', 'M2_Chronic_Disease', 'M2_Medicine_Allergy',
        'M3_Chronic_Disease', 'M3_Medicine_Allergy', 'Advisor_Chronic_Disease', 'Advisor_Medicine_Allergy'],
    food: ['Member 1 Name', 'Member 2 Name', 'Member 3 Name', 'Advisor Name',
        'Food_Allergy_Summary', 'M1_Food_Allergy', 'M1_Diet_Request', 'M2_Food_Allergy',
        'M2_Diet_Request', 'M3_Food_Allergy', 'M3_Diet_Request', 'Advisor_Food_Allergy',
        'Advisor_Diet_Request'],
    coordination: ['Advisor Name', 'Advisor Joining? (Yes/No)', 'Advisor_Welfare_Opted_In (+200)',
        'Prayer_Room_Request (ช/ญ)', 'M1_Prayer_Room', 'M2_Prayer_Room', 'M3_Prayer_Room',
        'Certificate_Type (Hardcopy/Digital)', 'Team Photo Link', 'Line_Joined_Status',
        'On-site_Check-in_Status', 'หมายเหตุ (Remark)'],
};

const FIXTURE_MANUAL = ['ยอดเงินที่ต้องชำระ', 'ยอดเงินที่โอนจริง', 'Transfer_Date_Time',
    'Payment_Verification_Status', 'Verified_By', 'On-site_Check-in_Status'];

const FIXTURE_TEAMS = [
    {
        'Team ID': 'MQ001', 'Team Category': 'โควตาทีมโรงเรียน', 'Team Name': 'ทีมทดสอบหนึ่ง',
        'School Name': 'โรงเรียนตัวอย่างวิทยา', 'Email Address': 'demo.team01@gmail.com',
        'Member 1 Name': 'นายสมชาย ทดสอบ', 'Member 2 Name': 'นางสาวสมหญิง ตัวอย่าง',
        'Member 3 Name': 'นายสมศักดิ์ จำลอง', 'Advisor Name': 'อ.สมปอง ครูตัวอย่าง',
        'Advisor Joining? (Yes/No)': 'เข้าร่วม', 'Team Photo Link': 'https://example.invalid/photo1',
        'Line_Joined_Status': 'เข้าร่วมแล้ว', 'หมายเหตุ (Remark)': '',
        'Payment_Slip_Link': 'https://example.invalid/slip1', 'Transfer_Bank': '2301875048',
        'Transfer_Account_Name': 'สมชาย ทดสอบ', 'Advisor_Welfare_Opted_In (+200)': 'ประสงค์รับ',
        'Advisor_Welfare_Slip_Link': 'https://example.invalid/slip1b',
        'School_Tax_ID': '0994000000001', 'School_Address_for_Receipt': '123 ถ.ตัวอย่าง จ.ขอนแก่น',
        'Combined_Receipt? (รวมใบเสร็จไหม)': 'รวมได้', 'ยอดเงินที่ต้องชำระ': '1400',
        'ยอดเงินที่โอนจริง': '1400', 'Transfer_Date_Time': '2026-09-29 18:20',
        'Payment_Verification_Status': 'ตรวจสอบแล้ว', 'Verified_By': 'staff01@kku.ac.th',
        'Chronic_Disease_Summary': 'M1: หอบหืด', 'Medicine_Allergy_Summary': 'M2: Penicillin',
        'M1_Disease_Medication': 'โรค: หอบหืด', 'M2_Disease_Medication': 'ยา: Penicillin',
        'M3_Disease_Medication': '', 'Advisor_Disease_Medication': '',
        'M1_Chronic_Disease': 'หอบหืด', 'M1_Medicine_Allergy': 'ไม่มี',
        'M2_Chronic_Disease': 'ไม่มี', 'M2_Medicine_Allergy': 'Penicillin',
        'M3_Chronic_Disease': 'ไม่มี', 'M3_Medicine_Allergy': 'ไม่มี',
        'Advisor_Chronic_Disease': 'ไม่มี', 'Advisor_Medicine_Allergy': 'ไม่มี',
        'Food_Allergy_Summary': 'M1: กุ้ง', 'M1_Food_Allergy': 'กุ้ง', 'M1_Diet_Request': 'ทั่วไป',
        'M2_Food_Allergy': 'ไม่มี', 'M2_Diet_Request': 'ทั่วไป', 'M3_Food_Allergy': 'ไม่มี',
        'M3_Diet_Request': 'มังสวิรัติ', 'Advisor_Food_Allergy': 'ไม่มี', 'Advisor_Diet_Request': 'ทั่วไป',
        'Prayer_Room_Request (ช/ญ)': '', 'M1_Prayer_Room': 'ไม่', 'M2_Prayer_Room': 'ไม่',
        'M3_Prayer_Room': 'ไม่', 'Certificate_Type (Hardcopy/Digital)': 'Digital',
        'On-site_Check-in_Status': '',
    },
    {
        'Team ID': 'MQ002', 'Team Category': 'โควตาทีมผสม', 'Team Name': 'ทีมทดสอบสอง',
        'School Name': 'โรงเรียนสมมติศึกษา', 'Email Address': 'demo.team02@gmail.com',
        'Member 1 Name': 'นางสาวมานี สมมติ', 'Member 2 Name': 'นายมานะ ทดลอง',
        'Member 3 Name': 'นางสาวปิติ ตัวอย่าง', 'Advisor Name': 'อ.วิชัย สมมติ',
        'Advisor Joining? (Yes/No)': 'ไม่เข้าร่วม', 'Team Photo Link': '',
        'Line_Joined_Status': 'ยังไม่เข้าร่วม', 'หมายเหตุ (Remark)': '⚠️ ไม่พบในรายชื่อผู้ผ่านคัดเลือก (ตรวจสอบอีเมล/สถานะ)',
        'Payment_Slip_Link': 'https://example.invalid/slip2', 'Transfer_Bank': '2301875048',
        'Transfer_Account_Name': 'มานี สมมติ', 'Advisor_Welfare_Opted_In (+200)': 'ไม่ประสงค์รับ',
        'Advisor_Welfare_Slip_Link': '', 'School_Tax_ID': '', 'School_Address_for_Receipt': '',
        'Combined_Receipt? (รวมใบเสร็จไหม)': 'ไม่รวม', 'ยอดเงินที่ต้องชำระ': '1200',
        'ยอดเงินที่โอนจริง': '', 'Transfer_Date_Time': '', 'Payment_Verification_Status': '',
        'Verified_By': '', 'Chronic_Disease_Summary': '', 'Medicine_Allergy_Summary': '',
        'M1_Disease_Medication': '', 'M2_Disease_Medication': '', 'M3_Disease_Medication': '',
        'Advisor_Disease_Medication': '', 'M1_Chronic_Disease': 'ไม่มี', 'M1_Medicine_Allergy': 'ไม่มี',
        'M2_Chronic_Disease': 'ไม่มี', 'M2_Medicine_Allergy': 'ไม่มี',
        // สมาชิก 3 มีชื่อในทีมแต่ยังไม่ได้กรอกข้อมูลสุขภาพ/อาหารเลย — เคสที่ทำให้
        // ฝ่ายพยาบาลและฝ่ายอาหารเห็นทีมนี้ในกล่อง "ต้องแก้ไขด่วน"
        //
        // คอลัมน์ *_Summary ด้านล่างยังถูกต้องอยู่: _welfareSummary() ใน
        // 4_FinalConsolidator.js ข้ามคนที่ _isNone() ซึ่งนับค่าว่างเหมือน "ไม่มี"
        // ค่าว่างของ M3 จึงหายไปจากคอลัมน์สรุปแบบเดียวกับที่ระบบจริงทำ
        // (ไม่ใช่สถานะที่เกิดขึ้นจริงไม่ได้)
        'M3_Chronic_Disease': '', 'M3_Medicine_Allergy': '',
        'Advisor_Chronic_Disease': '', 'Advisor_Medicine_Allergy': '',
        'Food_Allergy_Summary': 'M2: นมวัว', 'M1_Food_Allergy': 'ไม่มี', 'M1_Diet_Request': 'ฮาลาล',
        'M2_Food_Allergy': 'นมวัว', 'M2_Diet_Request': 'ฮาลาล', 'M3_Food_Allergy': '',
        'M3_Diet_Request': '', 'Advisor_Food_Allergy': '', 'Advisor_Diet_Request': '',
        'Prayer_Room_Request (ช/ญ)': 'M1: ต้องการ, M2: ต้องการ', 'M1_Prayer_Room': 'ต้องการ',
        'M2_Prayer_Room': 'ต้องการ', 'M3_Prayer_Room': 'ไม่', 'Certificate_Type (Hardcopy/Digital)': 'Hardcopy',
        'On-site_Check-in_Status': '',
    },
    {
        'Team ID': 'MQ003', 'Team Category': 'โควตาทีมโรงเรียน', 'Team Name': 'ทีมทดสอบสาม',
        'School Name': 'โรงเรียนตัวอย่างวิทยา', 'Email Address': 'demo.team03@gmail.com',
        'Member 1 Name': 'นายชูใจ ทดสอบ', 'Member 2 Name': 'นางสาวใจดี ตัวอย่าง',
        'Member 3 Name': '', 'Advisor Name': 'อ.สมปอง ครูตัวอย่าง',
        'Advisor Joining? (Yes/No)': 'เข้าร่วม', 'Team Photo Link': 'https://example.invalid/photo3',
        'Line_Joined_Status': 'เข้าร่วมแล้ว', 'หมายเหตุ (Remark)': '',
        'Payment_Slip_Link': '', 'Transfer_Bank': '', 'Transfer_Account_Name': '',
        'Advisor_Welfare_Opted_In (+200)': 'ประสงค์รับ', 'Advisor_Welfare_Slip_Link': '',
        'School_Tax_ID': '0994000000001', 'School_Address_for_Receipt': '123 ถ.ตัวอย่าง จ.ขอนแก่น',
        'Combined_Receipt? (รวมใบเสร็จไหม)': 'รวมได้', 'ยอดเงินที่ต้องชำระ': '1400',
        'ยอดเงินที่โอนจริง': '', 'Transfer_Date_Time': '', 'Payment_Verification_Status': '',
        'Verified_By': '', 'Chronic_Disease_Summary': 'M2: เบาหวานชนิดที่ 1',
        'Medicine_Allergy_Summary': '', 'M1_Disease_Medication': '',
        'M2_Disease_Medication': 'โรค: เบาหวานชนิดที่ 1', 'M3_Disease_Medication': '',
        'Advisor_Disease_Medication': '', 'M1_Chronic_Disease': 'ไม่มี', 'M1_Medicine_Allergy': 'ไม่มี',
        'M2_Chronic_Disease': 'เบาหวานชนิดที่ 1', 'M2_Medicine_Allergy': 'ไม่มี',
        'M3_Chronic_Disease': '', 'M3_Medicine_Allergy': '', 'Advisor_Chronic_Disease': 'ความดันโลหิตสูง',
        'Advisor_Medicine_Allergy': 'ไม่มี', 'Food_Allergy_Summary': '', 'M1_Food_Allergy': 'ไม่มี',
        'M1_Diet_Request': 'ทั่วไป', 'M2_Food_Allergy': 'ไม่มี', 'M2_Diet_Request': 'ไม่ทานเนื้อวัว',
        'M3_Food_Allergy': '', 'M3_Diet_Request': '', 'Advisor_Food_Allergy': 'ไม่มี',
        'Advisor_Diet_Request': 'ทั่วไป', 'Prayer_Room_Request (ช/ญ)': '', 'M1_Prayer_Room': 'ไม่',
        'M2_Prayer_Room': 'ไม่', 'M3_Prayer_Room': '', 'Certificate_Type (Hardcopy/Digital)': 'Digital',
        'On-site_Check-in_Status': '',
    },
];

/** สร้าง payload หน้าตาเดียวกับที่ doGet() ส่งกลับ */
export function fixturePayload(dept) {
    const cols = FIXTURE_DEPT_COLS[dept] ? dept : 'overview';
    const headers = FIXTURE_IDENTITY.concat(FIXTURE_DEPT_COLS[cols])
        .filter((h, i, a) => a.indexOf(h) === i);
    const rows = FIXTURE_TEAMS.map(t => headers.map(h => t[h] ?? ''));
    return {
        status: 'success',
        dept: cols,
        headers,
        rows,
        manualColumns: headers.filter(h => FIXTURE_MANUAL.includes(h)),
        missingColumns: [],
        totalRows: rows.length,
        generatedAt: new Date().toLocaleString('th-TH'),
        isFixture: true,
    };
}
