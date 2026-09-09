// js/saq-grading-logic.js
// หน้าตรวจ SAQ รอบ 0 (ขั้นที่ 4 — กรรมการตัดสินคลัสเตอร์ที่ AI ไม่ชัดเจน)
//
// คุยกับ GAS โปรเจกต์ "MedQuiz 2026 Exam Received" ผ่าน deployment เดียวกับ
// dashboard/essay-grading (doGet + doPost อย่างละหนึ่งตัวต่อโปรเจกต์ → แยกด้วย action)
//   GET  ?action=getSaqClusters&itemId=..    → 10_SaqGrading.js _handleGetSaqClusters
//   POST action=submitSaqTriage              → _handleSaqTriageDecision   (ทีละคลัสเตอร์)
//   POST action=commitSaqHumanDecisions      → _handleCommitSaqDecisions  (ยืนยันทั้งข้อ)
//
// หน้านี้ไม่แตะ syncExamData() และไม่เขียนชีตจัดอันดับเลย — การซิงก์คะแนน (ขั้นที่ 5)
// ยังต้องสั่งจากเมนูในชีตเท่านั้น และต้องรันครั้งเดียวหลังยืนยันครบทั้ง 7 ข้อ
import { DASHBOARD_API_URL, db, ref, set, remove, onValue } from './firebase-config.js';

const API_URL = DASHBOARD_API_URL;

// ตรงกับ SAQ_CONFIG.ITEMS ใน 10_SaqGrading.js — ใช้วาดแท็บก่อนโหลดครั้งแรก
// จากนั้นยึดตามรายการที่เซิร์ฟเวอร์ส่งกลับมา
const DEFAULT_ITEMS = ['4.1', '5.1', '6.1', '7.1', '8.1', '9.1', '10.1'];

const FILTERS = {
    ALL: 'ทั้งหมด',
    UNCONFIRMED: 'ยังไม่ถูกยืนยัน',
    PENDING: 'ต้องตัดสิน',
    UNSURE: 'AI ไม่แน่ใจ',
    AI_CORRECT: 'AI ว่าถูก',
    AI_INCORRECT: 'AI ว่าผิด',
};

// ลำดับตัวเลือกที่ ← → วนถึง — ตรงกับลำดับปุ่มในการ์ดและคีย์ลัด 1/2/3
const DECISIONS = ['CORRECT', 'INCORRECT', 'UNSURE'];

// โหนด RTDB สำหรับให้กรรมการหลายคนเห็นคำตัดสินของกันและกันทันที
// เป็นชั้นเสริมเท่านั้น — ชีต (ผ่าน GAS) ยังเป็นแหล่งข้อมูลจริงเสมอ
const LIVE_ROOT = 'saqGrading';

const JUDGMENT_PILL = {
    CORRECT: { text: 'ถูก', cls: 'bg-emerald-100 text-emerald-800 border-emerald-300' },
    INCORRECT: { text: 'ผิด', cls: 'bg-rose-100 text-rose-800 border-rose-300' },
    UNSURE: { text: 'ไม่แน่ใจ', cls: 'bg-amber-100 text-amber-900 border-amber-300' },
};

const STATE_BADGE = {
    CONFIRMED: { text: '✅ ยืนยันแล้ว', cls: 'bg-emerald-600 text-white' },
    HUMAN_READY: { text: '👤 กรรมการตัดสินแล้ว', cls: 'bg-sky-600 text-white' },
    AI_READY: { text: '🤖 รับผล AI ได้', cls: 'bg-slate-500 text-white' },
    PENDING: { text: '⏳ ต้องตัดสิน', cls: 'bg-amber-500 text-white' },
};

// ── state ───────────────────────────────────────────────────────────────────
let getIdToken = async () => '';
let me = { email: '', name: '' };
let items = DEFAULT_ITEMS.slice();
let itemId = DEFAULT_ITEMS[0];
let payload = null;          // ผลลัพธ์ getSaqClusters ล่าสุด
let filter = 'ALL';
let cursor = 0;              // ตำแหน่งการ์ดที่โฟกัส (index ใน visible())
let selection = 0;           // ตัวเลือกที่ ← → ชี้อยู่ในการ์ดที่โฟกัส (index ใน DECISIONS)
let view = 'CARD';           // CARD = การ์ดเต็ม · TABLE = ตารางแบบแน่น
const inFlight = new Set();  // clusterId ที่กำลังส่งคำตัดสิน — กันกดรัว
const syncState = new Map(); // clusterId → 'pending' | 'synced' | 'error' (สถานะซิงก์ลงชีต)

let liveOn = true;           // ปิดตัวเองถ้ากติกา RTDB ไม่ให้เขียนโหนดนี้
let liveOff = null;          // ตัวยกเลิก onValue ของข้อก่อนหน้า

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const escRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// ── ไฮไลต์คำตอบนักเรียน ─────────────────────────────────────────────────────
/**
 * คืน HTML ของข้อความคำตอบพร้อมไฮไลต์ — ปลอดภัยกับ XSS โดยลำดับ:
 *   1) escape ข้อความนักเรียนก่อน (ข้อความดิบไม่มีทางกลายเป็น HTML)
 *   2) escape คำค้นด้วย เพื่อให้เทียบกับข้อความที่ escape แล้วได้ตรงกัน
 *   3) แทนที่รอบเดียวด้วย regex alternation — ไม่วนซ้ำ จึงไม่มีทางไปแมตช์
 *      ข้อความในแท็ก <mark> ที่เพิ่งใส่เข้าไป
 *
 * สีเขียว = คำที่ AI รายงานว่าเจอ (Matched_Keywords)
 * สีเหลือง = คำจากเฉลย/คำพ้องที่ AI ไม่ได้รายงาน (กรรมการควรดูเอง)
 *
 * ไม่ใช้ \b เพราะข้อความไทยไม่มีขอบเขตคำแบบนั้น และคำอย่าง "HCO3-" ลงท้ายด้วย
 * อักขระที่ไม่ใช่ตัวอักษร — \b จะทำให้ไฮไลต์หลุด
 */
function markup(text, aiSet, matcher) {
    const safe = esc(text);
    if (!matcher) return safe;

    const AI_CLS = 'bg-emerald-100 text-emerald-900 font-bold px-1 py-0.5 rounded border border-emerald-300';
    const REF_CLS = 'bg-amber-100 text-amber-900 font-bold px-1 py-0.5 rounded border border-amber-300';

    matcher.re.lastIndex = 0;
    return safe.replace(matcher.re, (hit) =>
        `<mark class="${aiSet.has(hit.toLowerCase()) ? AI_CLS : REF_CLS}">${hit}</mark>`);
}

