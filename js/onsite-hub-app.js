// js/onsite-hub-app.js
// DOM glue for pages/onsite-hub.html. Pure logic: onsite-hub-engine.js. GAS is the only scoring
// authority; this page sends raw cells, shows server summaries, and enforces preview -> decide.
// Live callers must already have passed requireStaff(user).
import {
    parseDelimited, analyzeExport, chipText, buildIngestPayload,
    classifyError, preflightRows, canDecide, DEFAULT_ALLOWED,
    filterTeams, rotationState, roomsForSlot, phaseOf, countGradedCells, buildGameshowSetup,
    buildRanksPayload, awardSummaryLines, ROT, GROUPS, SPOT_CELLS,
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
let teams = [];           // getAllOnSiteTeams rows (roster drawer / top 8)
let hubStatus = null;     // last successful hubStatus
let spotScores = null;    // RTDB spot_grading_2026/scores (null = not loaded)
let rosterFocus = null;   // teamId pinned in the drawer
const PHASE_TEXT = { none: 'ยังไม่ตัดสิน R1', r1: 'R1 ตัดสินแล้ว', rotation: 'กำลังหมุนฐาน', r2: 'R2 push แล้ว' };

const teamLink = (id) => `<button type="button" class="team-link underline text-blue-700" data-team="${esc(id)}">${esc(id)}</button>`;

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

// Every gated action button: disabled while busy or blocked, and the hover title says why.
function gate(id, reason) {
    const b = $(id);
    b.disabled = busy || !!reason;
    b.title = reason || '';
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
        b.className = 'stepbtn px-3 py-2 rounded-lg text-sm font-bold ' + (on ? 'bg-[#E4B43C] text-[#0f1f4b]' :'bg-white border border-slate-300 text-slate-700');
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
    $('btnDownloadGrids').disabled = !INPUTS.some((i) => grids[i.id]);
    gate('btnIngest', why);
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
            pv.data.top45.map((t) => `<tr class="${t.rank === 40 ? 'border-b-2 border-red-500' : ''}"><td>${t.rank}</td><td>${teamLink(t.teamId)}</td><td>${esc(t.total)}</td><td>${esc(t.unseen)}</td><td>${t.submit == null ? '—' : esc(t.submit)}</td></tr>`).join('') +
            '</tbody></table></div>';
    }
    const decideWhy = canDecide(pv) ? '' : (pv.previewStale ? 'พรีวิวเก่า — กดพรีวิวใหม่' : (pv.data && !pv.previewReady ? 'คะแนนยังไม่พร้อม (< 50 ทีม)' : 'ต้องกดพรีวิวก่อน'));
    gate('btnDecide', decideWhy);
    $('decideWhy').textContent = decideWhy;
    $('btnDownloadPv').disabled = !pv.data;
    renderNext();
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
    if (!(await confirmModal('ล้างเวลาเริ่มหมุนฐาน (1/2)', 'หน้า Staff Escort จะไม่แสดงตารางจนกว่าจะเริ่มใหม่ — ต้องการล้างจริงหรือไม่?', null))) return;
    if (!(await confirmModal('ล้างเวลาเริ่มหมุนฐาน (2/2)', 'พิมพ์ CLEAR เพื่อยืนยันการล้างเวลาเริ่มหมุนฐาน', 'CLEAR'))) return;
    if (await run('rotationClear', {}, btn)) { toast('ล้างแล้ว'); loadStatus(); }
}
async function doReset(btn) {
    if (!(await confirmModal('Reset รอบ 1 (1/2)', 'ล้างผลตัดสิน (K/L) และคืนสูตรอันดับชั่วคราว — Top 40 / กลุ่ม A-B-C จะหายจากชีต ต้องการ Reset จริงหรือไม่?', null))) return;
    if (!(await confirmModal('Reset รอบ 1 (2/2)', 'พิมพ์ RESET เพื่อยืนยัน', 'RESET'))) return;
    const res = await run('r1Reset', { confirm: 'RESET' }, btn);
    if (res) {
        pv = { previewToken: null, previewReady: false, previewStale: false, data: null };
        ranksSavedAt = 0; exportedAt = 0;   // next-action card starts over
        toast(`Reset แล้ว (${res.cleared} แถว)`); renderPreview(); loadStatus();
    }
}

