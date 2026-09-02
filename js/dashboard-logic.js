// js/dashboard-logic.js
//
// Logic ของหน้า Dashboard สรุปข้อมูลข้ามฝ่าย (pages/dashboard.html)
// แยก DOM ออกจาก logic เหมือน checking-logic.js — ไฟล์นี้ไม่แตะ DOM เลย
// ยกเว้นการสั่งดาวน์โหลดไฟล์ Excel (ซึ่งต้องผ่าน XLSX ที่โหลดจาก CDN)
//
// ที่มาข้อมูล: 6_DashboardApi.js → doGet(?dept=) ในโปรเจกต์ GAS
// "MedQuiz 2026 Exam Received" ซึ่งคัดคอลัมน์ตามฝ่ายให้ตั้งแต่ฝั่ง server
// (ฝ่ายอาหารจะไม่ได้รับคอลัมน์โรคประจำตัวมาเลย ไม่ใช่แค่ซ่อนในหน้าเว็บ)

import { DASHBOARD_API_URL } from "./firebase-config.js";
import { fixturePayload } from "./dashboard-fixture.js";

// ฝ่ายทั้งหมด — key ต้องตรงกับ DASH_DEPT_COLS ใน 6_DashboardApi.js
export const DEPARTMENTS = [
    { key: 'overview', label: 'ภาพรวม', icon: 'fa-chart-pie' },
    { key: 'registration', label: 'ฝ่ายลงทะเบียน', icon: 'fa-clipboard-user' },
    { key: 'finance', label: 'ฝ่ายการเงิน', icon: 'fa-money-check-dollar' },
    { key: 'firstaid', label: 'ฝ่ายพยาบาล', icon: 'fa-kit-medical' },
    { key: 'food', label: 'ฝ่ายอาหาร', icon: 'fa-utensils' },
    { key: 'coordination', label: 'ฝ่ายประสานงาน', icon: 'fa-people-arrows' },
];

// คอลัมน์ที่ทุกฝ่ายเห็นเสมอ (ตรงกับ DASH_IDENTITY_COLS ฝั่ง GAS)
const IDENTITY_COLS = ['Team ID', 'Team Category', 'Team Name', 'School Name', 'Email Address'];

// คำตอบที่แปลว่า "ไม่มีอะไรต้องรายงาน" — ชุดเดียวกับ _NONE_ANSWERS ใน
// 4_FinalConsolidator.js เพื่อให้ตัวเลขบนหน้าเว็บตรงกับสรุปในชีต
const NONE_ANSWERS = ['', '-', 'ไม่มี', 'ไม่', 'ไม่แพ้', 'ไม่มีครับ', 'ไม่มีค่ะ', 'none', 'no', 'n/a', 'na'];

export const hasVal = (v) => !NONE_ANSWERS.includes(String(v ?? '').trim().toLowerCase());

// ---------------------------------------------------------------------------
// โหลดข้อมูล
// ---------------------------------------------------------------------------

/**
 * ดึงข้อมูลของฝ่ายหนึ่ง ๆ
 * ถ้ายังไม่ได้ deploy Web App (DASHBOARD_API_URL ว่าง) หรือเปิดหน้าด้วย
 * ?fixture=1 จะใช้ข้อมูลตัวอย่างแทน เพื่อให้ทดสอบหน้าเว็บได้ก่อนมีข้อมูลจริง
 *
 * idToken คือ Firebase ID token ของ staff ที่ล็อกอินอยู่ — doGet ฝั่ง GAS
 * บังคับต้องมี (ดูหมายเหตุการ deploy ใน 6_DashboardApi.js) หน้าเว็บเป็นคน
 * ส่งเข้ามาให้ ไฟล์นี้จึงไม่ต้องรู้จัก auth
 */
export async function loadDept(dept, { useFixture = false, idToken = '' } = {}) {
    if (useFixture || !DASHBOARD_API_URL) return fixturePayload(dept);

    const res = await fetch(`${DASHBOARD_API_URL}?dept=${encodeURIComponent(dept)}`
        + `&idToken=${encodeURIComponent(idToken)}`);
    const data = await res.json();
    if (data.status !== 'success') throw new Error(data.message || 'โหลดข้อมูลไม่สำเร็จ');
    return data;
}

// ---------------------------------------------------------------------------
// กรองข้อมูล
// ---------------------------------------------------------------------------

/**
 * กรองบน "แถวดิบ" เสมอ (payload.rows ตามลำดับคอลัมน์ที่ API ส่งมา)
 *
 * สำคัญ: ตัวกรองด่วน (filters.quick) ต้องอ่านจาก payload.headers ไม่ใช่คอลัมน์
 * ที่ตารางแสดง — ฝ่ายที่ตารางตัดคอลัมน์ Line ออกไปแล้วก็ยังต้องกรอง
 * "ยังไม่เข้า Line" ได้ และการค้นหาก็ยังค้นอีเมลได้แม้ตารางจะซ่อนอีเมลไว้
 *
 * @param {{headers:string[], rows:string[][]}} payload
 * @param {{search:string, category:string, onlyWithData:boolean, quick:string}} filters
 * @param {string} dept — ใช้เฉพาะตัวกรองด่วน "มีหมายเหตุเตือน" ซึ่งนิยามต่างกันตามฝ่าย
 * @return {string[][]} เฉพาะแถวที่ผ่านเงื่อนไข (ลำดับคอลัมน์เดิม)
 */
export function filterRows(payload, filters, dept = '') {
    const q = (filters.search || '').trim().toLowerCase();
    const catIdx = payload.headers.indexOf('Team Category');
    const lineIdx = payload.headers.indexOf('Line_Joined_Status');
    const advIdx = payload.headers.indexOf('Advisor Joining? (Yes/No)');
    const deptIdxs = payload.headers
        .map((h, i) => (IDENTITY_COLS.includes(h) ? -1 : i))
        .filter(i => i !== -1);

    return payload.rows.filter(row => {
        if (q && !row.some(c => String(c).toLowerCase().includes(q))) return false;
        if (filters.category && catIdx !== -1 && !String(row[catIdx]).includes(filters.category)) return false;
        if (filters.onlyWithData && !deptIdxs.some(i => hasVal(row[i]))) return false;

        switch (filters.quick) {
            case 'attention':
                if (!attentionReasons(dept, payload, row).length) return false;
                break;
            case 'noline':
                if (lineIdx !== -1 && isYes(row[lineIdx])) return false;
                break;
            case 'noadvisor':
                if (advIdx !== -1 && isYes(row[advIdx])) return false;
                break;
        }
        return true;
    });
}

// ---------------------------------------------------------------------------
// ตัวเลขสรุป (การ์ดด้านบน)
// ---------------------------------------------------------------------------

