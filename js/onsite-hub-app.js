// js/onsite-hub-app.js
// DOM glue for pages/onsite-hub.html. Pure logic: onsite-hub-engine.js. GAS is the only scoring
// authority; this page sends raw cells, shows server summaries, and enforces preview -> decide.
// Live callers must already have passed requireStaff(user).
import {
    parseDelimited, analyzeExport, chipText, buildIngestPayload,
    classifyError, preflightRows, canDecide, DEFAULT_ALLOWED,
} from './onsite-hub-engine.js';

// Same deployment URL as spot-dashboard-app.js / check-onsite*.html (update in place, never a new URL).
const ONSITE_API = 'https://script.google.com/macros/s/AKfycbxqyrFCMHgwna03zGskM2d7xrk9kNQu8L71VU4gbAfBfwr7aJy0uLF2JIQ3lq4TXNZIGw/exec';
// Open items 5-6 in the design doc: fill when known. Empty -> link rendered disabled.
const LINKS = { moodleMcq: '', moodleUnseen: ['', '', ''], gameshowAdmin: '', lsSheet: '' };

const INPUTS = [
    { id: 'mcq', kind: 'mcq', label: 'MCQ + MTF (KKUEXAM)' },
    { id: 'u1', kind: 'unseen', label: 'Unseen บทความ 1 — Economic evaluation' },
    { id: 'u2', kind: 'unseen', label: 'Unseen บทความ 2 — Malignant hyperthermia' },
    { id: 'u3', kind: 'unseen', label: 'Unseen บทความ 3 — Osteoporotic hip fracture' },
];

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

let call;                 // (action, payload) -> response object, throws on status:'error'
let allowed = DEFAULT_ALLOWED;
const grids = {};         // id -> string[][] | null
const analyses = {};      // id -> analyzeExport result | null
let pv = { previewToken: null, previewReady: false, previewStale: false, data: null };
let busy = false;
const log = [];

function toast(msg, bad) {
    const t = $('toast');
    t.textContent = msg; t.hidden = false;
    t.className = 'fixed bottom-4 left-1/2 -translate-x-1/2 px-4 py-2 rounded-lg text-sm text-white ' + (bad ? 'bg-red-700' : 'bg-slate-800');
    clearTimeout(toast._t); toast._t = setTimeout(() => { t.hidden = true; }, 5000);
}

function addLog(action, ok, text) {
    log.unshift(`${new Date().toLocaleTimeString('th-TH')}  ${ok ? 'OK ' : 'ERR'}  ${action}  ${text || ''}`);
    log.length = Math.min(log.length, 10);
    $('actionLog').textContent = log.join('\n');
}

/** Runs one backend action with spinner/disable + logging. Returns response or null on error. */
async function run(action, payload, btn) {
    if (busy) return null;
    busy = true; setBusy(true, btn);
    try {
        const res = await call(action, payload);
        addLog(action, true, '');
        return res;
    } catch (e) {
        const c = classifyError(e.message);
        addLog(action, false, c.code);
        toast(`${action}: ${c.text}`, true);
        if (c.code === 'INVALID_PREVIEW_TOKEN') { pv.previewStale = true; renderPreview(); }
        return null;
    } finally {
        busy = false; setBusy(false, btn);
    }
}

function setBusy(on, btn) {
    document.querySelectorAll('button[data-act]').forEach((b) => { b.disabled = on; });
    if (btn) btn.textContent = on ? '… กำลังทำงาน' : btn.dataset.label;
    if (!on) renderAll();
}

// ── confirm modal (no window.confirm). typed: exact word required, or null ──────────────
function confirmModal(title, body, typed) {
    return new Promise((resolve) => {
        $('mTitle').textContent = title;
        $('mBody').textContent = body;
        const inp = $('mInput'), ok = $('mOk');
        inp.hidden = !typed; inp.value = '';
        ok.disabled = !!typed;
        inp.oninput = () => { ok.disabled = inp.value !== typed; };
        const done = (v) => { $('modal').hidden = true; resolve(v); };
        ok.onclick = () => done(true);
        $('mCancel').onclick = () => done(false);
        $('modal').hidden = false;
    });
}