function setPing(ok) {
    const el = $('pingBadge'), t = new Date().toLocaleTimeString('th-TH');
    if (ok) { el.textContent = `GAS ● ${t}`; el.className = 'text-xs rounded-full px-2 py-0.5 bg-emerald-600 text-white'; setPing.okAt = t; }
    else { el.textContent = `GAS ✗ ล่าสุดสำเร็จ ${setPing.okAt || '—'}`; el.className = 'text-xs rounded-full px-2 py-0.5 bg-red-600 text-white'; }
}

async function loadStatus() {
    let s;
    try { s = await call('hubStatus', {}); } catch (e) {
        setPing(false);
        $('statusBox').innerHTML = `<p class="text-sm text-red-700">${esc(classifyError(e.message).text)}</p>`; return;
    }
    setPing(true);
    hubStatus = s;
    $('phaseBadge').textContent = PHASE_TEXT[phaseOf(s)];
    loadTeams();
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
    renderRotLive(); renderSpot(); renderDanger();
}

async function loadTeams() {
    try { teams = (await call('getAllOnSiteTeams', {})).teams || []; } catch (e) { return; }   // ping badge tracks hubStatus
    const fin = new Set(finalistIds());
    picks = Object.fromEntries(Object.entries(picks).filter(([id]) => fin.has(id)));   // drop picks that are no longer finalists
    renderGameshow(); renderAwards(); renderRoster(); renderSpot();
}