/** นับจำนวนแถวที่ผ่านเงื่อนไขบนคอลัมน์ที่ระบุ */
function countRows(rows, idx, test) {
    if (idx === -1) return 0;
    return rows.filter(r => test(String(r[idx] ?? '').trim())).length;
}

/** นับ "จำนวนคน" จากหลายคอลัมน์ (M1/M2/M3/Advisor) รวมกันทุกทีม */
function countPeople(rows, idxs, test = hasVal) {
    return rows.reduce((sum, r) => sum + idxs.filter(i => i !== -1 && test(r[i])).length, 0);
}

// "ใช่" = ตอบมาแล้วและไม่ได้ปฏิเสธ — ต้องจับ "ยังไม่เข้าร่วม" ด้วย ไม่ใช่แค่
// คำที่ขึ้นต้นด้วย "ไม่" (ฟอร์มตอบได้ทั้ง "ไม่เข้าร่วม" และ "ยังไม่เข้าร่วม")
export const isYes = (v) => {
    const s = String(v ?? '').trim();
    return s !== '' && !/ไม่|^no$/i.test(s);
};

/** ตอบว่า "ต้องการห้องละหมาด" — ใช้ทั้งการ์ดตัวเลขและคอลัมน์สรุปในตาราง
 *  ให้ตรงกันเสมอ (เคยเขียนแยกกันสองที่แล้วนับไม่ตรง) */
export const wantsPrayerRoom = (v) => hasVal(v) && isYes(v);

// อีกสองเงื่อนไขที่การ์ดตัวเลขกับหน้าต่างเจาะดูรายชื่อต้องใช้ร่วมกัน
// (เคยเขียน inline ในการ์ด ถ้าลอกไปเขียนซ้ำในหน้าต่างเมื่อไหร่ ตัวเลขจะเริ่มไม่ตรง)
/** ขออาหารพิเศษ = ตอบมาแล้วและไม่ใช่ "ทั่วไป" */
export const specialDiet = (v) => hasVal(v) && !String(v).trim().startsWith('ทั่วไป');
/** ขอเกียรติบัตรแบบ Hardcopy */
export const isHardcopy = (v) => /hard/i.test(String(v ?? ''));

// ---------------------------------------------------------------------------
// งานที่ต้องทำ (workflow) — การ์ดสถานะ / กล่องด่วน / ตัวกรองด่วน
// ---------------------------------------------------------------------------
//
// ทั้งสามอย่างใช้ attentionReasons() เป็นนิยามเดียวกัน จะได้ไม่มีกรณี
// "การ์ดบอก 3 ทีม แต่กล่องด่วนขึ้น 2 ทีม" ซึ่งเคยเกิดเวลาเขียนเงื่อนไขแยกกัน
//
// "⚠️ ในหมายเหตุ" ไม่เท่ากับ "มีหมายเหตุ" — การ์ดเดิม "มีหมายเหตุต้องตรวจ"
// นับหมายเหตุทุกแบบ ส่วนที่นี่นับเฉพาะที่ติดสัญลักษณ์เตือนไว้จริง ๆ

/** ค่าที่ "ตอบมาแล้ว" — ต่างจาก hasVal() ตรงที่ "ไม่มี" ถือว่าตอบแล้ว */
const answered = (v) => String(v ?? '').trim() !== '';

/**
 * สมาชิกที่มีชื่ออยู่ในทีม แต่ยังไม่ได้กรอกข้อมูลชุดที่ระบุเลยสักช่อง
 * @param {string[]} suffixes เช่น ['_Chronic_Disease', '_Medicine_Allergy']
 * @return {string[]} เช่น ['สมาชิก 3'] — ว่างถ้าไม่ได้รับคอลัมน์ชื่อสมาชิกมา
 */
function membersMissing(payload, row, suffixes) {
    const g = (h) => {
        const i = payload.headers.indexOf(h);
        return i === -1 ? undefined : row[i];
    };
    const out = [];
    for (const n of [1, 2, 3]) {
        const name = g(`Member ${n} Name`);
        if (name === undefined || !hasVal(name)) continue;   // ไม่มีสมาชิกคนนี้ / ไม่ได้รับคอลัมน์ชื่อ
        const anyAnswer = suffixes.some(s => {
            const v = g(`M${n}${s}`);
            return v !== undefined && answered(v);
        });
        if (!anyAnswer) out.push(`สมาชิก ${n}`);
    }
    return out;
}

/**
 * เหตุผลที่ทีมนี้ "ต้องแก้ไขด่วน" — คืนอาร์เรย์ว่างถ้าไม่มีปัญหา
 * ทุกฝ่ายใช้กฎ "⚠️ ในหมายเหตุ" ร่วมกัน (ถ้าฝ่ายนั้นได้รับคอลัมน์หมายเหตุ)
 * แล้วบวกกฎเฉพาะฝ่ายอีกอย่างละ 1–2 ข้อ ซึ่งคำนวณจากคอลัมน์ที่ฝ่ายนั้นมีจริง
 */
export function attentionReasons(dept, payload, row) {
    const g = (h) => {
        const i = payload.headers.indexOf(h);
        return i === -1 ? undefined : String(row[i] ?? '').trim();
    };
    const out = [];

    const remark = g('หมายเหตุ (Remark)');
    if (remark && remark.includes('⚠️')) out.push(remark);

    switch (dept) {
        case 'finance':
            if (g('Payment_Slip_Link') !== undefined && !hasVal(g('Payment_Slip_Link')))
                out.push('ยังไม่ได้ส่งสลิปค่าเข้าร่วม');
            if (isYes(g('Advisor_Welfare_Opted_In (+200)')) && !hasVal(g('Advisor_Welfare_Slip_Link')))
                out.push('แจ้งรับชุดสวัสดิการอาจารย์ (+200) แต่ยังไม่มีสลิป');
            break;

        case 'registration':
            if (g('Team Photo Link') !== undefined && !hasVal(g('Team Photo Link')))
                out.push('ยังไม่ส่งรูปทีม');
            break;

        case 'coordination':
            if (g('Certificate_Type (Hardcopy/Digital)') !== undefined
                && !hasVal(g('Certificate_Type (Hardcopy/Digital)')))
                out.push('ยังไม่ระบุรูปแบบการรับเกียรติบัตร');
            break;

        case 'firstaid': {
            const m = membersMissing(payload, row, ['_Chronic_Disease', '_Medicine_Allergy']);
            if (m.length) out.push(`ยังไม่กรอกข้อมูลสุขภาพ: ${m.join(', ')}`);
            break;
        }

        case 'food': {
            const m = membersMissing(payload, row, ['_Food_Allergy', '_Diet_Request']);
            if (m.length) out.push(`ยังไม่กรอกข้อมูลอาหาร: ${m.join(', ')}`);
            break;
        }
    }
    return out;
}