/**
 * รูปแบบตรงไปตรงมาของกฎข้างบน (ไม่แคช regex) — เป็นตัวที่ชุดทดสอบ node เรียก
 * ส่วนหน้าเว็บใช้ highlightCluster() ที่ใช้ regex ตัวเดียวกันแบบแคชไว้
 */
export function highlightAnswer(text, matchedKeywords, refTokens) {
    const aiSet = tokenSet(matchedKeywords);
    return markup(text, aiSet, buildMatcher([...tokenSet(refTokens), ...aiSet]));
}

/** คำค้นที่ escape แล้ว (lowercase) — ทิ้งคำสั้นเกินจนจะไฮไลต์ทั้งบรรทัด */
function tokenSet(list) {
    const out = new Set();
    (list || []).forEach((raw) => {
        const t = String(raw || '').trim();
        if (t.length < 2) return;
        const key = esc(t).toLowerCase();
        if (key) out.add(key);
    });
    return out;
}

/** คอมไพล์ regex เดียวจากคำค้นทั้งหมด — ยาวก่อน เพื่อให้ "51.2 mmHg" ชนะ "51.2" */
function buildMatcher(tokens) {
    const ordered = [...new Set(tokens)].sort((a, b) => b.length - a.length);
    if (!ordered.length) return null;
    return { set: new Set(ordered), re: new RegExp('(' + ordered.map(escRegex).join('|') + ')', 'gi') };
}

/**
 * ตัวไฮไลต์ที่ใช้ร่วมกันทุกการ์ดของข้อนี้ — คอมไพล์ครั้งเดียวตอนโหลดข้อ
 * ไม่ใช่ครั้งละการ์ด (ข้อ 4.1 มี ~535 คลัสเตอร์ จะกลายเป็น 535 regex ต่อการกดปุ่มหนึ่งครั้ง)
 * การ์ดไหนมีคำที่ AI รายงานแต่ไม่อยู่ในเฉลย ค่อยคอมไพล์เฉพาะการ์ดนั้น
 */
let baseMatcher = null;

function rebuildBaseMatcher() {
    const it = payload?.item;
    baseMatcher = it ? buildMatcher([...tokenSet([...(it.keywords || []), it.answerKey])]) : null;
}

function highlightCluster(c) {
    const aiSet = tokenSet(c.matchedKeywords);
    const extra = [...aiSet].filter((t) => !baseMatcher || !baseMatcher.set.has(t));
    const m = extra.length
        ? buildMatcher([...(baseMatcher ? baseMatcher.set : []), ...aiSet])
        : baseMatcher;
    return markup(c.text, aiSet, m);
}

// ── ตัวกรอง ────────────────────────────────────────────────────────────────
/**
 * UNCONFIRMED กว้างกว่า PENDING — ไม่ใช่ตัวเดียวกัน
 *   PENDING     = ยังต้องให้กรรมการตัดสิน (AI ไม่แน่ใจ หรือกรรมการพักไว้)
 *   UNCONFIRMED = ทุกใบที่ยังไม่ถูกประทับ Confirmed รวม HUMAN_READY และ AI_READY
 *                 ที่ตัดสินแล้วแต่ยังไม่ได้กดยืนยันทั้งข้อ
 */
function visible() {
    const all = payload?.clusters || [];
    switch (filter) {
        case 'UNCONFIRMED': return all.filter((c) => c.humanStatus !== 'Confirmed');
        case 'PENDING': return all.filter((c) => c.state === 'PENDING');
        case 'UNSURE': return all.filter((c) => c.aiJudgment === 'UNSURE');
        case 'AI_CORRECT': return all.filter((c) => c.aiJudgment === 'CORRECT');
        case 'AI_INCORRECT': return all.filter((c) => c.aiJudgment === 'INCORRECT');
        default: return all;
    }
}

/** เหมือน _saqClusterState() ฝั่ง GAS — ใช้ตอนคาดผลล่วงหน้าและตอนรับผลจากกรรมการคนอื่น */
function stateOf(c) {
    if (c.humanStatus === 'Confirmed') return 'CONFIRMED';
    if (c.humanJudgment === 'UNSURE') return 'PENDING';
    if (c.humanJudgment === 'CORRECT' || c.humanJudgment === 'INCORRECT') return 'HUMAN_READY';
    if (c.aiJudgment === 'CORRECT' || c.aiJudgment === 'INCORRECT') return 'AI_READY';
    return 'PENDING';
}

function counts() {
    return payload?.counts || null;
}

// ── render ─────────────────────────────────────────────────────────────────
function renderTabs() {
    const prog = {};
    (payload?.progress || []).forEach((p) => { prog[p.itemId] = p; });

    $('itemTabs').innerHTML = items.map((it) => {
        const p = prog[it];
        const active = it === itemId;
        const pending = p ? p.pending : null;
        const sub = !p || !p.hasManifest
            ? 'ยังไม่ได้สร้างคลัสเตอร์'
            : !p.hasAiResults
                ? 'ยังไม่มีผล AI'
                : pending === 0
                    ? `พร้อมยืนยัน · ${p.clusters} คลัสเตอร์`
                    : `ต้องตัดสิน ${pending}`;
        const tone = !p || !p.hasAiResults
            ? 'text-slate-400'
            : pending === 0 ? 'text-emerald-600 font-bold' : 'text-amber-600 font-bold';
        return `
            <button data-item="${esc(it)}"
                class="saq-tab shrink-0 px-4 py-2 rounded-xl border text-left transition-all ${active
                ? 'bg-[#1e3a8a] text-white border-[#1e3a8a] shadow'
                : 'bg-white text-slate-700 border-slate-200 hover:border-[#1e3a8a]'}">
                <span class="block text-sm font-extrabold">ข้อ ${esc(it)}</span>
                <span class="block text-[11px] ${active ? 'text-white/80' : tone}">${esc(sub)}</span>
            </button>`;
    }).join('');

    [...document.querySelectorAll('.saq-tab')].forEach((b) => {
        b.onclick = () => load(b.dataset.item);
    });
}

