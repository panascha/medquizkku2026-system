// js/r1-backup-staff-app.js
// DOM glue for pages/r1-backup-staff.html. Logic lives in r1-backup-staff-engine.js.
// The answer key is held in this module's memory only: never written to RTDB, storage, or the page URL.
import {
    PARTS, sanitizeQuestions, planControl, controlState, monitorRows, parseAnswerKey,
    buildMcqTsv, buildUnseenTsvs, MCQ_TAB
} from './r1-backup-staff-engine.js';

const $ = (id) => document.getElementById(id);
const fmtTime = (ms) => (typeof ms === 'number' ? new Date(ms).toLocaleTimeString('th-TH') : '-');

let backend = null;
let root = {};
let answerKey = null; // flat map, memory only
let lastExports = [];

function toast(msg, bad) {
    const t = $('toast');
    t.textContent = msg;
    t.className = 'fixed bottom-4 left-1/2 -translate-x-1/2 px-4 py-2 rounded-lg text-white text-sm shadow-lg ' + (bad ? 'bg-red-600' : 'bg-slate-800');
    t.hidden = false;
    clearTimeout(toast.t);
    toast.t = setTimeout(() => { t.hidden = true; }, 5000);
}

const readJsonFile = (file) => new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => { try { resolve(JSON.parse(fr.result)); } catch (e) { reject(new Error('ไฟล์ไม่ใช่ JSON')); } };
    fr.onerror = () => reject(new Error('อ่านไฟล์ไม่ได้'));
    fr.readAsText(file);
});

function cell(tr, text, cls) {
    const td = document.createElement('td');
    td.className = 'px-2 py-1 ' + (cls || '');
    td.textContent = text;
    tr.appendChild(td);
    return td;
}

// ── exam control ──
function renderControl() {
    const now = backend.getServerNow();
    PARTS.forEach((p) => {
        const ctl = (root._control || {})[p];
        $(`state-${p}`).textContent = controlState(ctl, now);
        $(`times-${p}`).textContent = ctl ? `เริ่ม ${fmtTime(ctl.startAt)} · หมด ${fmtTime(ctl.endAt)}` : 'ยังไม่ได้ตั้งเวลา';
        $(`q-${p}`).textContent = root._questions && root._questions[p] ? 'อัปโหลดข้อสอบแล้ว' : 'ยังไม่มีข้อสอบ';
    });
}

async function control(part, action) {
    try {
        const ctl = (root._control || {})[part];
        if (action === 'start' && ctl && !confirm(`part ${part} เริ่มไปแล้ว — เริ่มใหม่จะรีเซ็ตเวลา ยืนยัน?`)) return;
        if (action === 'end' && !confirm(`จบการสอบ ${part} ทันที? นักเรียนจะส่งคำตอบไม่ได้อีก`)) return;
        const minutes = action === 'extend' ? $(`ext-${part}`).value : undefined;
        const next = planControl(action, ctl, backend.getServerNow(), minutes);
        await backend.writeControl(part, next);
        toast(`${part}: ${action} สำเร็จ`);
    } catch (e) {
        toast(`${part}: ${e.message || e}`, true);
    }
}

// ── upload questions ──
async function upload(part) {
    const f = $(`file-${part}`).files[0];
    if (!f) { toast('เลือกไฟล์ JSON ก่อน', true); return; }
    try {
        const clean = sanitizeQuestions(part, await readJsonFile(f));
        if (!confirm(`อัปโหลดข้อสอบ ${part} (${f.name}) ไปยังเซิร์ฟเวอร์? ของเดิมจะถูกแทนที่`)) return;
        await backend.writeQuestions(part, clean);
        toast(`อัปโหลด ${part} สำเร็จ`);
    } catch (e) {
        toast(`ปฏิเสธไฟล์ ${part}: ${e.message || e}`, true);
    }
}

// ── image upload + raw export (worker backend only) ──
async function uploadImg() {
    const f = $('imgFile').files[0];
    const part = $('imgPart').value;
    if (!f) { toast('เลือกรูปก่อน', true); return; }
    try {
        await backend.uploadImage(part, f.name, f);
        $('imgUrl').textContent = backend.imageUrl(f.name);
        toast(`อัปโหลดรูป ${f.name} สำเร็จ`);
    } catch (e) {
        toast(`อัปโหลดรูปไม่สำเร็จ: ${e.message || e}`, true);
    }
}