/** นิยาม "สมบูรณ์แล้ว" ของแต่ละฝ่าย — null = ฝ่ายนี้ไม่มีข้อมูลพอจะตัดสิน */
function completedRule(dept, payload) {
    const has = (h) => payload.headers.includes(h);
    const g = (row, h) => {
        const i = payload.headers.indexOf(h);
        return i === -1 ? '' : String(row[i] ?? '').trim();
    };
    const noIssue = (row) => attentionReasons(dept, payload, row).length === 0;

    switch (dept) {
        case 'finance':
            if (!has('Payment_Verification_Status')) return null;
            return {
                hint: 'ตรวจสอบการชำระเงินแล้ว และไม่มีรายการต้องแก้ไข',
                test: (r) => hasVal(g(r, 'Payment_Verification_Status')) && noIssue(r),
            };
        case 'registration':
            if (!has('Line_Joined_Status')) return null;
            return {
                hint: 'เข้า Line แล้ว ส่งรูปทีมแล้ว และไม่มีหมายเหตุเตือน',
                test: (r) => isYes(g(r, 'Line_Joined_Status')) && noIssue(r),
            };
        case 'coordination':
            if (!has('Line_Joined_Status')) return null;
            return {
                hint: 'เข้า Line แล้ว ระบุการรับเกียรติบัตรแล้ว และไม่มีหมายเหตุเตือน',
                test: (r) => isYes(g(r, 'Line_Joined_Status')) && noIssue(r),
            };
        case 'firstaid':
        case 'food':
            if (!has('Member 1 Name')) return null;
            return { hint: 'สมาชิกทุกคนที่มีชื่อในทีมกรอกข้อมูลครบแล้ว', test: noIssue };
        default: // overview
            if (!has('Line_Joined_Status') || !has('Payment_Verification_Status')) return null;
            return {
                hint: 'เข้า Line แล้ว ตรวจสอบการชำระเงินแล้ว และไม่มีหมายเหตุเตือน',
                test: (r) => isYes(g(r, 'Line_Joined_Status'))
                    && hasVal(g(r, 'Payment_Verification_Status')) && noIssue(r),
            };
    }
}

// คอลัมน์ที่กฎเฉพาะฝ่ายของ attentionReasons() ต้องมี ไม่งั้นกฎนั้นยิงไม่ได้เลย
const ATTENTION_RULE_COLS = {
    finance: 'Payment_Slip_Link',
    registration: 'Team Photo Link',
    coordination: 'Certificate_Type (Hardcopy/Digital)',
    firstaid: 'Member 1 Name',
    food: 'Member 1 Name',
};

/**
 * ฝ่ายนี้มีคอลัมน์พอจะบอกได้ไหมว่าทีมไหน "ต้องแก้ไขด่วน"
 * ถ้าไม่มีเลย ต้องไม่ขึ้นทั้งการ์ดและปุ่มกรอง — ปุ่มที่กดแล้วได้ 0 แถวเสมอ
 * โดยไม่บอกเหตุผล แย่กว่าไม่มีปุ่ม (วันนี้ทุกฝ่ายมีอย่างน้อย 1 กฎ ฟังก์ชันนี้
 * กันไว้เผื่อ dryRunDashboardColumns() รายงานคอลัมน์หายในอนาคต)
 */
function hasAttentionRule(dept, payload) {
    if (payload.headers.includes('หมายเหตุ (Remark)')) return true;
    const col = ATTENTION_RULE_COLS[dept];
    return !!col && payload.headers.includes(col);
}

/** คำอธิบายใต้การ์ด "ต้องแก้ไขด่วน" ของแต่ละฝ่าย */
const ATTENTION_HINTS = {
    overview: 'หมายเหตุที่ติด ⚠️ ไว้ในชีต',
    registration: '⚠️ ในหมายเหตุ หรือยังไม่ส่งรูปทีม',
    finance: '⚠️ ในหมายเหตุ สลิปหาย หรือรับสวัสดิการแต่ไม่มีสลิป +200',
    coordination: '⚠️ ในหมายเหตุ หรือยังไม่ระบุการรับเกียรติบัตร',
    firstaid: 'มีสมาชิกที่มีชื่อในทีมแต่ยังไม่กรอกข้อมูลสุขภาพ',
    food: 'มีสมาชิกที่มีชื่อในทีมแต่ยังไม่กรอกข้อมูลอาหาร',
};

/**
 * การ์ดสถานะงาน 3 ใบด้านบนสุด — คืนเฉพาะใบที่ฝ่ายนี้มีคอลัมน์พอจะคำนวณ
 * (ไม่ขึ้นเลข 0 หลอก ๆ ให้ฝ่ายที่ไม่ได้รับคอลัมน์นั้นมา)
 * @return {Array<{key:string, tone:string, icon:string, label:string, value:number, hint:string}>}
 */
export function computeWorkflow(dept, payload, rows) {
    const lineIdx = payload.headers.indexOf('Line_Joined_Status');
    const cards = [];

    if (hasAttentionRule(dept, payload)) {
        cards.push({
            key: 'attention', tone: 'red', icon: 'fa-triangle-exclamation',
            label: 'ต้องแก้ไขด่วน',
            value: rows.filter(r => attentionReasons(dept, payload, r).length).length,
            hint: ATTENTION_HINTS[dept] ?? ATTENTION_HINTS.overview,
        });
    }

    if (lineIdx !== -1) {
        cards.push({
            key: 'noline', tone: 'amber', icon: 'fa-comment-dots',
            label: 'รอติดตามเข้า Line',
            value: rows.filter(r => !isYes(r[lineIdx])).length,
            hint: 'ยังไม่ตอบว่าเข้า Line OpenChat แล้ว',
        });
    }

    const done = completedRule(dept, payload);
    if (done) {
        cards.push({
            key: 'done', tone: 'green', icon: 'fa-circle-check',
            label: 'สมบูรณ์แล้ว',
            value: rows.filter(done.test).length,
            hint: done.hint,
        });
    }
    return cards;
}

/**
 * รายการทีมที่ต้องเข้าไปจัดการ พร้อมเหตุผล — ใช้วาดกล่องด่วนเหนือตาราง
 * rowIndex อ้างอิงตำแหน่งใน rows ที่ส่งเข้ามา (คือ visibleRows) จึงส่งต่อเข้า
 * openDrawer() ได้ตรง ๆ
 */
