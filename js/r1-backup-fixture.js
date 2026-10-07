// js/r1-backup-fixture.js
// FAKE data for ?fixture=1 smoke tests. Not real exam content.

const FAKE = 'ข้อสอบจำลอง (ไม่ใช่ข้อสอบจริง)';

function buildMcq() {
    const items = {};
    for (let n = 1; n <= 21; n++) {
        const id = 'm' + String(n).padStart(2, '0');
        items[id] = {
            no: n,
            type: 'sba',
            stem: `${FAKE} ข้อ ${n}: เลือกตัวเลือกที่ถูกต้อง (ข้อมูลปลอม)`,
            options: { A: 'ตัวเลือกปลอม A', B: 'ตัวเลือกปลอม B', C: 'ตัวเลือกปลอม C', D: 'ตัวเลือกปลอม D', E: 'ตัวเลือกปลอม E' }
        };
    }
    for (let n = 22; n <= 28; n++) {
        const statements = {};
        for (let s = 1; s <= 4; s++) statements[`m${n}s${s}`] = { no: s, text: `ข้อความปลอม ${n}.${s}` };
        items['m' + n] = { no: n, type: 'mtf', stem: `${FAKE} ข้อ ${n}: ตัดสินว่าจริงหรือเท็จ (ข้อมูลปลอม)`, statements };
    }
    return { version: 1, part: 'mcq', title: 'Part 1 (ข้อมูลจำลอง)', items };
}

function buildUnseen() {
    const articles = {};
    for (let a = 1; a <= 3; a++) {
        const sections = {};
        ['a', 'b'].forEach((sec, si) => {
            const statements = {};
            for (let s = 1; s <= 4; s++) statements[`u${a}${sec}${s}`] = { no: s, text: `ข้อความปลอม ${a}.${si + 1}.${s}` };
            sections[`u${a}${sec}`] = { no: si + 1, label: `${a}.${si + 1}`, prompt: `${FAKE} บทความ ${a} ตอน ${si + 1}`, statements };
        });
        articles['u' + a] = { no: a, title: `บทความจำลอง ${a} (ไม่ใช่บทความจริง)`, sections };
    }
    return { version: 1, part: 'unseen', title: 'Part 2 (ข้อมูลจำลอง)', articles };
}

export const FIXTURE_QUESTIONS = { mcq: buildMcq(), unseen: buildUnseen() };