function renderReference() {
    const it = payload?.item;
    if (!it) { $('refBox').innerHTML = ''; return; }

    const kw = (it.keywords || []).map((k) =>
        `<span class="inline-block bg-white border border-amber-300 text-amber-900 rounded-lg px-2 py-0.5 text-xs font-bold mr-1 mb-1">${esc(k)}</span>`
    ).join('') || '<span class="text-xs text-slate-400">— ไม่มีคำพ้องที่กำหนดไว้ —</span>';

    $('refBox').innerHTML = `
        <div class="flex flex-wrap items-start gap-x-6 gap-y-2">
            <div class="shrink-0">
                <p class="text-[10px] uppercase tracking-widest text-slate-400">ข้อ</p>
                <p class="text-2xl font-extrabold text-[#0f1f4b] leading-none">${esc(it.itemId)}</p>
                <p class="text-[11px] text-slate-500 mt-1">เต็ม ${it.pointsPerItem} คะแนน (ถูก/ผิด)</p>
            </div>
            <div class="grow min-w-[240px]">
                <p class="text-[10px] uppercase tracking-widest text-slate-400">เฉลยทางการ</p>
                ${it.keyError
            ? `<p class="text-sm text-rose-600 font-bold">${esc(it.keyError)}</p>`
            : `<p class="text-lg font-extrabold text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-1 inline-block">${esc(it.answerKey)}</p>`}
            </div>
            <div class="grow min-w-[240px]">
                <p class="text-[10px] uppercase tracking-widest text-slate-400">คำพ้อง / คำที่ยอมรับ</p>
                <div class="mt-1">${kw}</div>
            </div>
            ${it.notes ? `
            <div class="grow min-w-[240px]">
                <p class="text-[10px] uppercase tracking-widest text-slate-400">เกณฑ์ / ค่าที่ยอมรับได้</p>
                <p class="text-xs text-slate-700 bg-white border border-slate-200 rounded-lg px-3 py-2">${esc(it.notes)}</p>
            </div>` : ''}
        </div>`;
}

function renderFilters() {
    const c = counts();
    const all = payload?.clusters || [];
    const n = {
        ALL: all.length,
        // นับตรงจากเงื่อนไขเดียวกับ visible() เพื่อไม่ให้ตัวเลขกับรายการหลุดจากกัน
        UNCONFIRMED: all.filter((x) => x.humanStatus !== 'Confirmed').length,
        PENDING: c ? c.pending : 0,
        UNSURE: c ? c.aiUnsure : 0,
        AI_CORRECT: c ? c.aiCorrect : 0,
        AI_INCORRECT: c ? c.aiIncorrect : 0,
    };
    $('filterBar').innerHTML = Object.keys(FILTERS).map((k) => `
        <button data-filter="${k}"
            class="saq-filter px-3 py-1.5 rounded-lg text-xs font-bold border transition-all ${filter === k
            ? 'bg-[#1e3a8a] text-white border-[#1e3a8a]'
            : 'bg-white text-slate-600 border-slate-200 hover:border-[#1e3a8a]'}">
            ${esc(FILTERS[k])} <span class="opacity-70">(${n[k]})</span>
        </button>`).join('');

    [...document.querySelectorAll('.saq-filter')].forEach((b) => {
        b.onclick = () => { filter = b.dataset.filter; cursor = 0; selection = 0; renderFilters(); renderRows(); };
    });
}

function renderViewSwitch() {
    const opt = { CARD: ['fa-list', 'การ์ด'], TABLE: ['fa-table-list', 'ตาราง'] };
    $('viewSwitch').innerHTML = Object.keys(opt).map((k) => `
        <button data-view="${k}"
            class="saq-view px-3 py-1.5 rounded-lg text-xs font-bold border transition-all ${view === k
            ? 'bg-slate-800 text-white border-slate-800'
            : 'bg-white text-slate-600 border-slate-200 hover:border-slate-800'}">
            <i class="fa-solid ${opt[k][0]}"></i> ${opt[k][1]}
        </button>`).join('');

    [...document.querySelectorAll('.saq-view')].forEach((b) => {
        b.onclick = () => { view = b.dataset.view; renderViewSwitch(); renderRows(); scrollToCursor(); };
    });
}

const BTN_STYLE = {
    CORRECT: {
        label: 'ถูก', hotkey: '1',
        on: 'bg-emerald-600 text-white border-emerald-600',
        off: 'bg-white text-emerald-700 border-emerald-200 hover:border-emerald-500',
    },
    INCORRECT: {
        label: 'ผิด', hotkey: '2',
        on: 'bg-rose-600 text-white border-rose-600',
        off: 'bg-white text-rose-700 border-rose-200 hover:border-rose-500',
    },
    UNSURE: {
        label: 'ไม่แน่ใจ', hotkey: '3',
        on: 'bg-amber-500 text-white border-amber-500',
        off: 'bg-white text-amber-700 border-amber-200 hover:border-amber-500',
    },
};

/** ปุ่มตัดสินชุดเดียวกันทั้งมุมมองการ์ดและตาราง — ต่างแค่ขนาด */
function decideBtns(c, compact) {
    const size = compact
        ? 'px-2 py-1 text-[11px] rounded-lg'
        : 'grow px-4 py-3 text-sm rounded-xl';
    return DECISIONS.map((d) => {
        const s = BTN_STYLE[d];
        const on = c.humanJudgment === d;
        return `<button data-cluster="${esc(c.clusterId)}" data-decision="${d}"
            class="saq-decide ${size} border-2 font-extrabold transition-all ${on ? s.on : s.off}">
            <span class="inline-block w-4 h-4 leading-4 rounded bg-black/10 text-[10px] mr-1">${s.hotkey}</span>${s.label}
        </button>`;
    }).join('');
}

/** ป้ายบอกว่าคำตัดสินนี้ลงชีตแล้วหรือยัง — ชั้น RTDB ทาสีทันที ชีตตามมาทีหลัง */
function syncPill(clusterId) {
    const s = syncState.get(clusterId);
    if (!s) return '';
    const p = {
        pending: ['fa-circle-notch fa-spin', 'text-slate-400', 'กำลังบันทึกลงชีต'],
        synced: ['fa-cloud-arrow-up', 'text-emerald-600', 'บันทึกลงชีตแล้ว'],
        error: ['fa-triangle-exclamation', 'text-rose-600', 'บันทึกลงชีตไม่สำเร็จ'],
    }[s];
    return `<span class="text-[11px] ${p[1]}" title="${p[2]}"><i class="fa-solid ${p[0]}"></i></span>`;
}