export function findUrgent(dept, payload, rows) {
    const g = (row, h) => {
        const i = payload.headers.indexOf(h);
        return i === -1 ? '' : String(row[i] ?? '').trim();
    };
    return rows
        .map((r, rowIndex) => ({
            rowIndex,
            reasons: attentionReasons(dept, payload, r),
            teamId: g(r, 'Team ID'),
            teamName: g(r, 'Team Name'),
            school: g(r, 'School Name'),
            email: g(r, 'Email Address'),
        }))
        .filter(x => x.reasons.length);
}

/** ปุ่มกรองด่วน — เฉพาะปุ่มที่ฝ่ายนี้มีคอลัมน์รองรับ */
export function quickFilters(payload, dept = '') {
    const has = (h) => payload.headers.includes(h);
    const list = [{ key: '', label: 'ทั้งหมด', icon: 'fa-layer-group' }];
    if (hasAttentionRule(dept, payload)) list.push({ key: 'attention', label: 'มีหมายเหตุเตือน', icon: 'fa-triangle-exclamation' });
    if (has('Line_Joined_Status')) list.push({ key: 'noline', label: 'ยังไม่เข้า Line', icon: 'fa-comment-slash' });
    if (has('Advisor Joining? (Yes/No)')) list.push({ key: 'noadvisor', label: 'อาจารย์ไม่เข้าร่วม', icon: 'fa-user-slash' });
    return list;
}

// ---------------------------------------------------------------------------
// ชื่อคอลัมน์ภาษาไทย (ใช้แสดงผลเท่านั้น)
// ---------------------------------------------------------------------------
//
// ไฟล์ .xlsx ยังส่งออกด้วยชื่อคอลัมน์ดิบเหมือนเดิม เพื่อให้เอาไปเทียบกับชีต
// "Final 100 ทีม" ได้ตรง ๆ — ส่วน PDF คือการ print ตารางบนหน้าจอ จึงได้ชื่อไทย
// ไปด้วยโดยอัตโนมัติ ความต่างนี้ตั้งใจ ไม่ใช่ของที่ต้องแก้ให้เหมือนกัน
//
// key ต้องเป็นชื่อหัวคอลัมน์จริงแบบเป๊ะ ๆ (รวมวงเล็บและช่องว่าง) ถ้าพิมพ์ผิด
// จะไม่ error แต่จะตกไปใช้ชื่อดิบเงียบ ๆ

const PERSON_LABELS = { M1: 'สมาชิก 1', M2: 'สมาชิก 2', M3: 'สมาชิก 3', Advisor: 'อาจารย์' };
const PERSON_FIELD_LABELS = {
    _Chronic_Disease: 'โรคประจำตัว',
    _Medicine_Allergy: 'แพ้ยา',
    _Disease_Medication: 'โรค/ยาที่ใช้',
    _Food_Allergy: 'แพ้อาหาร',
    _Diet_Request: 'อาหารพิเศษ',
    _Prayer_Room: 'ห้องละหมาด',
};

export const COLUMN_LABELS = {
    // ข้อมูลระบุตัวตน
    'Team ID': 'รหัสทีม',
    'Team Name': 'ชื่อทีม',
    'Team Category': 'โควตา',
    'School Name': 'โรงเรียน',
    'Email Address': 'อีเมลหัวหน้าทีม',
    // ทีม / อาจารย์
    'Member 1 Name': 'สมาชิกคนที่ 1',
    'Member 2 Name': 'สมาชิกคนที่ 2',
    'Member 3 Name': 'สมาชิกคนที่ 3',
    'Advisor Name': 'อาจารย์ที่ปรึกษา',
    'Advisor Joining? (Yes/No)': 'อาจารย์เข้าร่วม',
    'Team Photo Link': 'รูปทีม',
    'หมายเหตุ (Remark)': 'หมายเหตุ',
    // ประสานงาน
    'Line_Joined_Status': 'สถานะ Line',
    'Certificate_Type (Hardcopy/Digital)': 'การรับเกียรติบัตร',
    'On-site_Check-in_Status': 'เช็คอินหน้างาน',
    'Prayer_Room_Request (ช/ญ)': 'ห้องละหมาด (ช/ญ)',
    // การเงิน
    'Payment_Slip_Link': 'สลิปโอนเงิน',
    'Transfer_Bank': 'ธนาคารที่โอน',
    'Transfer_Account_Name': 'ชื่อบัญชีผู้โอน',
    'Advisor_Welfare_Opted_In (+200)': 'ชุดสวัสดิการอาจารย์ (+200)',
    'Advisor_Welfare_Slip_Link': 'สลิปค่าสวัสดิการ',
    'School_Tax_ID': 'เลขผู้เสียภาษี (โรงเรียน)',
    'School_Address_for_Receipt': 'ที่อยู่ออกใบเสร็จ',
    'Combined_Receipt? (รวมใบเสร็จไหม)': 'รวมใบเสร็จ',
    'ยอดเงินที่ต้องชำระ': 'ยอดที่ต้องชำระ',
    'ยอดเงินที่โอนจริง': 'ยอดที่โอนจริง',
    'Transfer_Date_Time': 'วันเวลาที่โอน',
    'Payment_Verification_Status': 'สถานะตรวจสอบเงิน',
    'Verified_By': 'ผู้ตรวจสอบ',
    // พยาบาล / อาหาร (คอลัมน์สรุประดับทีม)
    'Chronic_Disease_Summary': 'สรุปโรคประจำตัว',
    'Medicine_Allergy_Summary': 'สรุปการแพ้ยา',
    'Food_Allergy_Summary': 'สรุปการแพ้อาหาร',
};

// คอลัมน์รายบุคคล (M1_/M2_/M3_/Advisor_) สร้างชื่อไทยจากคำนำหน้า+ท้าย
// แทนที่จะพิมพ์มือทีละ 24 บรรทัด
for (const [p, pLabel] of Object.entries(PERSON_LABELS)) {
    for (const [f, fLabel] of Object.entries(PERSON_FIELD_LABELS)) {
        COLUMN_LABELS[`${p}${f}`] ??= `${fLabel} — ${pLabel}`;
    }
}

/** ชื่อไทยของคอลัมน์ ถ้าไม่มีในตารางแปลก็คืนชื่อดิบ */
export const columnLabel = (h) => COLUMN_LABELS[h] ?? h;

// ---------------------------------------------------------------------------
// การจัดคอลัมน์สำหรับ "ตารางที่มองเห็น"
// ---------------------------------------------------------------------------

// Team ID กับ Team Name ต้องอยู่ติดกันซ้ายสุด เพราะสองคอลัมน์นี้ถูก freeze
// (sticky left) ตอนเลื่อนตารางแนวนอนใน dashboard.html — ถ้ามี Team Category
// คั่นกลางเหมือนลำดับดิบ คอลัมน์ที่ freeze จะไม่ติดกันและดูเพี้ยน
const DISPLAY_IDENTITY_ORDER = ['Team ID', 'Team Name', 'Team Category', 'School Name', 'Email Address'];