// ── step nav ────────────────────────────────────────────────────────────────────────
function showStep(n) {
    document.querySelectorAll('[data-step]').forEach((s) => { s.hidden = Number(s.dataset.step) !== n; });
    document.querySelectorAll('[data-stepbtn]').forEach((b) => {
        const on = Number(b.dataset.stepbtn) === n;
        b.className = 'stepbtn px-3 py-2 rounded-lg text-sm font-bold ' + (on ? 'bg-blue-700 text-white' : 'bg-white border border-slate-300 text-slate-700');
    });
}

// ── Step 1: inputs ──────────────────────────────────────────────────────────────────
function buildInputs() {
    $('inputs').innerHTML = INPUTS.map((inp) => `
        <div class="border border-slate-200 rounded-lg p-3 space-y-2" data-box="${inp.id}">
            <div class="font-bold text-sm">${esc(inp.label)}</div>
            <div class="drop border-2 border-dashed border-slate-300 rounded-lg p-3 text-center text-sm text-slate-500" data-drop="${inp.id}">
                ลากไฟล์ .csv / .tsv มาวาง หรือ <label class="text-blue-700 underline cursor-pointer">เลือกไฟล์<input type="file" accept=".csv,.tsv,.txt,text/csv" class="hidden" data-file="${inp.id}"></label>
            </div>
            <textarea rows="3" class="w-full border border-slate-300 rounded-lg p-2 text-xs font-mono" placeholder="หรือวางตารางที่ copy จาก Moodle (TSV)" data-paste="${inp.id}"></textarea>
            <div class="text-xs" data-chip="${inp.id}"></div>
        </div>`).join('');
    INPUTS.forEach((inp) => {
        const drop = document.querySelector(`[data-drop="${inp.id}"]`);
        drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('bg-blue-50'); });
        drop.addEventListener('dragleave', () => drop.classList.remove('bg-blue-50'));
        drop.addEventListener('drop', (e) => {
            e.preventDefault(); drop.classList.remove('bg-blue-50');
            const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
            if (f) readFile(inp.id, f);
        });
        document.querySelector(`[data-file="${inp.id}"]`).addEventListener('change', (e) => {
            const f = e.target.files[0]; if (f) readFile(inp.id, f);
        });
        document.querySelector(`[data-paste="${inp.id}"]`).addEventListener('input', (e) => setInput(inp.id, e.target.value));
    });
}

function readFile(id, file) {
    const r = new FileReader();
    r.onload = () => {
        document.querySelector(`[data-paste="${id}"]`).value = String(r.result).slice(0, 2000);
        setInput(id, String(r.result));
    };
    r.readAsText(file, 'utf-8');
}

function setInput(id, text) {
    const inp = INPUTS.find((i) => i.id === id);
    if (!String(text).trim()) { grids[id] = null; analyses[id] = null; }
    else { grids[id] = parseDelimited(text); analyses[id] = analyzeExport(grids[id], inp.kind, allowed); }
    pv.previewStale = !!pv.previewToken;   // any new input invalidates an earlier preview
    renderAll();
}