async function downloadRaw() {
    try {
        const text = await backend.fetchExportText();
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([text], { type: 'application/json;charset=utf-8' }));
        a.download = 'r1-backup-export.json';
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    } catch (e) {
        toast(`ส่งออกไม่สำเร็จ: ${e.message || e}`, true);
    }
}

// ── monitor ──
function renderMonitor() {
    const body = $('monitorBody');
    const q = $('monitorFilter').value.trim().toLowerCase();
    const rows = monitorRows(root).filter((r) => !q || r.username.includes(q));
    body.textContent = '';
    rows.forEach((r) => {
        const tr = document.createElement('tr');
        tr.className = 'border-t border-slate-200';
        cell(tr, r.username, 'font-mono');
        cell(tr, r.claimed ? 'ใช่' : '-', r.claimed ? 'text-emerald-700' : 'text-slate-400');
        cell(tr, `${r.answeredMcq}/49`);
        cell(tr, r.username.endsWith('-1') ? `${r.answeredUnseen}/24` : 'อ่านอย่างเดียว');
        cell(tr, r.submittedMcq ? 'ส่งแล้ว' : '-', r.submittedMcq ? 'text-emerald-700' : 'text-slate-400');
        cell(tr, r.username.endsWith('-1') ? (r.submittedUnseen ? 'ส่งแล้ว' : '-') : 'n/a');
        cell(tr, String(r.blur), r.blur >= 3 ? 'text-red-600 font-bold' : '');
        const td = cell(tr, '');
        if (r.claimed) {
            const b = document.createElement('button');
            b.textContent = 'ปล่อยที่นั่ง';
            b.className = 'text-xs bg-amber-500 hover:bg-amber-600 text-white rounded px-2 py-1';
            b.onclick = () => release(r.username);
            td.appendChild(b);
        }
        body.appendChild(tr);
    });
    const all = monitorRows(root);
    $('monitorSummary').textContent = `${all.filter((r) => r.claimed).length} ที่นั่งที่จับจอง · ส่ง Part 1 ${all.filter((r) => r.submittedMcq).length} · ส่ง Part 2 ${all.filter((r) => r.submittedUnseen).length}`;
}

async function release(username) {
    if (!confirm(`ปล่อยที่นั่ง ${username}?\nคำตอบเดิมจะยังอยู่ แต่เครื่องอื่นจะจับจองที่นั่งนี้ได้`)) return;
    try {
        await backend.releaseSeat(username);
        toast(`ปล่อยที่นั่ง ${username} แล้ว`);
    } catch (e) {
        toast(`ปล่อยที่นั่งไม่สำเร็จ: ${e.message || e}`, true);
    }
}

// ── grade + export ──
async function loadKey() {
    const f = $('keyFile').files[0];
    if (!f) { toast('เลือกไฟล์เฉลยก่อน', true); return; }
    try {
        answerKey = parseAnswerKey(await readJsonFile(f));
        $('keyStatus').textContent = `โหลดเฉลยแล้ว (${Object.keys(answerKey).length} ข้อ) — อยู่ในหน่วยความจำเบราว์เซอร์เท่านั้น`;
        $('keyFile').value = '';
        $('exportBtn').disabled = false;
    } catch (e) {
        answerKey = null;
        $('keyStatus').textContent = '';
        $('exportBtn').disabled = true;
        toast(`เฉลยใช้ไม่ได้: ${e.message || e}`, true);
    }
}

function download(name, text) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'text/tab-separated-values;charset=utf-8' }));
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function renderExports() {
    const box = $('exports');
    box.textContent = '';
    lastExports.forEach((x) => {
        const wrap = document.createElement('div');
        wrap.className = 'border border-slate-200 rounded-lg p-3 bg-white';
        const h = document.createElement('div');
        h.className = 'flex items-center gap-2 mb-2';
        const title = document.createElement('span');
        title.className = 'font-bold text-sm flex-1';
        title.textContent = `tab "${x.tab}" — ${x.count} แถว`;
        const copy = document.createElement('button');
        copy.textContent = 'คัดลอก';
        copy.className = 'text-xs bg-blue-600 text-white rounded px-2 py-1';
        copy.onclick = () => navigator.clipboard.writeText(x.tsv).then(() => toast(`คัดลอก ${x.tab} แล้ว`), () => toast('คัดลอกไม่สำเร็จ ใช้ดาวน์โหลดแทน', true));
        const dl = document.createElement('button');
        dl.textContent = 'ดาวน์โหลด .tsv';
        dl.className = 'text-xs bg-slate-700 text-white rounded px-2 py-1';
        dl.onclick = () => download(`${x.tab.replace(/\s+/g, '_')}.tsv`, x.tsv);
        h.append(title, copy, dl);
        const pre = document.createElement('textarea');
        pre.readOnly = true;
        pre.rows = 5;
        pre.className = 'w-full font-mono text-xs border border-slate-200 rounded p-2';
        pre.value = x.tsv;
        wrap.append(h, pre);
        box.appendChild(wrap);
    });
}