function cardHtml(c, i) {
    const badge = STATE_BADGE[c.state] || STATE_BADGE.PENDING;
    const ai = JUDGMENT_PILL[c.aiJudgment];
    const human = JUDGMENT_PILL[c.humanJudgment];
    const focused = i === cursor;

    return `
    <article id="card-${esc(c.clusterId)}" data-index="${i}"
        class="saq-card bg-white rounded-2xl border ${focused ? 'border-[#1e3a8a] ring-2 ring-[#1e3a8a]/30' : 'border-slate-200'} shadow-sm p-4 mb-3">
        <header class="flex flex-wrap items-center gap-2 mb-3">
            <span class="font-mono text-xs font-bold text-slate-500">${esc(c.clusterId)}</span>
            <span class="text-[11px] font-bold bg-slate-100 text-slate-700 rounded-full px-2 py-0.5">${c.teamCount} ทีม</span>
            <span class="text-[11px] bg-slate-100 text-slate-600 rounded-full px-2 py-0.5">${c.wordCount} คำ</span>
            ${c.isOverlong ? `<span class="text-[11px] font-bold bg-amber-100 text-amber-900 border border-amber-300 rounded-full px-2 py-0.5">⚠️ ยาวผิดปกติ — สงสัยคัดลอกจาก AI</span>` : ''}
            ${c.isEmptyCluster ? `<span class="text-[11px] font-bold bg-slate-200 text-slate-700 rounded-full px-2 py-0.5">ไม่ได้ตอบ — 0 อัตโนมัติ</span>` : ''}
            <span class="ml-auto">${syncPill(c.clusterId)}</span>
            <span class="text-[11px] font-bold rounded-full px-2 py-0.5 ${badge.cls}">${badge.text}</span>
        </header>

        <div class="answer-box text-[15px] leading-7 bg-slate-50 border border-slate-200 rounded-xl px-4 py-3">
            ${c.text ? highlightCluster(c) : '<span class="text-slate-400">— ไม่ได้ตอบ —</span>'}
        </div>

        <div class="flex flex-wrap items-center gap-2 mt-3 text-xs">
            <span class="text-slate-400">AI:</span>
            ${ai ? `<span class="font-bold border rounded-full px-2 py-0.5 ${ai.cls}">${ai.text}</span>` : '<span class="text-slate-400">ยังไม่มีผล</span>'}
            ${c.aiReason ? `<span class="text-slate-600">${esc(c.aiReason)}</span>` : ''}
            ${human ? `<span class="ml-auto text-slate-500">กรรมการ: <b class="text-slate-800">${human.text}</b>${c.reviewerEmail ? ` · ${esc(c.reviewerEmail)}` : ''}</span>` : ''}
        </div>

        <div class="flex gap-2 mt-3">${decideBtns(c, false)}</div>
    </article>`;
}

/** แถวตาราง — ข้อมูลและตรรกะชุดเดียวกับการ์ด ต่างแค่ความหนาแน่น */
function rowHtml(c, i) {
    const badge = STATE_BADGE[c.state] || STATE_BADGE.PENDING;
    const ai = JUDGMENT_PILL[c.aiJudgment];
    const focused = i === cursor;

    return `
    <div id="card-${esc(c.clusterId)}" data-index="${i}"
        class="saq-card grid grid-cols-[minmax(140px,auto)_1fr_auto] gap-3 items-center border-b border-slate-100 px-3 py-2 ${focused ? 'bg-sky-50 ring-2 ring-[#1e3a8a]/40' : ''}">
        <div class="min-w-0">
            <div class="flex items-center gap-1">
                <span class="font-mono text-[11px] font-bold text-slate-500 truncate">${esc(c.clusterId)}</span>
                ${syncPill(c.clusterId)}
            </div>
            <div class="flex items-center gap-1 mt-0.5">
                <span class="text-[10px] font-bold rounded-full px-1.5 py-0.5 ${badge.cls}">${badge.text}</span>
                <span class="text-[10px] text-slate-500">${c.teamCount} ทีม</span>
                ${c.isOverlong ? '<span class="text-[10px] text-amber-600" title="ยาวผิดปกติ — สงสัยคัดลอกจาก AI">⚠️</span>' : ''}
            </div>
        </div>
        <div class="answer-box min-w-0 text-[13px] leading-6 line-clamp-2">
            ${c.text ? highlightCluster(c) : '<span class="text-slate-400">— ไม่ได้ตอบ —</span>'}
        </div>
        <div class="flex items-center gap-1 shrink-0">
            ${ai ? `<span class="text-[10px] font-bold border rounded-full px-1.5 py-0.5 mr-1 ${ai.cls}" title="ผล AI">${ai.text}</span>` : ''}
            ${decideBtns(c, true)}
        </div>
    </div>`;
}

/**
 * วาดรายการใหม่ทั้งหมด — เรียกเฉพาะตอน "สมาชิกในรายการเปลี่ยน" เท่านั้น
 * (เปลี่ยนข้อ/ตัวกรอง/มุมมอง หรือมีการ์ดหลุดเข้าออกจากตัวกรอง)
 *
 * ข้อควรระวัง: cardHtml/rowHtml ฝัง data-index ตามลำดับใน visible() ลงใน DOM
 * refreshRow() จึงใช้ได้เฉพาะตอนที่สมาชิกไม่เปลี่ยน ถ้าเรียกตอนสมาชิกเปลี่ยน
 * ดัชนีของการ์ดใบอื่นจะเพี้ยนเงียบ ๆ และ cursor จะชี้ผิดใบ
 */
function renderRows() {
    const list = visible();
    if (cursor >= list.length) cursor = Math.max(0, list.length - 1);

    if (!list.length) {
        $('cardList').innerHTML = `<p class="text-center text-slate-400 text-sm py-10">ไม่มีคลัสเตอร์ในตัวกรองนี้</p>`;
        renderStatusBar();
        return;
    }

    $('cardList').innerHTML = view === 'TABLE'
        ? `<div class="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">${list.map(rowHtml).join('')}</div>`
        : list.map(cardHtml).join('');

    [...$('cardList').querySelectorAll('.saq-card')].forEach(bindRow);
    paintSelection();
    renderStatusBar();
}

const rowEl = (i) => $('cardList').querySelector(`.saq-card[data-index="${i}"]`);

function bindRow(el) {
    if (!el) return;
    [...el.querySelectorAll('.saq-decide')].forEach((b) => {
        b.onclick = (ev) => { ev.stopPropagation(); decide(b.dataset.cluster, b.dataset.decision); };
    });
    el.onclick = () => {
        // การลากเลือกข้อความในกล่องคำตอบจบด้วย mouseup บนการ์ด ถ้าถือว่าเป็นการ
        // คลิกเลือกการ์ดแล้ววาดใหม่ selection ของเบราว์เซอร์จะถูกล้างกลางคัน
        // — คัดลอกคำตอบไปค้นต่อไม่ได้เลย
        if (String(window.getSelection ? window.getSelection() : '')) return;
        setCursor(Number(el.dataset.index) || 0, { scroll: false });
    };
}