function renderInputs() {
    INPUTS.forEach((inp) => {
        const a = analyses[inp.id];
        const el = document.querySelector(`[data-chip="${inp.id}"]`);
        if (!el) return;
        const cls = !a ? 'text-slate-500' : a.ok ? 'text-emerald-700' : 'text-red-700';
        let html = `<span class="${cls}">${esc(chipText(a, inp.kind))}</span>`;
        if (a) a.warnings.forEach((w) => { html += `<div class="text-amber-700">⚠ ${esc(w)}</div>`; });
        if (a && a.errors.length > 1) a.errors.slice(1).forEach((w) => { html += `<div class="text-red-700">✗ ${esc(w)}</div>`; });
        el.innerHTML = html;
    });
    const mcqOk = !!analyses.mcq && analyses.mcq.ok;
    const un = ['u1', 'u2', 'u3'].map((k) => analyses[k]);
    const unCount = un.filter(Boolean).length;
    const unOk = unCount === 3 && un.every((a) => a.ok);
    const anyBad = INPUTS.some((i) => analyses[i.id] && !analyses[i.id].ok);
    let why = '';
    if (!mcqOk && !unOk) why = 'ใส่ MCQ หรือ Unseen ครบ 3 บทความ (ที่ผ่านการตรวจ) อย่างน้อยหนึ่งชุด';
    else if (unCount && unCount !== 3) why = 'Unseen ต้องใส่ครบ 3 บทความ';
    else if (anyBad) why = 'มีช่องที่ข้อมูลไม่ผ่านการตรวจ';
    $('btnIngest').disabled = busy || !!why;
    $('ingestWhy').textContent = why;
}

function renderIngestResult(res) {
    const part = (name, s) => !s ? '' : `<div class="text-sm"><b>${name}</b> ทีมที่ได้คะแนน ${esc(s.teamsWithScore ?? s.teamsScored ?? '?')}` +
        `${s.factor !== undefined ? ` · ตัวคูณ ×${esc(s.factor)}` : ''}${s.factors ? ` · ตัวคูณ ${esc(s.factors.map((f) => '×' + f).join(', '))}` : ''}` +
        `${(s.noShow || []).length ? ` · no-show ${s.noShow.length}` : ''}${(s.duplicates || []).length ? ` · ซ้ำ ${s.duplicates.length}` : ''}` +
        `${(s.problems || []).length ? `<div class="text-amber-700">⚠ ${esc(s.problems.slice(0, 5).join(' | '))}</div>` : ''}</div>`;
    $('ingestResult').innerHTML = part('MCQ', res.mcq) + part('Unseen', res.unseen);
}

// ── Preview / decide ────────────────────────────────────────────────────────────────
function renderPreview() {
    const box = $('previewBox');
    if (!pv.data) { box.innerHTML = '<p class="text-sm text-slate-500">ยังไม่ได้พรีวิว</p>'; }
    else {
        const rows = preflightRows(pv.data);
        const col = { ok: 'text-emerald-700', warn: 'text-amber-700', bad: 'text-red-700' };
        box.innerHTML = (pv.previewStale ? '<p class="text-sm font-bold text-red-700">พรีวิวนี้เก่าแล้ว (ข้อมูลเปลี่ยน) — กดพรีวิวใหม่ก่อนตัดสิน</p>' : '') +
            `<table class="w-full text-sm"><tbody>${rows.map((r) => `<tr class="border-b border-slate-100"><td class="py-1 pr-3 text-slate-600">${esc(r.label)}</td><td class="py-1 font-bold ${col[r.level]}">${esc(r.value)}</td></tr>`).join('')}</tbody></table>` +
            (pv.data.unscoredTeams.length ? `<details class="text-xs mt-1"><summary>ทีมที่ไม่มีคะแนน</summary>${esc(pv.data.unscoredTeams.join(', '))}</details>` : '') +
            `<div class="overflow-x-auto mt-2"><table class="w-full text-xs"><thead><tr class="text-left text-slate-500"><th>#</th><th>ทีม</th><th>รวม</th><th>Unseen</th><th>เวลาส่ง</th></tr></thead><tbody>` +
            pv.data.top45.map((t) => `<tr class="${t.rank === 40 ? 'border-b-2 border-red-500' : ''}"><td>${t.rank}</td><td>${esc(t.teamId)}</td><td>${esc(t.total)}</td><td>${esc(t.unseen)}</td><td>${t.submit == null ? '—' : esc(t.submit)}</td></tr>`).join('') +
            '</tbody></table></div>';
    }
    const ok = canDecide(pv);
    $('btnDecide').disabled = busy || !ok;
    $('decideWhy').textContent = ok ? '' : (pv.previewStale ? 'พรีวิวเก่า — กดพรีวิวใหม่' : (pv.data && !pv.previewReady ? 'คะแนนยังไม่พร้อม (< 50 ทีม)' : 'ต้องกดพรีวิวก่อน'));
    $('btnDownloadPv').disabled = !pv.data;
}