// ── Step 2 live rotation (same numbers as check-onsite-staff.html) ─────────────────────
const mmss = (ms) => { const s = Math.max(0, Math.ceil(ms / 1000)); return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0'); };

function renderRotLive() {
    const start = hubStatus && hubStatus.rotationStartMs;
    const rot = rotationState(start, Date.now());
    const head = {
        unknown: 'ยังไม่ได้เริ่มหมุนฐาน',
        active: `ฐานที่ ${rot.slot + 1}/${ROT.SLOTS} · เหลือ ${mmss(rot.remainMs || 0)}`,
        changeover: `🔔 เปลี่ยนฐาน (พัก ${ROT.GAP_MIN} นาที) → ฐานที่ ${rot.slot + 1}/${ROT.SLOTS} · อีก ${mmss(rot.remainMs || 0)}`,
        done: 'จบเดินฐานแล้ว (พักกลางวัน)',
    }[rot.state];
    let html = `<div class="font-bold text-lg">${esc(head)}</div>`;
    if (rot.state === 'active' || rot.state === 'changeover') {
        const rooms = roomsForSlot(rot.slot);
        html += `<div class="grid grid-cols-3 gap-2 text-sm">${GROUPS.map((g) => `<div class="border border-slate-200 rounded-lg p-2"><b>กลุ่ม ${g}</b><br>${esc(rooms[g])}</div>`).join('')}</div>` +
            (rot.state === 'changeover' ? '<div class="text-xs text-slate-500">ห้องด้านบนคือห้องของฐานถัดไป</div>' : '');
    }
    $('rotLive').innerHTML = html;
}

// ── Step 3 read-only Spot monitor ────────────────────────────────────────────────────
function renderSpot() {
    const n = spotScores ? countGradedCells(spotScores) : null;
    const pushed = hubStatus && hubStatus.mFilled > 0;
    const top = teams.filter((t) => t.r2Passed === true).sort((a, b) => a.teamId.localeCompare(b.teamId));
    $('spotMonitor').innerHTML =
        `<div>ตรวจแล้ว <b>${n == null ? '—' : n}</b> / ${SPOT_CELLS} ช่อง</div>` +
        `<div class="${pushed ? 'text-emerald-700' : 'text-slate-600'}">${pushed ? `ส่งผลเข้าชีตแล้ว (M ${hubStatus.mFilled} ทีม)` : 'ยังไม่ได้ส่งผลเข้าชีต'}</div>` +
        `<div>Top 8: ${top.length ? top.map((t) => teamLink(t.teamId)).join(', ') : '<span class="text-slate-500">ยังไม่มี</span>'}</div>`;
    $('lnkSpot').textContent = `Spot Master Dashboard · ตรวจ ${n == null ? '—' : n}/${SPOT_CELLS} · เข้าชีต ${(hubStatus && hubStatus.mFilled) || 0}/40`;
    renderNext();
}

// ── Next action card ─────────────────────────────────────────────────────────────────
// Derived only from hubStatus, the roster (r2Passed) and this tab's own save/export clicks.
// The two click flags are per tab: a reload forgets them, so the card re-asks (export is a
// full rewrite, safe to repeat) — it never skips a step.
let ranksSavedAt = 0, exportedAt = 0;
const NEXT_TONE = {
    wait: 'border-slate-300 bg-white text-slate-700',
    go: 'border-emerald-500 bg-emerald-50 text-emerald-900',
    cert: 'border-cyan-500 bg-cyan-50 text-cyan-900',
    done: 'border-slate-300 bg-slate-50 text-slate-700',
};
const NEXT_RING = { go: 'ring-emerald-400', cert: 'ring-cyan-400' };
const NEXT_TARGETS = ['btnPreview', 'btnDecide', 'btnRanksSave', 'btnAwardExport'];

function nextAction() {
    const s = hubStatus;
    if (!s) return null;
    const mcqN = s.lastMcq ? (s.lastMcq.teamsWithScore ?? s.lastMcq.teamsScored ?? 0) : 0;
    const finalists = teams.filter((t) => t.r2Passed === true).length;
    const graded = spotScores ? countGradedCells(spotScores) : null;
    const facts = [`MCQ ${mcqN}/100 ทีม`, `Unseen ${s.lastUnseen ? '✓' : '—'}`, `ตัดสิน R1 ${s.kDecided ? '✓' : '—'}`,
        `Spot ตรวจ ${graded == null ? '—' : graded}/${SPOT_CELLS}`, `Spot เข้าชีต ${s.mFilled || 0}/40`, `Game Show ${finalists}/8`];
    if (!s.kDecided) {
        if (!s.lastMcq || !s.lastUnseen) return { tone: 'wait', step: 1, facts,
            title: `รอผล MCQ (${mcqN}/100)${s.lastUnseen ? '' : ' · รอ Unseen 3 บทความ'}`,
            hint: 'นำเข้าไฟล์ที่ 1.1 เมื่อ KKUEXAM ปิดรอบ' };
        return { tone: 'go', step: 1, facts, target: canDecide(pv) ? 'btnDecide' : 'btnPreview',
            title: canDecide(pv) ? 'กด [1.3 ตัดสินรอบ 1]' : 'คะแนนเข้าครบ → กด [1.2 พรีวิวอันดับ] แล้ว [1.3 ตัดสินรอบ 1]',
            hint: mcqN < 100 ? `MCQ มีคะแนน ${mcqN}/100 ทีม — ตรวจรายการ no-show ในผลนำเข้าก่อน` : '' };
    }
    if (finalists < 8) {
        if (!exportedAt) return { tone: 'cert', step: 4, facts, target: 'btnAwardExport',
            title: 'R1 ตัดสินแล้ว → กด [🎓 Generate Award Certificates] (Top 40 + รางวัลบุคคล)',
            hint: 'จากนั้นดาวน์โหลด CSV ที่ Staff Escort › 🏆 สรุปรางวัล' };
        return { tone: 'wait', step: 3, facts, title: `รอผล Spot — ตรวจแล้ว ${graded == null ? '—' : graded}/${SPOT_CELLS} ช่อง`,
            hint: `ส่งออก Top 40 แล้ว ${new Date(exportedAt).toLocaleTimeString('th-TH')} · Push ผล Spot ที่ Spot Master Dashboard` };
    }
    if (!ranksSavedAt) return { tone: 'go', step: 4, facts, target: 'btnRanksSave',
        title: 'Top 8 พร้อม → หลังจบ Game Show เลือกอันดับ 1–8 แล้วกด [💾 บันทึกอันดับ Game Show]' };
    if (exportedAt < ranksSavedAt) return { tone: 'cert', step: 4, facts, target: 'btnAwardExport',
        title: 'บันทึกอันดับแล้ว → กด [🎓 Generate Award Certificates] อีกครั้ง (รวมรางวัล Game Show)' };
    return { tone: 'done', step: 0, facts, title: '✅ ส่งออกเกียรติบัตรครบแล้ว',
        hint: 'ดาวน์โหลด CSV ที่ Staff Escort › 🏆 สรุปรางวัล' };
}

function renderNext() {
    const el = $('nextAction');
    if (!el) return;
    NEXT_TARGETS.forEach((id) => $(id).classList.remove('ring-4', 'ring-offset-2', ...Object.values(NEXT_RING)));
    document.querySelectorAll('[data-nextbadge]').forEach((b) => b.remove());
    const n = nextAction();
    if (!n) return;
    if (n.target && NEXT_RING[n.tone]) {
        const t = $(n.target);
        t.classList.add('ring-4', 'ring-offset-2', NEXT_RING[n.tone]);
        if (!t.disabled) t.insertAdjacentHTML('afterend', '<span data-nextbadge class="self-center animate-pulse rounded-full bg-emerald-600 text-white text-xs font-bold px-2 py-1">👉 ถึงคิวแล้ว กดปุ่มนี้</span>');
    }
    el.className = 'rounded-xl border-2 p-4 ' + NEXT_TONE[n.tone];
    el.innerHTML = `<div class="text-xs font-bold opacity-70">ขั้นต่อไป</div>
        <div class="text-lg font-bold">${esc(n.title)}</div>
        ${n.hint ? `<div class="text-sm">${esc(n.hint)}</div>` : ''}
        <div class="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
            ${n.facts.map((f) => `<span class="rounded-full bg-white border border-slate-200 text-slate-700 px-2 py-0.5">${esc(f)}</span>`).join('')}
            ${n.step ? `<button type="button" data-gostep="${n.step}" class="ml-auto rounded-lg bg-slate-800 text-white px-3 py-1.5 text-sm font-bold">ไปขั้น ${n.step} →</button>` : ''}
        </div>`;
}

async function watchSpot(fixture) {
    if (fixture) { spotScores = (await import('./onsite-hub-fixture.js')).fixtureSpotScores(20); renderSpot(); return; }
    try {
        const { db, ref, onValue } = await import('./firebase-config.js');
        onValue(ref(db, 'spot_grading_2026/scores'), (s) => { spotScores = s.val() || {}; renderSpot(); }, () => {});
    } catch (e) { /* monitor stays at — */ }
}

// ── Step 4 gameshow setup ────────────────────────────────────────────────────────────
function renderGameshow() {
    const g = buildGameshowSetup(teams);
    $('gsWarn').textContent = g.ok || !teams.length ? '' : g.warning;
    $('gsGrid').innerHTML = g.stations.map((s) => `<div class="border border-slate-200 rounded-lg p-2 text-sm"><span class="rounded-full px-2 py-0.5 text-xs font-bold" style="background:#F5D77A;color:#0f1f4b">ฐาน ${s.station}</span> ${teamLink(s.teamId)}<div class="truncate">${esc(s.teamName)}</div><div class="text-xs text-slate-500 truncate">${esc(s.school || '—')}</div></div>`).join('');
    $('btnGsCopy').disabled = !g.ok; $('btnGsDownload').disabled = !g.ok;
}

// ── Step 4 awards: Gameshow places 1-8 -> r3SetRanks, then awardExport ───────────────────
let picks = {};   // { teamId: rank } — ties allowed

const finalistIds = () => buildGameshowSetup(teams).stations.map((s) => s.teamId);

function renderAwards() {
    const g = buildGameshowSetup(teams);
    $('awardGrid').innerHTML = g.stations.map((s) => `<label class="text-sm block"><span class="font-bold">${esc(s.teamId)} ${esc(s.teamName)}</span>
        <select data-team="${esc(s.teamId)}" class="mt-1 w-full border border-slate-300 rounded-lg px-2 py-1 bg-white">
            <option value="">— เลือกอันดับ —</option>
            ${[1, 2, 3, 4, 5, 6, 7, 8].map((n) => `<option value="${n}"${String(picks[s.teamId]) === String(n) ? ' selected' : ''}>อันดับ ${n}</option>`).join('')}
        </select></label>`).join('');
    const r = buildRanksPayload(picks, g.stations.map((s) => s.teamId));
    $('awardWarn').textContent = Object.keys(picks).length || !g.ok ? r.error : '';
    gate('btnRanksSave', r.ok ? '' : (r.error || 'เลือกอันดับ 1–8 ให้ครบทุกทีม'));
    // Top 40 + individual certificates exist once R1 is decided; Game Show rows fill in on a re-run.
    gate('btnAwardExport', g.ok || (hubStatus && hubStatus.kDecided > 0) ? '' : 'ต้องตัดสินรอบ 1 ก่อน');
}

function renderDanger() {
    const s = hubStatus;
    gate('btnReset', s && s.mFilled > 0 ? `มีคะแนน R2 แล้ว ${s.mFilled} ทีม — Reset ไม่ได้` : '');
    gate('btnRotClear', s && !s.rotationStartMs ? 'ยังไม่ได้ตั้งเวลาเริ่มหมุนฐาน' : '');
}

async function doRanksSave(btn) {
    const r = buildRanksPayload(picks, finalistIds());
    if (!r.ok) { toast(r.error, true); return; }
    if (!(await confirmModal('บันทึกอันดับ Game Show', r.ranks.map((x) => `${x.rank}. ${x.teamId}`).join('  ') + ' — เขียนทับคอลัมน์ R3_Rank ในชีต LS_OnSite', null))) return;
    const res = await run('r3SetRanks', { ranks: r.ranks }, btn);
    if (res) { ranksSavedAt = Date.now(); toast(`บันทึกอันดับแล้ว (${res.written} ทีม)`); renderNext(); }
}

async function doAwardExport(btn) {
    if (!(await confirmModal('สร้างเกียรติบัตร', 'สร้าง/เขียนทับชีตส่งออกเกียรติบัตรจากข้อมูลล่าสุด — ตรวจว่าบันทึกอันดับ Game Show แล้ว', null))) return;
    const res = await run('awardExport', {}, btn);
    if (res) { exportedAt = Date.now(); $('awardResult').textContent = awardSummaryLines(res).join('\n'); $('awardResult').hidden = false; toast('สร้างเกียรติบัตรแล้ว'); renderNext(); }
}

const gsJson = () => JSON.stringify(buildGameshowSetup(teams).stations, null, 2);

function download(name, text) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ── Roster drawer ────────────────────────────────────────────────────────────────────
function openRoster(teamId) {
    rosterFocus = teamId || null;
    $('rosterSearch').value = teamId || '';
    $('rosterDrawer').hidden = false; $('rosterBackdrop').hidden = false;
    renderRoster(); $('rosterSearch').focus();
}
function closeRoster() { $('rosterDrawer').hidden = true; $('rosterBackdrop').hidden = true; }

function renderRoster() {
    if ($('rosterDrawer').hidden) return;
    let list = filterTeams(teams, $('rosterSearch').value);
    if (rosterFocus && $('rosterSearch').value === rosterFocus) list = teams.filter((t) => t.teamId === rosterFocus);
    $('rosterCount').textContent = `${list.length} / ${teams.length} ทีม`;
    const badge = (txt) => `<span class="rounded-full bg-slate-100 px-2 py-0.5">${esc(txt)}</span>`;
    $('rosterList').innerHTML = list.slice(0, 50).map((t) => {
        const r1 = t.r1Passed === true ? 'R1 ผ่าน' : t.r1Passed === false ? 'R1 ไม่ผ่าน' : 'R1 ยังไม่ตัดสิน';
        const r2 = t.r2Passed === true ? 'R2 ผ่าน' : t.r2Passed === false ? 'R2 ไม่ผ่าน' : 'R2 —';
        return `<article class="border border-slate-200 rounded-lg p-3 text-sm">
            <div class="flex items-center gap-2"><span class="rounded-full px-2 py-0.5 text-xs font-bold" style="background:#F5D77A;color:#0f1f4b">${esc(t.teamId)}</span><b class="truncate">${esc(t.teamName) || '(ไม่มีชื่อทีม)'}</b></div>
            ${t.school || t.category ? `<div class="text-xs text-slate-600">${esc([t.school, t.category].filter(Boolean).join(' · '))}</div>` : ''}
            <ol class="list-decimal list-inside text-slate-700 mt-1">${(t.members || []).map((m) => `<li>${esc(m)}</li>`).join('')}</ol>
            <div class="mt-2 flex flex-wrap gap-1 text-xs">${badge(r1)}${t.activityGroup ? badge('กลุ่ม ' + t.activityGroup) : ''}${badge(r2)}${t.r2Passed === true ? badge('Gameshow finalist') : ''}</div>
        </article>`;
    }).join('') || '<p class="text-sm text-slate-500 text-center py-6">ไม่พบทีม</p>';
}

function renderLinks() {
    const set = (id, url) => { const a = $(id); if (url) { a.href = url; a.classList.remove('pointer-events-none', 'opacity-40'); } };
    set('lnkGameshow', LINKS.gameshowAdmin);
    set('lnkSheet', LINKS.lsSheet);
}

function renderAll() { renderInputs(); renderPreview(); renderAwards(); renderDanger(); renderNext(); }

function bind() {
    document.querySelectorAll('[data-stepbtn]').forEach((b) => b.addEventListener('click', () => showStep(Number(b.dataset.stepbtn))));
    const acts = { btnIngest: doIngest, btnPreview: doPreview, btnDecide: doDecide, btnRotStart: doRotationStart, btnRotClear: doRotationClear, btnReset: doReset, btnRanksSave: doRanksSave, btnAwardExport: doAwardExport };
    Object.keys(acts).forEach((id) => {
        const b = $(id); b.dataset.act = '1'; b.dataset.label = b.textContent;
        b.addEventListener('click', () => acts[id](b));
    });
    $('awardGrid').addEventListener('change', (e) => {
        const s = e.target.closest && e.target.closest('select[data-team]');
        if (s) { picks[s.dataset.team] = s.value; renderAwards(); renderNext(); }
    });
    $('nextAction').addEventListener('click', (e) => {
        const b = e.target.closest && e.target.closest('[data-gostep]');
        if (!b) return;
        showStep(Number(b.dataset.gostep));
        const n = nextAction();
        if (n && n.target) $(n.target).scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
    $('btnDownloadPv').addEventListener('click', downloadPreview);
    $('btnStatus').addEventListener('click', loadStatus);
    $('btnDownloadGrids').addEventListener('click', () => download('r1-raw-grids.json', JSON.stringify({ mcq: grids.mcq || null, unseen: [grids.u1 || null, grids.u2 || null, grids.u3 || null] }, null, 2)));
    $('btnGsCopy').addEventListener('click', async () => {
        try { await navigator.clipboard.writeText(gsJson()); toast('คัดลอก JSON แล้ว'); } catch (e) { toast('คัดลอกไม่สำเร็จ — ใช้ปุ่มดาวน์โหลด', true); }
    });
    $('btnGsDownload').addEventListener('click', () => download('gameshow_setup.json', gsJson()));
    $('btnRoster').addEventListener('click', () => openRoster());
    $('rosterClose').addEventListener('click', closeRoster);
    $('rosterBackdrop').addEventListener('click', closeRoster);
    $('rosterSearch').addEventListener('input', () => { rosterFocus = null; renderRoster(); });
    document.addEventListener('click', (e) => {
        const b = e.target.closest && e.target.closest('.team-link');
        if (b) openRoster(b.dataset.team);
    });
    document.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); openRoster(); }
        else if (e.key === 'Escape' && !$('rosterDrawer').hidden) closeRoster();
    });
}

/** fixture: bool. Live: pass user (already through requireStaff). */
export async function initHubPage({ fixture, user }) {
    if (fixture) {
        const fx = await import('./onsite-hub-fixture.js');
        const fake = fx.createFixtureBackend({ r2: new URLSearchParams(location.search).get('r2') === '1' });
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
    setInterval(() => { $('clock').textContent = new Date().toLocaleTimeString('th-TH'); renderRotLive(); }, 1000);
    setInterval(loadStatus, 30000);   // GAS caches rows ~45 s; also drives ping badge
    watchSpot(fixture);
    await loadStatus();
}