/** วาดใหม่เฉพาะแถวเดียว — ใช้ได้เมื่อสมาชิกในรายการไม่เปลี่ยนเท่านั้น */
function refreshRow(clusterId) {
    const list = visible();
    const i = list.findIndex((x) => x.clusterId === clusterId);
    if (i === -1) return false;
    const el = rowEl(i);
    if (!el) return false;
    el.outerHTML = view === 'TABLE' ? rowHtml(list[i], i) : cardHtml(list[i], i);
    bindRow(rowEl(i));
    if (i === cursor) paintSelection();
    return true;
}

// ── โฟกัสและตัวเลือกในการ์ด ─────────────────────────────────────────────────
const FOCUS_CLS = {
    CARD: ['border-[#1e3a8a]', 'ring-2', 'ring-[#1e3a8a]/30'],
    TABLE: ['bg-sky-50', 'ring-2', 'ring-[#1e3a8a]/40'],
};
const SEL_RING = ['ring-4', 'ring-offset-1', 'ring-[#1e3a8a]/60'];

/** ย้ายโฟกัสด้วยการสลับคลาส ไม่วาด #cardList ใหม่ (535 คลัสเตอร์ต่อการกดลูกศรหนึ่งครั้ง) */
function paintFocus(i, on) {
    const el = rowEl(i);
    if (!el) return;
    FOCUS_CLS[view].forEach((cls) => el.classList.toggle(cls, on));
    if (view === 'CARD') el.classList.toggle('border-slate-200', !on);
    if (!on) [...el.querySelectorAll('.saq-decide')].forEach((b) => b.classList.remove(...SEL_RING));
}

/**
 * วงแหวนตัวเลือกที่ ← → ชี้อยู่ — ตั้งใจให้ต่างจากสีปุ่มที่ "ตัดสินไปแล้ว" (cls.on)
 * เพราะสองอย่างนี้คนละความหมาย: อันหนึ่งคือผลที่บันทึกแล้ว อีกอันคือกำลังจะกด
 */
function paintSelection() {
    const el = rowEl(cursor);
    if (!el) return;
    [...el.querySelectorAll('.saq-decide')].forEach((b) => {
        const on = b.dataset.decision === DECISIONS[selection];
        SEL_RING.forEach((cls) => b.classList.toggle(cls, on));
    });
}

/** ตัวเลือกเริ่มต้นของการ์ด — ถ้าตัดสินไว้แล้วให้ชี้ที่ผลเดิม ไม่งั้นเริ่มที่ "ถูก" */
const defaultSelection = (c) => Math.max(0, DECISIONS.indexOf(c?.humanJudgment));

function setCursor(next, opts = {}) {
    const list = visible();
    if (!list.length) { cursor = 0; return; }
    const clamped = Math.min(Math.max(next, 0), list.length - 1);
    if (clamped !== cursor) paintFocus(cursor, false);
    cursor = clamped;
    selection = defaultSelection(list[cursor]);
    paintFocus(cursor, true);
    paintSelection();
    if (opts.scroll !== false) scrollToCursor();
}

function renderStatusBar() {
    const c = counts();
    if (!c) { $('statusBar').innerHTML = ''; return; }

    const ready = c.readyToCommit;
    $('statusBar').innerHTML = `
        <div class="flex flex-wrap items-center gap-3 text-xs">
            <span class="font-bold text-slate-700">ข้อ ${esc(c.itemId)}</span>
            <span class="text-slate-500">คลัสเตอร์ ${c.clusters} · ทีม ${c.teams}</span>
            <span class="text-emerald-700 font-bold">ยืนยันแล้ว ${c.confirmed}</span>
            <span class="text-sky-700 font-bold">กรรมการตัดสินแล้ว ${c.humanReady}</span>
            <span class="text-slate-600">รับผล AI ได้ ${c.aiReady}</span>
            <span class="${c.pending ? 'text-amber-700' : 'text-emerald-700'} font-bold">ต้องตัดสิน ${c.pending}</span>
            <button id="commitBtn" ${ready ? '' : 'disabled'}
                class="ml-auto px-4 py-2 rounded-xl font-extrabold text-sm transition-all ${ready
            ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
            : 'bg-slate-200 text-slate-400 cursor-not-allowed'}">
                ยืนยันผลตรวจทั้งข้อ ${esc(c.itemId)}
            </button>
        </div>`;
    const btn = $('commitBtn');
    if (btn && ready) btn.onclick = commit;
}

/**
 * ภาพรวมความคืบหน้าทั้ง 7 ข้อ — ใช้ payload.progress ที่เซิร์ฟเวอร์ส่งมาอยู่แล้ว
 * (_saqItemProgress() ฝั่ง GAS) ไม่คำนวณซ้ำจาก payload.clusters ซึ่งมีแค่ข้อปัจจุบัน
 */
const SEG = [
    ['confirmed', 'bg-emerald-500', 'ยืนยันแล้ว'],
    ['humanReady', 'bg-sky-500', 'กรรมการตัดสินแล้ว'],
    ['aiReady', 'bg-slate-400', 'รับผล AI ได้'],
    ['pending', 'bg-amber-400', 'ต้องตัดสิน'],
];

function renderProgress() {
    const rows = payload?.progress || [];
    if (!rows.length) { $('progressPanel').innerHTML = ''; return; }

    const agg = rows.reduce((a, p) => {
        SEG.forEach(([k]) => { a[k] += p[k] || 0; });
        a.clusters += p.clusters || 0;
        a.teams += p.teams || 0;
        if (p.readyToCommit) a.ready++;
        return a;
    }, { clusters: 0, teams: 0, ready: 0, confirmed: 0, humanReady: 0, aiReady: 0, pending: 0 });

    const bar = (p) => {
        if (!p.clusters) return '<div class="h-2 rounded-full bg-slate-100"></div>';
        return `<div class="h-2 rounded-full bg-slate-100 overflow-hidden flex">
            ${SEG.map(([k, cls, label]) => (p[k] ? `<span class="${cls}" style="width:${(p[k] / p.clusters) * 100}%" title="${label} ${p[k]}"></span>` : '')).join('')}
        </div>`;
    };

    $('progressPanel').innerHTML = `
    <div class="bg-white border border-slate-200 rounded-2xl shadow-sm p-4">
        <div class="flex flex-wrap items-center gap-x-4 gap-y-1 mb-3">
            <span class="text-sm font-extrabold text-[#0f1f4b]">ความคืบหน้าการตรวจ SAQ</span>
            <span class="text-xs text-slate-500">คลัสเตอร์ ${agg.clusters} · ทีม ${agg.teams}</span>
            <span class="text-xs font-bold ${agg.pending ? 'text-amber-600' : 'text-emerald-600'}">
                เหลือต้องตัดสิน ${agg.pending}
            </span>
            <span class="ml-auto text-xs font-bold ${agg.ready === rows.length ? 'text-emerald-600' : 'text-slate-500'}">
                พร้อมยืนยัน ${agg.ready}/${rows.length} ข้อ
            </span>
        </div>
        <div class="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            ${rows.map((p) => `
            <button data-item="${esc(p.itemId)}" class="saq-prog text-left rounded-xl border px-3 py-2 transition-all ${p.itemId === itemId
        ? 'border-[#1e3a8a] bg-slate-50' : 'border-slate-200 hover:border-[#1e3a8a]'}">
                <div class="flex items-center gap-2 mb-1">
                    <span class="text-xs font-extrabold text-slate-700">ข้อ ${esc(p.itemId)}</span>
                    ${p.readyToCommit
            ? '<span class="text-[10px] font-bold bg-emerald-100 text-emerald-700 border border-emerald-300 rounded-full px-1.5">พร้อมยืนยัน</span>'
            : `<span class="text-[10px] text-amber-600 font-bold">เหลือ ${p.pending}</span>`}
                    <span class="ml-auto text-[10px] text-slate-400">${p.clusters}</span>
                </div>
                ${bar(p)}
            </button>`).join('')}
        </div>
        <div class="flex flex-wrap gap-3 mt-2">
            ${SEG.map(([, cls, label]) => `<span class="flex items-center gap-1 text-[10px] text-slate-500">
                <span class="w-2 h-2 rounded-full ${cls}"></span>${label}</span>`).join('')}
        </div>
    </div>`;

    [...document.querySelectorAll('.saq-prog')].forEach((b) => {
        b.onclick = () => { if (b.dataset.item !== itemId) load(b.dataset.item); };
    });
}