/** จำนวนคอลัมน์แรกที่ freeze ไว้ — dashboard.html ใช้ค่านี้ตอนใส่ class sticky */
export const STICKY_COL_COUNT = 2;

export const PRAYER_SUMMARY_COL = 'สรุปห้องละหมาด';
export const MEMBER_COUNT_COL = 'จำนวนสมาชิก';
const PRAYER_MEMBER_COLS = ['M1_Prayer_Room', 'M2_Prayer_Room', 'M3_Prayer_Room'];
const PRAYER_SOURCE_COLS = ['Prayer_Room_Request (ช/ญ)', ...PRAYER_MEMBER_COLS];
const MEMBER_NAME_COLS = ['Member 1 Name', 'Member 2 Name', 'Member 3 Name'];

// ---- คอลัมน์ที่แต่ละฝ่าย "เห็นบนตาราง" (ตัดของที่ไม่ได้ใช้ทำงานออก) ----
//
// นี่คือการตัด "การแสดงผล" ไม่ใช่การตัดข้อมูล — กำแพงข้อมูลจริงยังอยู่ฝั่ง GAS
// (DASH_DEPT_COLS ใน 6_DashboardApi.js) ของที่ตัดออกตรงนี้ยังเปิดดูได้ในลิ้นชัก
// รายทีม ยังค้นหาเจอ และยังติดไปในไฟล์ .xlsx ครบทุกคอลัมน์
//
// ฝ่ายที่ไม่มีชื่ออยู่ใน map นี้ (overview, registration) แสดงทุกคอลัมน์ที่ได้รับ:
// ภาพรวมมีแค่ 6 คอลัมน์อยู่แล้ว ส่วนฝ่ายลงทะเบียนทุกคอลัมน์ที่ได้รับคือรายชื่อ
// สมาชิก/รูปทีม/Line ซึ่งเป็นงานของฝ่ายนั้นทั้งหมด ไม่มีอะไรให้ตัด
//
// สองคอลัมน์แรกต้องเป็น Team ID กับ Team Name เสมอ — dashboard.html freeze
// สองคอลัมน์ซ้ายสุดไว้ (sticky) ซึ่งใช้ได้เฉพาะคอลัมน์ที่ติดกันจากขอบซ้าย
const DEPT_TABLE_COLS = {
    // ตัดข้อมูลออกใบเสร็จ (เลขผู้เสียภาษี/ที่อยู่/ธนาคาร/ชื่อบัญชี) ออกจากตาราง
    // เพราะเป็นข้อความยาวที่ทำให้ตารางอ่านไม่ออก — ยังอยู่ครบในลิ้นชักและ .xlsx
    // เก็บ Advisor_Welfare_* ไว้: เป็นรายการเงิน (+200) ไม่ใช่ข้อมูลอาจารย์
    finance: [
        'Team ID', 'Team Name', 'Email Address',
        'Payment_Slip_Link', 'ยอดเงินที่ต้องชำระ', 'ยอดเงินที่โอนจริง',
        'Transfer_Date_Time', 'Payment_Verification_Status', 'Verified_By',
        'Advisor_Welfare_Opted_In (+200)', 'Advisor_Welfare_Slip_Link',
        'On-site_Check-in_Status', 'หมายเหตุ (Remark)',
    ],

    // เก็บ Advisor Name ไว้ทั้งที่ไม่ได้อยู่ในรายการที่ขอ: ฝ่ายประสานงานเป็นคน
    // โทรหาอาจารย์ คอลัมน์ "อาจารย์เข้าร่วม" ที่ไม่มีชื่อกำกับใช้ทำงานไม่ได้
    // ตัดออก: อีเมล, โควตา, รูปทีม, และคอลัมน์ห้องละหมาดรายคน (ยุบเป็นช่องเดียว)
    coordination: [
        'Team ID', 'Team Name', 'School Name',
        'Advisor Name', 'Advisor Joining? (Yes/No)', 'Advisor_Welfare_Opted_In (+200)',
        PRAYER_SUMMARY_COL, 'Certificate_Type (Hardcopy/Digital)',
        'Line_Joined_Status', 'On-site_Check-in_Status', 'หมายเหตุ (Remark)',
    ],

    // ตัด M*_Disease_Medication (ข้อความรวมโรค+ยาในช่องเดียว) ออกจากตาราง
    // เพราะซ้ำกับสองคอลัมน์ที่แยกไว้แล้ว — ยังอยู่ในลิ้นชักและ .xlsx
    firstaid: [
        'Team ID', 'Team Name', MEMBER_COUNT_COL,
        'Chronic_Disease_Summary', 'Medicine_Allergy_Summary',
        'M1_Chronic_Disease', 'M1_Medicine_Allergy',
        'M2_Chronic_Disease', 'M2_Medicine_Allergy',
        'M3_Chronic_Disease', 'M3_Medicine_Allergy',
        'Advisor_Chronic_Disease', 'Advisor_Medicine_Allergy',
    ],

    food: [
        'Team ID', 'Team Name', MEMBER_COUNT_COL, 'Food_Allergy_Summary',
        'M1_Food_Allergy', 'M1_Diet_Request',
        'M2_Food_Allergy', 'M2_Diet_Request',
        'M3_Food_Allergy', 'M3_Diet_Request',
        'Advisor_Food_Allergy', 'Advisor_Diet_Request',
    ],
};

/**
 * ยุบคอลัมน์ห้องละหมาด 4 คอลัมน์เหลือคอลัมน์เดียว เช่น "[M1] [M3]"
 * ถ้าคอลัมน์รายคนว่างหมดแต่คอลัมน์รวมของชีตมีข้อความอยู่ จะคืนข้อความนั้นแทน
 * (ไม่ทิ้งข้อมูล — คอลัมน์รวมบางแถวมาจากฟอร์มคนละช่องกับรายคน)
 */
function prayerSummary(row, memberIdxs, bareIdx) {
    const tags = PRAYER_MEMBER_COLS
        .map((_, n) => (memberIdxs[n] !== -1 && wantsPrayerRoom(row[memberIdxs[n]])) ? `M${n + 1}` : null)
        .filter(Boolean);
    if (tags.length) return tags.join(' ');
    const bare = bareIdx === -1 ? '' : String(row[bareIdx] ?? '').trim();
    return hasVal(bare) ? bare : '';
}