function exportAll() {
    if (!answerKey) { toast('โหลดเฉลยก่อน', true); return; }
    const mcq = buildMcqTsv(root, answerKey, root._control || {});
    const uns = buildUnseenTsvs(root, answerKey, root._control || {});
    lastExports = [{ tab: MCQ_TAB, tsv: mcq.tsv, count: mcq.count }, ...uns.tabs];
    const warn = [];
    if (mcq.notSubmitted.length) warn.push(`Part 1 ยังไม่ส่ง ${mcq.notSubmitted.length} คน (ออกเป็น In progress คะแนนจากคำตอบที่บันทึกไว้): ${mcq.notSubmitted.join(', ')}`);
    if (uns.notSubmitted.length) warn.push(`Part 2 ยังไม่ส่ง ${uns.notSubmitted.length} คน: ${uns.notSubmitted.join(', ')}`);
    $('exportWarn').textContent = warn.join('\n');
    renderExports();
}

function refresh() {
    renderControl();
    renderMonitor();
}

function bind() {
    PARTS.forEach((p) => {
        $(`start-${p}`).onclick = () => control(p, 'start');
        $(`extend-${p}`).onclick = () => control(p, 'extend');
        $(`end-${p}`).onclick = () => control(p, 'end');
        $(`upload-${p}`).onclick = () => upload(p);
    });
    $('monitorFilter').oninput = renderMonitor;
    $('imgUpload').onclick = uploadImg;
    $('rawExport').onclick = downloadRaw;
    $('keyLoad').onclick = loadKey;
    $('exportBtn').onclick = exportAll;
    setInterval(renderControl, 1000);
}

function fixtureBackend(fx) {
    const tree = fx.buildFixtureDb(Date.now());
    const listeners = [];
    const emit = () => listeners.forEach((cb) => cb(JSON.parse(JSON.stringify(tree))));
    return {
        getServerNow: () => Date.now(),
        watchRoot: (cb) => { listeners.push(cb); cb(JSON.parse(JSON.stringify(tree))); },
        writeControl: async (p, ctl) => { tree._control = { ...(tree._control || {}), [p]: ctl }; emit(); },
        writeQuestions: async (p, clean) => { tree._questions = { ...(tree._questions || {}), [p]: clean }; emit(); },
        releaseSeat: async (u) => { delete tree[u].uid; delete tree[u].claimedAt; emit(); },
        uploadImage: async () => {},
        imageUrl: (n) => `https://fixture.invalid/api/img/${n}`,
        fetchExportText: async () => JSON.stringify(tree)
    };
}

/** mode: { fixture: bool }. Live callers must already hold a valid admin token (see pages/r1-backup-staff.html). */
export async function initStaffPage({ fixture }) {
    if (fixture) {
        const fx = await import('./r1-backup-staff-fixture.js');
        backend = fixtureBackend(fx);
        $('fixtureBanner').hidden = false;
        $('fixtureKeyBtn').hidden = false;
        $('fixtureKeyBtn').onclick = () => {
            answerKey = parseAnswerKey(fx.buildFixtureKey());
            $('keyStatus').textContent = 'โหลดเฉลยปลอมแล้ว (fixture)';
            $('exportBtn').disabled = false;
        };
    } else {
        const api = await import('./r1-backup-staff-api.js');
        await api.startServerClock();
        backend = api;
    }
    bind();
    backend.watchRoot((v) => { root = v; refresh(); }, (e) => toast(`อ่านข้อมูลจากเซิร์ฟเวอร์ไม่ได้: ${e && e.message}`, true));
}