/**
 * แก้ผลคลัสเตอร์ที่ยืนยันแล้ว — ต้องพิมพ์คำว่า UNLOCK เอง ไม่ใช่แค่กด OK
 * (confirm() ปุ่มเดียวคือสิ่งที่คนกดผ่านโดยไม่อ่าน) เหตุผลเดียวกับหน้าตรวจ Essay
 * และไม่ใช้รหัสผ่านฝั่งหน้าเว็บ เพราะไฟล์นี้อยู่ใน repo สาธารณะ — ด่านจริงคือ
 * unlockToken ที่ฝั่ง GAS บังคับ + แถวใน SAQ_Grading_Log ที่บันทึกว่าใครเป็นคนแก้
 */
const UNLOCK_WORD = 'UNLOCK';
function askUnlock(c, decision) {
    const from = JUDGMENT_PILL[c.humanJudgment]?.text || c.humanJudgment || '(ว่าง)';
    const to = JUDGMENT_PILL[decision]?.text || decision;
    const typed = prompt(
        `แก้ผลคลัสเตอร์ที่ยืนยันแล้ว ${c.clusterId}\n\n` +
        `${from} → ${to}\n` +
        `กระทบ ${c.teamCount} ทีม ข้อละ ${payload?.item?.pointsPerItem ?? 12} คะแนน\n` +
        `การแก้จะถูกบันทึกชื่อผู้ทำลงใน SAQ_Grading_Log\n\n` +
        `พิมพ์คำว่า ${UNLOCK_WORD} เพื่อยืนยัน:`, '');
    if (typed === null) return false;
    if (typed.trim().toUpperCase() !== UNLOCK_WORD) {
        toast(`ยกเลิก — ต้องพิมพ์คำว่า ${UNLOCK_WORD} ให้ตรง`, 'red');
        return false;
    }
    return true;
}

let toastTimer = null;
function toast(msg, tone = 'slate') {
    const el = $('toast');
    const bg = { slate: 'bg-slate-900', red: 'bg-rose-600', green: 'bg-emerald-600' }[tone] || 'bg-slate-900';
    el.className = `fixed bottom-6 left-1/2 -translate-x-1/2 z-50 ${bg} text-white text-sm font-bold px-4 py-2 rounded-xl shadow-lg`;
    el.textContent = msg;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.add('hidden'), 2600);
    el.classList.remove('hidden');
}

// ── network ────────────────────────────────────────────────────────────────
async function load(nextItem) {
    itemId = nextItem || itemId;
    $('cardList').innerHTML = `<p class="text-center text-slate-400 text-sm py-10">กำลังโหลด...</p>`;
    try {
        const url = `${API_URL}?action=getSaqClusters&itemId=${encodeURIComponent(itemId)}` +
            `&idToken=${encodeURIComponent(await getIdToken())}`;
        const res = await fetch(url);
        const data = await res.json();
        if (data.status !== 'success') throw new Error(data.message || 'โหลดข้อมูลไม่สำเร็จ');

        payload = data;
        rebuildBaseMatcher();
        items = data.items && data.items.length ? data.items : items;
        cursor = 0;
        selection = 0;
        syncState.clear();
        renderTabs();
        renderProgress();
        renderReference();
        renderFilters();
        renderRows();
        watchLive();
    } catch (err) {
        $('cardList').innerHTML = `<p class="text-center text-rose-600 text-sm py-10">${esc(err.message)}</p>`;
    }
}

// ── ชั้นเรียลไทม์ (RTDB) ────────────────────────────────────────────────────
// เป็นชั้นเสริมล้วน ๆ: ทาสีคำตัดสินให้เห็นทันทีและให้กรรมการหลายคนเห็นของกันและกัน
// แหล่งข้อมูลจริงคือชีตผ่าน GAS เสมอ ถ้ากติกา RTDB ยังไม่เปิดโหนดนี้ให้เขียน
// เราปิดชั้นนี้ทิ้งเงียบ ๆ (liveOn = false) แล้วหน้าเว็บทำงานต่อได้ครบทุกอย่าง