/**
 * แปลง payload ดิบ → คอลัมน์ที่แสดงจริง
 *
 * สำคัญ: ต้องเรียกครั้งเดียวต่อ "ชุดคอลัมน์" ใน render() แล้วส่งผลลัพธ์ชุดเดิม
 * ไปทั้งการวาดตาราง และการซ่อนคอลัมน์ว่างตอนพิมพ์ — ทั้งสองที่อ้างอิงคอลัมน์
 * ด้วย "ตำแหน่ง" ถ้าใช้คนละชุดกันจะเพี้ยนแบบเงียบ ๆ
 *
 * มีสองชุดที่ใช้จริงในหน้า และห้ามสลับกัน:
 *   prune: true  → ตาราง + PDF (คอลัมน์เท่าที่ฝ่ายนั้นใช้ทำงาน)
 *   prune: false → .xlsx (ทุกคอลัมน์ที่ฝ่ายนั้นได้รับ) เพราะไฟล์ Excel มีไว้
 *                  เอาไปเทียบกับชีต "Final 100 ทีม" ให้ตรงคอลัมน์
 *
 * @return {{headers:string[], rows:string[][]}} headers ยังเป็นชื่อดิบ
 *         (ใช้ columnLabel() ตอนแสดงผล และใช้ชื่อดิบตรง ๆ ตอน export)
 */
export function projectRows(dept, payload, rows, { prune = false } = {}) {
    const src = payload.headers;
    const collapsePrayer = dept === 'coordination'
        && PRAYER_MEMBER_COLS.some(h => src.includes(h));
    const memberIdxs = PRAYER_MEMBER_COLS.map(h => src.indexOf(h));
    const nameIdxs = MEMBER_NAME_COLS.map(h => src.indexOf(h));
    const bareIdx = src.indexOf('Prayer_Room_Request (ช/ญ)');

    const keep = prune ? DEPT_TABLE_COLS[dept] : null;
    let headers;

    if (keep) {
        // เอาเฉพาะคอลัมน์ที่ "มีจริง" — ถ้า GAS ไม่ได้ส่งคอลัมน์ไหนมา
        // (เช่นชีตยังไม่มีคอลัมน์นั้น) ก็ข้ามไป ไม่ขึ้นช่องว่างลอย ๆ
        headers = keep.filter(h => src.includes(h)
            || (h === PRAYER_SUMMARY_COL && collapsePrayer)
            || (h === MEMBER_COUNT_COL && nameIdxs.some(i => i !== -1)));
    } else {
        const identity = DISPLAY_IDENTITY_ORDER.filter(h => src.includes(h));
        headers = [...identity];
        let prayerDone = false;
        for (const h of src) {
            if (identity.includes(h)) continue;
            if (collapsePrayer && PRAYER_SOURCE_COLS.includes(h)) {
                if (!prayerDone) { headers.push(PRAYER_SUMMARY_COL); prayerDone = true; }
                continue;
            }
            headers.push(h);
        }
    }

    // 'prayer' / 'members' = คำนวณเอา ไม่ได้ copy มาจากคอลัมน์เดียว
    const plan = headers.map(h => {
        if (h === PRAYER_SUMMARY_COL && collapsePrayer) return 'prayer';
        if (h === MEMBER_COUNT_COL) return 'members';
        return src.indexOf(h);
    });

    return {
        headers,
        rows: rows.map(r => plan.map(p => {
            if (p === 'prayer') return prayerSummary(r, memberIdxs, bareIdx);
            if (p === 'members') return String(nameIdxs.filter(i => i !== -1 && hasVal(r[i])).length);
            return p === -1 ? '' : r[p];
        })),
    };
}

/**
 * ตัวเลขสรุปของแต่ละฝ่าย คำนวณจากแถวที่กรองแล้วเท่านั้น
 * @return {Array<{label:string, value:string|number, hint?:string, manual?:boolean}>}
 */
export function computeMetrics(dept, payload, rows) {
    const i = (h) => payload.headers.indexOf(h);
    const people = (suffix) => ['M1', 'M2', 'M3', 'Advisor'].map(p => i(`${p}${suffix}`));
    const total = rows.length;

    switch (dept) {
        case 'registration':
            return [
                { label: 'ทีมทั้งหมด', value: total },
                { label: 'สมาชิกครบ 3 คน', value: rows.filter(r => [1, 2, 3].every(n => hasVal(r[i(`Member ${n} Name`)]))).length },
                { label: 'ทีมไม่ครบ 3 คน', value: rows.filter(r => ![1, 2, 3].every(n => hasVal(r[i(`Member ${n} Name`)]))).length, hint: 'แข่ง 2 คนได้ / 1 คนลงได้เฉพาะรอบ 1' },
                { label: 'ยังไม่ส่งรูปทีม', value: countRows(rows, i('Team Photo Link'), v => !hasVal(v)) },
                { label: 'เข้า Line OpenChat แล้ว', value: countRows(rows, i('Line_Joined_Status'), isYes) },
                { label: 'มีหมายเหตุต้องตรวจ', value: countRows(rows, i('หมายเหตุ (Remark)'), hasVal) },
            ];

        case 'finance': {
            const welfare = countRows(rows, i('Advisor_Welfare_Opted_In (+200)'), isYes);
            return [
                { label: 'ทีมทั้งหมด', value: total },
                { label: 'ส่งสลิปแล้ว', value: countRows(rows, i('Payment_Slip_Link'), hasVal) },
                { label: 'ยังไม่ส่งสลิป', value: countRows(rows, i('Payment_Slip_Link'), v => !hasVal(v)) },
                { label: 'อาจารย์รับชุดสวัสดิการ (+200)', value: welfare },
                { label: 'ยอดที่ควรได้รับ (ประมาณการ)', value: (total * 1200 + welfare * 200).toLocaleString('th-TH') + ' ฿', hint: 'ค่าเข้าร่วม 1,200 × ทีม + สวัสดิการอาจารย์ 200 × คน' },
                { label: 'ตรวจสอบการชำระเงินแล้ว', value: countRows(rows, i('Payment_Verification_Status'), hasVal), manual: true },
                { label: 'ขอรวมใบเสร็จ', value: countRows(rows, i('Combined_Receipt? (รวมใบเสร็จไหม)'), isYes), key: 'combinedReceipt' },
            ];
        }

        case 'firstaid': {
            const disease = people('_Chronic_Disease');
            const med = people('_Medicine_Allergy');
            return [
                { label: 'ทีมทั้งหมด', value: total },
                { label: 'คนที่มีโรคประจำตัว', value: countPeople(rows, disease), key: 'disease' },
                { label: 'คนที่แพ้ยา', value: countPeople(rows, med), key: 'medAllergy' },
                { label: 'ทีมที่ต้องเฝ้าระวัง', value: rows.filter(r => disease.concat(med).some(x => x !== -1 && hasVal(r[x]))).length, hint: 'มีอย่างน้อย 1 คนที่มีโรคประจำตัวหรือแพ้ยา' },
            ];
        }

        case 'food': {
            const allergy = people('_Food_Allergy');
            const diet = people('_Diet_Request');
            return [
                { label: 'ทีมทั้งหมด', value: total },
                { label: 'คนที่แพ้อาหาร', value: countPeople(rows, allergy), key: 'foodAllergy' },
                { label: 'คนที่ขออาหารพิเศษ', value: countPeople(rows, diet, specialDiet), hint: 'ไม่นับคำตอบ "ทั่วไป"', key: 'diet' },
                { label: 'ทีมที่มีข้อจำกัดด้านอาหาร', value: rows.filter(r => allergy.some(x => x !== -1 && hasVal(r[x])) || diet.some(x => x !== -1 && specialDiet(r[x]))).length },
            ];
        }

        case 'coordination': {
            // นับจากคอลัมน์ M1/M2/M3 แยกกัน ไม่ใช่คอลัมน์สรุปที่ตารางแสดง
            const prayer = ['M1', 'M2', 'M3'].map(p => i(`${p}_Prayer_Room`));
            return [
                { label: 'ทีมทั้งหมด', value: total },
                { label: 'คนขอใช้ห้องละหมาด', value: countPeople(rows, prayer, wantsPrayerRoom) },
                { label: 'อาจารย์เข้าร่วมงาน', value: countRows(rows, i('Advisor Joining? (Yes/No)'), isYes) },
                { label: 'อาจารย์รับชุดสวัสดิการ (+200)', value: countRows(rows, i('Advisor_Welfare_Opted_In (+200)'), isYes) },
                { label: 'ขอเอกสารแบบ Hardcopy', value: countRows(rows, i('Certificate_Type (Hardcopy/Digital)'), isHardcopy), key: 'hardcopy' },
                { label: 'เช็คอินหน้างานแล้ว', value: countRows(rows, i('On-site_Check-in_Status'), hasVal), manual: true },
            ];
        }

        default: // overview
            return [
                { label: 'ทีมทั้งหมด', value: total },
                { label: 'โควตาทีมโรงเรียน', value: countRows(rows, i('Team Category'), v => v.includes('โรงเรียน')) },
                { label: 'โควตาทีมผสม', value: countRows(rows, i('Team Category'), v => v.includes('ผสม')) },
                { label: 'เข้า Line OpenChat แล้ว', value: countRows(rows, i('Line_Joined_Status'), isYes) },
                { label: 'อาจารย์เข้าร่วมงาน', value: countRows(rows, i('Advisor Joining? (Yes/No)'), isYes) },
                { label: 'ตรวจสอบการชำระเงินแล้ว', value: countRows(rows, i('Payment_Verification_Status'), hasVal), manual: true },
                { label: 'มีหมายเหตุต้องตรวจ', value: countRows(rows, i('หมายเหตุ (Remark)'), hasVal) },
            ];
    }
}