async function doIngest(btn) {
    let payload;
    try {
        payload = buildIngestPayload({ mcq: grids.mcq, unseen: [grids.u1, grids.u2, grids.u3] }, allowed, $('allowAfter').checked);
    } catch (e) { toast(e.message, true); return; }
    const res = await run('r1Ingest', payload, btn);
    if (!res) return;
    renderIngestResult(res);
    pv.previewStale = !!pv.previewToken;   // server data changed -> old token unusable
    renderPreview();                       // reflect stale state on Decide button now
    toast('นำเข้าแล้ว — กดพรีวิว');
    loadStatus();
}

async function doPreview(btn) {
    const res = await run('r1Preview', {}, btn);
    if (!res) return;
    pv = { previewToken: res.previewToken, previewReady: !!res.ready, previewStale: false, data: res };
    renderPreview();
}

async function doDecide(btn) {
    if (!canDecide(pv)) { toast('ต้องพรีวิวก่อนตัดสิน', true); return; }
    if (!(await confirmModal('ยืนยันตัดสินรอบ 1', 'เขียนอันดับ/ผ่านรอบ/กลุ่ม A-B-C ลงชีต LS_OnSite — ยกเลิกได้ด้วย Reset เท่านั้น', null))) return;
    const res = await run('r1Decide', { previewToken: pv.previewToken }, btn);
    if (!res) return;
    pv = { previewToken: null, previewReady: false, previewStale: false, data: null };   // token spent
    $('decideResult').textContent = `ตัดสินแล้ว — คะแนนตัด ${res.cutoff.total} (${res.cutoff.teamId}) · A/B/C = ${res.groups.A}/${res.groups.B}/${res.groups.C}` +
        (res.blindTies.length ? ` · ⚠ เสมอไม่มีเวลาส่ง: ${res.blindTies.join(', ')}` : '');
    renderPreview(); loadStatus();
}

function downloadPreview() {
    if (!pv.data) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(pv.data, null, 2)], { type: 'application/json' }));
    a.download = 'r1-preview.json'; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ── Step 2: rotation / Step 5: emergency ────────────────────────────────────────────
async function doRotationStart(btn) {
    let res = await run('rotationStart', {}, btn);
    if (!res && $('rotInfo').dataset.set === '1') {
        if (await confirmModal('เริ่มหมุนฐานใหม่', 'มีเวลาเริ่มอยู่แล้ว — เขียนทับด้วยเวลาตอนนี้?', null)) res = await run('rotationStart', { overwrite: true }, btn);
    }
    if (res) { toast('เริ่มหมุนฐานแล้ว'); loadStatus(); }
}
async function doRotationClear(btn) {
    if (!(await confirmModal('ล้างเวลาเริ่มหมุนฐาน', 'หน้า Staff Escort จะไม่แสดงตารางจนกว่าจะเริ่มใหม่', null))) return;
    if (await run('rotationClear', {}, btn)) { toast('ล้างแล้ว'); loadStatus(); }
}
async function doReset(btn) {
    if (!(await confirmModal('Reset รอบ 1', 'ล้างผลตัดสิน (K/L) และคืนสูตรอันดับชั่วคราว — พิมพ์ RESET เพื่อยืนยัน', 'RESET'))) return;
    const res = await run('r1Reset', { confirm: 'RESET' }, btn);
    if (res) {
        pv = { previewToken: null, previewReady: false, previewStale: false, data: null };
        toast(`Reset แล้ว (${res.cleared} แถว)`); renderPreview(); loadStatus();
    }
}