/** RTDB ห้ามมี . # $ [ ] ในชื่อ path — ทั้ง itemId ("4.1") และ clusterId ("4.1-C001") มีจุด */
const escPath = (s) => String(s ?? '').replace(/[.#$[\]]/g, '_');

function watchLive() {
    if (liveOff) { liveOff(); liveOff = null; }
    if (!liveOn) return;
    liveOff = onValue(
        ref(db, `${LIVE_ROOT}/${escPath(itemId)}`),
        (snap) => applyLive(snap.val() || {}),
        () => { liveOn = false; });      // อ่านไม่ได้ = ไม่มีกติกาให้ → เลิกใช้ชั้นนี้
}

function pushLive(c, drop) {
    if (!liveOn) return;
    const node = ref(db, `${LIVE_ROOT}/${escPath(itemId)}/${escPath(c.clusterId)}`);
    const done = drop ? remove(node) : set(node, {
        clusterId: c.clusterId,
        judgment: c.humanJudgment || '',
        humanStatus: c.humanStatus || '',
        graderEmail: me.email,
        graderName: me.name,
        at: Date.now(),
    });
    done.catch(() => { liveOn = false; });
}

/**
 * รับคำตัดสินของกรรมการคนอื่นเข้ามาระหว่างทาง
 *
 * ข้ามรายการที่เราเป็นคนเขียนเอง: ค่าที่เราเขียนแบบมองโลกในแง่ดีจะเด้งกลับมาทาง
 * listener นี้ด้วย ถ้าปล่อยให้เขียนทับ มันจะไปลบ humanStatus/humanScore ตัวจริง
 * ที่ GAS เพิ่งตอบกลับมา (แข่งกันเองจนคะแนนเพี้ยนโดยไม่มีใครเห็น)
 */
function applyLive(map) {
    if (!payload) return;
    const anchor = visible()[cursor]?.clusterId;

    const byId = {};
    Object.keys(map).forEach((k) => {
        const v = map[k];
        if (v && v.clusterId) byId[v.clusterId] = v;
    });

    let changed = 0;
    (payload.clusters || []).forEach((c) => {
        const v = byId[c.clusterId];
        if (!v || v.graderEmail === me.email) return;
        if (c.humanJudgment === (v.judgment || '') && c.humanStatus === (v.humanStatus || '')) return;
        c.humanJudgment = v.judgment || '';
        c.humanStatus = v.humanStatus || '';
        c.reviewerEmail = v.graderEmail || c.reviewerEmail;
        c.state = stateOf(c);
        changed++;
    });
    if (!changed) return;

    renderChrome();
    // ยึดการ์ดเดิมไว้ด้วย clusterId — ถ้าใช้ index เดิม กรรมการจะถูกกระชากไปคนละใบ
    const list = visible();
    const back = list.findIndex((x) => x.clusterId === anchor);
    cursor = back === -1 ? Math.min(cursor, Math.max(0, list.length - 1)) : back;
    selection = defaultSelection(list[cursor]);
    renderRows();
}

/**
 * ส่งคำตัดสินของกรรมการ 1 คลัสเตอร์.
 * CORRECT/INCORRECT = ยืนยันทันที (Human_Status = Confirmed)
 * UNSURE = พักไว้ ไม่ยืนยัน — ยังบล็อกการยืนยันทั้งข้อไว้เหมือนเดิม
 *
 * ทาสีทันทีแล้วค่อยยืนยันกับเซิร์ฟเวอร์ (optimistic) เพื่อให้ไล่ตรวจรัว ๆ ได้ลื่น
 * ถ้า GAS ปฏิเสธ ทั้งหน้าจอและ RTDB จะถูกย้อนกลับเป็นค่าเดิม
 */
async function decide(clusterId, decision) {
    if (inFlight.has(clusterId)) return;
    const c = (payload?.clusters || []).find((x) => x.clusterId === clusterId);
    if (!c) return;

    // คลัสเตอร์ที่ยืนยันแล้วคือของที่ล็อกไว้ — หนึ่งคลัสเตอร์ถือคะแนนของหลายสิบทีม
    // การกดซ้ำโดยไม่ตั้งใจจึงเปลี่ยนคะแนนจริง ต้องพิมพ์คำยืนยันเองก่อน
    // ด่านนี้ต้องอยู่ก่อนการเขียน RTDB เสมอ ไม่งั้นการกดยกเลิกก็ยังไปโผล่จอคนอื่น
    let unlock = false;
    if (c.humanStatus === 'Confirmed') {
        if (c.humanJudgment === decision) {
            toast(`คลัสเตอร์นี้ยืนยันเป็น "${JUDGMENT_PILL[decision]?.text || decision}" อยู่แล้ว`);
            return;
        }
        if (!askUnlock(c, decision)) return;
        unlock = true;
    }

    const prev = {
        humanJudgment: c.humanJudgment, humanStatus: c.humanStatus,
        humanScore: c.humanScore, reviewerEmail: c.reviewerEmail, state: c.state,
    };
    const hadLive = Boolean(prev.humanJudgment || prev.humanStatus);

    inFlight.add(clusterId);
    c.humanJudgment = decision;
    c.humanStatus = decision === 'UNSURE' ? '' : 'Confirmed';
    c.reviewerEmail = me.email || c.reviewerEmail;
    c.state = stateOf(c);
    syncState.set(clusterId, 'pending');
    renderChrome();
    afterDecision(clusterId);
    pushLive(c);

    try {
        const res = await fetch(API_URL, {
            method: 'POST',
            body: JSON.stringify({
                action: 'submitSaqTriage',
                idToken: await getIdToken(),
                itemId,
                clusterId,
                decision,
                // GAS ปฏิเสธการแก้คลัสเตอร์ที่ Confirmed แล้วถ้าไม่มีคำนี้
                ...(unlock ? { unlockToken: UNLOCK_WORD } : {}),
            }),
        });
        const data = await res.json();
        if (data.status !== 'success') throw new Error(data.message || 'บันทึกไม่สำเร็จ');

        // ผลจากเซิร์ฟเวอร์คือของจริง — เขียนทับค่าที่เดาไว้ล่วงหน้า
        c.humanStatus = data.humanStatus || '';
        c.humanScore = data.score === '' ? null : data.score;
        c.state = stateOf(c);
        syncState.set(clusterId, 'synced');
        pushLive(c);
        // เซิร์ฟเวอร์อาจให้สถานะไม่ตรงกับที่เดาไว้ ต้องนับใหม่ ไม่ใช่แค่ทาสีแถวเดียว
        renderChrome();
        refreshRow(clusterId);
    } catch (err) {
        Object.assign(c, prev);
        syncState.set(clusterId, 'error');
        pushLive(c, !hadLive);
        toast(err.message, 'red');
        renderChrome();
        renderRows();
    } finally {
        inFlight.delete(clusterId);
    }
}

/**
 * นับใหม่แล้ววาดทุกส่วนที่โชว์ตัวเลข — แท็บ ภาพรวม ตัวกรอง และแถบล่าง
 *
 * แถบล่างสำคัญเป็นพิเศษ: มันถือปุ่ม "ยืนยันผลตรวจทั้งข้อ" ที่จะกดได้ก็ต่อเมื่อ
 * pending เป็นศูนย์ ถ้าลืมวาดมันตอนตัดสินใบสุดท้าย ปุ่มจะยังเป็นสีเทาทั้งที่
 * ตรวจครบแล้ว (renderRows() วาดให้อยู่แล้ว แต่ทางลัด refreshRow() ไม่ได้วาด)
 */
function renderChrome() {
    recount();
    renderTabs();
    renderProgress();
    renderFilters();
    renderStatusBar();
}

/** นับใหม่ฝั่งหน้าเว็บ ใช้กติกาเดียวกับ _saqItemProgress() ในฝั่ง GAS */
function recount() {
    const c = counts();
    if (!c) return;
    const all = payload.clusters || [];
    c.confirmed = all.filter((x) => x.state === 'CONFIRMED').length;
    c.humanReady = all.filter((x) => x.state === 'HUMAN_READY').length;
    c.aiReady = all.filter((x) => x.state === 'AI_READY').length;
    c.pending = all.filter((x) => x.state === 'PENDING').length;
    c.readyToCommit = c.hasManifest && c.graded >= c.clusters && c.pending === 0;

    const p = (payload.progress || []).find((x) => x.itemId === c.itemId);
    if (p && p !== c) Object.assign(p, c);
}

/**
 * หลังตัดสินสำเร็จ: เลื่อนไป "ใบถัดไปตามลำดับ" เสมอ ไม่กระโดดข้ามไปหาใบที่ยัง
 * ต้องตัดสิน (กรรมการต้องได้ไล่อ่านเรียงใบ ไม่ใช่ถูกพาไปที่ใบ UNSURE ไกล ๆ)
 *
 * ถ้าการ์ดหลุดออกจากตัวกรอง (เช่นกรองอยู่ที่ "ต้องตัดสิน") สมาชิกในรายการเปลี่ยน
 * ต้องวาดใหม่ทั้งหมด และทุกใบหลังจากนั้นเลื่อนขึ้นหนึ่งช่องแล้ว — cursor เดิมจึง
 * ชี้ใบถัดไปอยู่พอดี ห้ามบวกหนึ่งซ้ำ ไม่งั้นจะกลายเป็นตรวจเว้นใบ
 */
function afterDecision(decidedClusterId) {
    const list = visible();
    const at = list.findIndex((x) => x.clusterId === decidedClusterId);
    if (at !== -1) {
        refreshRow(decidedClusterId);
        setCursor(at + 1);
        return;
    }
    cursor = Math.min(cursor, Math.max(0, list.length - 1));
    selection = defaultSelection(list[cursor]);
    renderRows();
    scrollToCursor();
}

/** เลื่อนจอไปที่การ์ดที่โฟกัสอยู่ — ใช้ทั้งตอนกดลูกศรและหลังกดตัดสิน */
function scrollToCursor() {
    const list = visible();
    const c = list[cursor];
    // id ของการ์ดมีจุด (เช่น card-4.1-C001) — getElementById รับได้ตรง ๆ
    if (c) $('card-' + c.clusterId)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
}

async function commit() {
    const c = counts();
    if (!c || !c.readyToCommit) return;

    const ok = confirm(
        `ยืนยันผลตรวจข้อ ${c.itemId}\n\n` +
        `• คลัสเตอร์ทั้งหมด ${c.clusters} (${c.teams} ทีม)\n` +
        `• ยืนยันไว้แล้ว ${c.confirmed}\n` +
        `• กรรมการตัดสินแล้วรอประทับ ${c.humanReady}\n` +
        `• รับผลจาก AI ที่ชัดเจน ${c.aiReady} คลัสเตอร์ (กรรมการไม่ได้แก้)\n\n` +
        `หลังยืนยันแล้วต้องกลับไปสั่งซิงก์คะแนนจากเมนูในชีต และต้องสั่งครั้งเดียวหลังยืนยันครบทั้ง 7 ข้อ`
    );
    if (!ok) return;

    const btn = $('commitBtn');
    if (btn) { btn.disabled = true; btn.textContent = 'กำลังยืนยัน...'; }
    try {
        const res = await fetch(API_URL, {
            method: 'POST',
            body: JSON.stringify({
                action: 'commitSaqHumanDecisions',
                idToken: await getIdToken(),
                itemId: c.itemId,
            }),
        });
        const data = await res.json();
        if (data.status !== 'success') throw new Error(data.message || 'ยืนยันไม่สำเร็จ');
        toast(`ยืนยันข้อ ${data.itemId} แล้ว ${data.stamped} คลัสเตอร์ (กรรมการ ${data.humanTyped} · รับจาก AI ${data.fromAi})`, 'green');
        await load(c.itemId);
    } catch (err) {
        toast(err.message, 'red');
        renderStatusBar();
    }
}

// ── คีย์ลัด ────────────────────────────────────────────────────────────────
/**
 * สองจังหวะ: ↑ ↓ เลือกการ์ด · ← → เลือกตัวเลือกในการ์ดนั้น · Space/Enter ยืนยัน
 * แล้วเลื่อนไปใบถัดไป ส่วน 1/2/3 ยังกดตัดสินได้ทันทีเหมือนเดิม
 *
 * ต้อง preventDefault ทั้ง ↑ ↓ และ Space ไม่งั้นเบราว์เซอร์เลื่อนจอเองซ้อนกับ
 * การเลื่อนของเรา จนหลุดจากการ์ดที่โฟกัสอยู่
 */
function onKey(ev) {
    if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
    const tag = (ev.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || ev.target.isContentEditable) return;

    const list = visible();
    if (!list.length) return;
    const card = list[Math.min(cursor, list.length - 1)];

    const cycle = (d) => {
        selection = (selection + d + DECISIONS.length) % DECISIONS.length;
        paintSelection();
    };

    switch (ev.key) {
        case '1': ev.preventDefault(); decide(card.clusterId, 'CORRECT'); break;
        case '2': ev.preventDefault(); decide(card.clusterId, 'INCORRECT'); break;
        case '3': ev.preventDefault(); decide(card.clusterId, 'UNSURE'); break;
        case 'ArrowDown': case 'j': ev.preventDefault(); setCursor(cursor + 1); break;
        case 'ArrowUp': case 'k': ev.preventDefault(); setCursor(cursor - 1); break;
        case 'ArrowRight': ev.preventDefault(); cycle(1); break;
        case 'ArrowLeft': ev.preventDefault(); cycle(-1); break;
        case ' ': case 'Spacebar': case 'Enter':
            ev.preventDefault();
            decide(card.clusterId, DECISIONS[selection]);
            break;
        default: break;
    }
}

// ── entry ──────────────────────────────────────────────────────────────────
export function initSaqGrading(opts) {
    getIdToken = opts.getIdToken;
    me = opts.me || me;
    itemId = DEFAULT_ITEMS[0];
    renderTabs();
    renderViewSwitch();
    document.addEventListener('keydown', onKey);
    return load(itemId);
}

export const saqReload = () => load(itemId);