// ---------------------------------------------------------------------------
// เจาะดูรายชื่อเบื้องหลังการ์ดตัวเลข (drill-down)
// ---------------------------------------------------------------------------
//
// กติกาที่ห้ามพัง: จำนวนรายการในหน้าต่าง = ตัวเลขบนการ์ดที่กดเข้ามาเสมอ
// จึงใช้ "เงื่อนไขตัวเดียวกัน" กับ computeMetrics (spec.test) ไม่เขียนเงื่อนไขใหม่
// ถ้าเขียนใหม่เป็น v !== '' จะได้คนที่ตอบว่า "ไม่มี" ติดมาด้วย เพราะ hasVal()
// นับ "ไม่มี"/"ไม่แพ้"/"none" เป็นค่าว่าง (ดู NONE_ANSWERS) แล้วรายชื่อจะเกินการ์ด
//
// หน่วยนับไม่เหมือนกันทุกการ์ด และสลับกันไม่ได้:
//   unit:'team'   → 1 รายการต่อทีม  จัดกลุ่มตามโรงเรียน (แจกใบเสร็จ/เกียรติบัตรเป็นราย รร.)
//   unit:'person' → 1 รายการต่อคน   จัดกลุ่มตามคำตอบ (สมาชิก 3 คนแพ้ยาหมด = 3 รายการ)
//
// กลุ่มท้ายรายการ (context) คือคนหรือทีมที่ "ตอบมาแล้วแต่ไม่เข้าเงื่อนไขการ์ด"
// เช่นตอบ "ทั่วไป"/"Digital" — มีแต่ตัวเลข ไม่มีรายชื่อ จะได้ไม่ทำให้ยอดรวม
// ของหน้าต่างขัดกับการ์ด ส่วนคนที่ยังไม่ตอบเลยไม่นับตรงนี้ กล่อง "ต้องดำเนินการ
// ด่วน" ดูแลเคสนั้นอยู่แล้ว

const PERSON_SLOTS = ['M1', 'M2', 'M3', 'Advisor'];
const PERSON_NAME_COLS = {
    M1: 'Member 1 Name', M2: 'Member 2 Name', M3: 'Member 3 Name', Advisor: 'Advisor Name',
};

// key ต้องตรงกับ key ของการ์ดใน computeMetrics
const DRILL_SPECS = {
    finance: {
        combinedReceipt: {
            title: 'ทีมที่ขอรวมใบเสร็จ', unit: 'team',
            column: 'Combined_Receipt? (รวมใบเสร็จไหม)', test: isYes,
            contextLabel: 'ตอบว่าไม่รวมใบเสร็จ',
        },
    },
    coordination: {
        hardcopy: {
            title: 'ทีมที่ขอเกียรติบัตรแบบ Hardcopy', unit: 'team',
            column: 'Certificate_Type (Hardcopy/Digital)', test: isHardcopy,
            contextLabel: 'ขอแบบ Digital',
        },
    },
    firstaid: {
        disease: {
            title: 'คนที่มีโรคประจำตัว', unit: 'person',
            suffix: '_Chronic_Disease', test: hasVal,
            contextLabel: 'ตอบว่าไม่มีโรคประจำตัว',
        },
        medAllergy: {
            title: 'คนที่แพ้ยา', unit: 'person',
            suffix: '_Medicine_Allergy', test: hasVal,
            contextLabel: 'ตอบว่าไม่แพ้ยา',
        },
    },
    food: {
        foodAllergy: {
            title: 'คนที่แพ้อาหาร', unit: 'person',
            suffix: '_Food_Allergy', test: hasVal,
            contextLabel: 'ตอบว่าไม่แพ้อาหาร',
        },
        diet: {
            title: 'คนที่ขออาหารพิเศษ', unit: 'person',
            suffix: '_Diet_Request', test: specialDiet,
            contextLabel: 'ตอบว่าอาหารทั่วไป',
            // ฝ่ายอาหารต้องรู้ชื่อคนที่กิน "ทั่วไป" ด้วย (เป็นยอดที่ใช้สั่งอาหารจริง)
            // ที่อื่นไม่เปิด: รายชื่อคนที่ตอบว่า "ไม่มีโรคประจำตัว" ไม่มีประโยชน์
            contextItems: true,
        },
    },
};