async function loadStatus() {
    let s;
    try { s = await call('hubStatus', {}); } catch (e) {
        $('statusBox').innerHTML = `<p class="text-sm text-red-700">${esc(classifyError(e.message).text)}</p>`; return;
    }
    if (s.allowedRawMax) { allowed = s.allowedRawMax; INPUTS.forEach((i) => { if (grids[i.id]) analyses[i.id] = analyzeExport(grids[i.id], i.kind, allowed); }); }
    const chk = (ok, t) => `<li class="${ok ? 'text-emerald-700' : 'text-red-700'}">${ok ? '✓' : '✗'} ${esc(t)}</li>`;
    $('statusBox').innerHTML = '<ul class="text-sm space-y-0.5">' +
        chk(s.lsRows === 100, `LS_OnSite ${s.lsRows}/100 แถว`) +
        chk(s.rosterUsernames > 0, `Roster username ${s.rosterUsernames}`) +
        chk(s.kDecided === 0, s.kDecided ? `ตัดสินรอบ 1 แล้ว (${s.kDecided} แถว) — นำเข้าซ้ำต้องติ๊ก "เขียนทับหลังตัดสิน"` : 'ยังไม่ตัดสินรอบ 1') +
        (s.mFilled ? `<li class="text-amber-700">⚠ มีคะแนน R2 แล้ว ${s.mFilled} ทีม (Reset ไม่ได้)</li>` : '') + '</ul>';
    const rot = s.rotationStartMs;
    $('rotInfo').dataset.set = rot ? '1' : '';
    $('rotInfo').textContent = rot ? `เริ่มหมุนฐานเมื่อ ${new Date(rot).toLocaleString('th-TH')}` : 'ยังไม่ได้ตั้งเวลาเริ่มหมุนฐาน';
}

function renderLinks() {
    const set = (id, url) => { const a = $(id); if (url) { a.href = url; a.classList.remove('pointer-events-none', 'opacity-40'); } };
    set('lnkGameshow', LINKS.gameshowAdmin);
    set('lnkSheet', LINKS.lsSheet);
}

function renderAll() { renderInputs(); renderPreview(); }

function bind() {
    document.querySelectorAll('[data-stepbtn]').forEach((b) => b.addEventListener('click', () => showStep(Number(b.dataset.stepbtn))));
    const acts = { btnIngest: doIngest, btnPreview: doPreview, btnDecide: doDecide, btnRotStart: doRotationStart, btnRotClear: doRotationClear, btnReset: doReset };
    Object.keys(acts).forEach((id) => {
        const b = $(id); b.dataset.act = '1'; b.dataset.label = b.textContent;
        b.addEventListener('click', () => acts[id](b));
    });
    $('btnDownloadPv').addEventListener('click', downloadPreview);
    $('btnStatus').addEventListener('click', loadStatus);
}

/** fixture: bool. Live: pass user (already through requireStaff). */
export async function initHubPage({ fixture, user }) {
    if (fixture) {
        const fx = await import('./onsite-hub-fixture.js');
        const fake = fx.createFixtureBackend();
        call = fake;
        $('fixtureBanner').hidden = false;
        $('staffName').textContent = fx.FIXTURE_ME.name;
        window.__hubFixtureCsv = fx.fixtureCsv;   // convenience for manual paste in the console
    } else {
        const { auth } = await import('./firebase-config.js');
        $('staffName').textContent = user.displayName || user.email;
        call = async (action, payload) => {
            const idToken = await auth.currentUser.getIdToken();
            // text/plain keeps this a simple CORS request (GAS web apps do not answer preflight)
            const res = await fetch(ONSITE_API, {
                method: 'POST',
                headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                body: JSON.stringify(Object.assign({}, payload, { action, idToken })),
            });
            const json = await res.json();
            if (json.status === 'error') throw new Error(json.message || action + ' failed');
            return json;
        };
    }
    buildInputs(); bind(); renderLinks(); showStep(1); renderAll();
    $('clock').textContent = '';
    setInterval(() => { $('clock').textContent = new Date().toLocaleTimeString('th-TH'); }, 1000);
    await loadStatus();
}