/**
 * รายชื่อเบื้องหลังการ์ดตัวเลขใบหนึ่ง
 *
 * ต้องส่ง rows ชุดเดียวกับที่ computeMetrics ใช้ (visibleRows) ไม่ใช่ baseRows
 * และต้องเป็น "แถวดิบ" ไม่ใช่ผลของ projectRows() ซึ่งสลับ/ยุบ/ตัดคอลัมน์
 *
 * @return {null|{title:string, unit:'team'|'person', groupBy:string, total:number,
 *   groups:Array<{label:string, count:number, items:Array<{rowIndex:number,
 *     teamId:string, teamName:string, school:string, person?:string, role?:string,
 *     detail:string}>}>,
 *   context:null|{label:string, count:number, items:Array}}}
 *   context.items ว่างเสมอ ยกเว้นการ์ดที่ตั้ง contextItems ไว้ (ตอนนี้มีแค่อาหารพิเศษ)
 *   null = ไม่มีการเจาะดูของการ์ดนี้ หรือฝ่ายนี้ไม่ได้รับคอลัมน์ที่ต้องใช้
 */
export function drilldown(dept, payload, rows, key) {
    const spec = DRILL_SPECS[dept]?.[key];
    if (!spec) return null;

    const idx = (h) => payload.headers.indexOf(h);
    const at = (row, h) => { const i = idx(h); return i === -1 ? '' : String(row[i] ?? '').trim(); };
    const teamOf = (row, rowIndex) => ({
        rowIndex,                                   // อ้างอิง rows ที่ส่งเข้ามา = visibleRows
        teamId: at(row, 'Team ID'),
        teamName: at(row, 'Team Name'),
        school: at(row, 'School Name'),
    });

    const groups = new Map();
    const contextItems = [];
    let contextCount = 0;
    const push = (label, item) => {
        if (!groups.has(label)) groups.set(label, []);
        groups.get(label).push(item);
    };

    if (spec.unit === 'team') {
        const i = idx(spec.column);
        if (i === -1) return null;              // ฝ่ายนี้ไม่ได้รับคอลัมน์ → ไม่มีอะไรให้เจาะ
        rows.forEach((r, n) => {
            const v = String(r[i] ?? '').trim();
            if (spec.test(v)) push(at(r, 'School Name') || '(ไม่ระบุโรงเรียน)', { ...teamOf(r, n), detail: v });
            else if (v !== '') contextCount++;
        });
    } else {
        // เดินเฉพาะช่องที่ได้รับคอลัมน์มาจริง — เหมือน countPeople() ที่ข้าม i === -1
        const slots = PERSON_SLOTS.filter(p => idx(`${p}${spec.suffix}`) !== -1);
        if (!slots.length) return null;
        rows.forEach((r, n) => {
            for (const p of slots) {
                const v = at(r, `${p}${spec.suffix}`);
                const item = () => ({
                    ...teamOf(r, n),
                    // ถ้าฝ่ายนี้ไม่ได้รับคอลัมน์ชื่อ ให้ใช้ตำแหน่งแทน ("สมาชิก 2")
                    person: at(r, PERSON_NAME_COLS[p]) || PERSON_LABELS[p],
                    role: PERSON_LABELS[p],
                    detail: v,
                });
                if (spec.test(v)) push(v, item());
                else if (v !== '') {
                    contextCount++;
                    if (spec.contextItems) contextItems.push(item());
                }
            }
        });
    }

    const sorted = [...groups.entries()]
        .map(([label, items]) => ({
            label, count: items.length,
            items: items.sort((a, b) => String(a.teamId).localeCompare(String(b.teamId))),
        }))
        .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'th'));

    return {
        title: spec.title,
        unit: spec.unit,
        groupBy: spec.unit === 'team' ? 'โรงเรียน' : 'คำตอบ',
        total: sorted.reduce((s, g) => s + g.count, 0),
        groups: sorted,
        // items มีเฉพาะการ์ดที่ตั้ง contextItems ไว้ — total ยังนับจาก groups เท่านั้น
        // ยอดรวมของหน้าต่างจึงยังตรงกับการ์ดเหมือนเดิม
        context: contextCount
            ? { label: spec.contextLabel, count: contextCount, items: contextItems }
            : null,
    };
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

function fileStamp(dept) {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    return `MedQuiz2026_${dept}_${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`;
}

/**
 * ดาวน์โหลด .xlsx ของ "คอลัมน์ฝ่ายนี้ × แถวที่กรองอยู่ตอนนี้" — ไม่ใช่ข้อมูลทั้งหมด
 * ต้องมี SheetJS (XLSX) โหลดไว้แล้วในหน้า
 */
export function exportXlsx(dept, deptLabel, headers, rows) {
    if (typeof XLSX === 'undefined') throw new Error('ไม่พบไลบรารี XLSX (ตรวจการเชื่อมต่ออินเทอร์เน็ต)');

    const aoa = [headers, ...rows];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = headers.map(h => ({ wch: Math.min(Math.max(h.length + 4, 12), 40) }));

    const wb = XLSX.utils.book_new();
    // ชื่อชีตใน Excel ห้ามเกิน 31 ตัวและห้ามมี : \ / ? * [ ]
    XLSX.utils.book_append_sheet(wb, ws, deptLabel.replace(/[:\\/?*[\]]/g, '').slice(0, 31));
    XLSX.writeFile(wb, `${fileStamp(dept)}.xlsx`);
}

/**
 * PDF ผ่านหน้าต่าง Print ของเบราว์เซอร์ (เลือก "Save as PDF")
 *
 * ไม่ใช้ jsPDF โดยตั้งใจ: jsPDF ต้องฝังฟอนต์ไทยเป็น base64 และยังวางสระ/
 * วรรณยุกต์ผิดตำแหน่งอยู่ดี ส่วน print ของเบราว์เซอร์ใช้ text shaper จริงกับ
 * ฟอนต์ Sarabun ที่หน้านี้โหลดอยู่แล้ว ภาษาไทยจึงถูกต้อง 100% โดยไม่ต้องทำอะไร
 * (สิ่งที่พิมพ์คือตารางที่กรองแล้วบนหน้าจอ ตาม @media print ใน dashboard.html)
 */
export function exportPdf() {
    window.print();
}
