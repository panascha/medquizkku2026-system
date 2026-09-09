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
import { DASHBOARD_API_URL } from './firebase-config.js';

const API_URL = DASHBOARD_API_URL;

// ตรงกับ SAQ_CONFIG.ITEMS ใน 10_SaqGrading.js — ใช้วาดแท็บก่อนโหลดครั้งแรก
// จากนั้นยึดตามรายการที่เซิร์ฟเวอร์ส่งกลับมา
const DEFAULT_ITEMS = ['4.1', '5.1', '6.1', '7.1', '8.1', '9.1', '10.1'];

const FILTERS = {
    ALL: 'ทั้งหมด',
    PENDING: 'ต้องตัดสิน',
    UNSURE: 'AI ไม่แน่ใจ',
    AI_CORRECT: 'AI ว่าถูก',
    AI_INCORRECT: 'AI ว่าผิด',
};

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
let items = DEFAULT_ITEMS.slice();
let itemId = DEFAULT_ITEMS[0];
let payload = null;          // ผลลัพธ์ getSaqClusters ล่าสุด
let filter = 'ALL';
let cursor = 0;              // ตำแหน่งการ์ดที่โฟกัส (index ใน visible())
const inFlight = new Set();  // clusterId ที่กำลังส่งคำตัดสิน — กันกดรัว

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
function visible() {
    const all = payload?.clusters || [];
    switch (filter) {
        case 'PENDING': return all.filter((c) => c.state === 'PENDING');
        case 'UNSURE': return all.filter((c) => c.aiJudgment === 'UNSURE');
        case 'AI_CORRECT': return all.filter((c) => c.aiJudgment === 'CORRECT');
        case 'AI_INCORRECT': return all.filter((c) => c.aiJudgment === 'INCORRECT');
        default: return all;
    }
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
    const n = {
        ALL: payload?.clusters?.length || 0,
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
        b.onclick = () => { filter = b.dataset.filter; cursor = 0; renderFilters(); renderCards(); };
    });
}

function cardHtml(c, i) {
    const badge = STATE_BADGE[c.state] || STATE_BADGE.PENDING;
    const ai = JUDGMENT_PILL[c.aiJudgment];
    const human = JUDGMENT_PILL[c.humanJudgment];
    const focused = i === cursor;

    const btn = (decision, label, hotkey, cls) => {
        const on = c.humanJudgment === decision;
        return `<button data-cluster="${esc(c.clusterId)}" data-decision="${decision}"
            class="saq-decide grow px-4 py-3 rounded-xl border-2 font-extrabold text-sm transition-all ${on ? cls.on : cls.off}">
            <span class="inline-block w-5 h-5 leading-5 rounded bg-black/10 text-[11px] mr-1">${hotkey}</span>${label}
        </button>`;
    };

    return `
    <article id="card-${esc(c.clusterId)}" data-index="${i}"
        class="saq-card bg-white rounded-2xl border ${focused ? 'border-[#1e3a8a] ring-2 ring-[#1e3a8a]/30' : 'border-slate-200'} shadow-sm p-4 mb-3">
        <header class="flex flex-wrap items-center gap-2 mb-3">
            <span class="font-mono text-xs font-bold text-slate-500">${esc(c.clusterId)}</span>
            <span class="text-[11px] font-bold bg-slate-100 text-slate-700 rounded-full px-2 py-0.5">${c.teamCount} ทีม</span>
            <span class="text-[11px] bg-slate-100 text-slate-600 rounded-full px-2 py-0.5">${c.wordCount} คำ</span>
            ${c.isOverlong ? `<span class="text-[11px] font-bold bg-amber-100 text-amber-900 border border-amber-300 rounded-full px-2 py-0.5">⚠️ ยาวผิดปกติ — สงสัยคัดลอกจาก AI</span>` : ''}
            ${c.isEmptyCluster ? `<span class="text-[11px] font-bold bg-slate-200 text-slate-700 rounded-full px-2 py-0.5">ไม่ได้ตอบ — 0 อัตโนมัติ</span>` : ''}
            <span class="ml-auto text-[11px] font-bold rounded-full px-2 py-0.5 ${badge.cls}">${badge.text}</span>
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

        <div class="flex gap-2 mt-3">
            ${btn('CORRECT', 'ถูก', '1', {
        on: 'bg-emerald-600 text-white border-emerald-600',
        off: 'bg-white text-emerald-700 border-emerald-200 hover:border-emerald-500',
    })}
            ${btn('INCORRECT', 'ผิด', '2', {
        on: 'bg-rose-600 text-white border-rose-600',
        off: 'bg-white text-rose-700 border-rose-200 hover:border-rose-500',
    })}
            ${btn('UNSURE', 'ไม่แน่ใจ', '3', {
        on: 'bg-amber-500 text-white border-amber-500',
        off: 'bg-white text-amber-700 border-amber-200 hover:border-amber-500',
    })}
        </div>
    </article>`;
}

function renderCards() {
    const list = visible();
    if (cursor >= list.length) cursor = Math.max(0, list.length - 1);

    $('cardList').innerHTML = list.length
        ? list.map(cardHtml).join('')
        : `<p class="text-center text-slate-400 text-sm py-10">ไม่มีคลัสเตอร์ในตัวกรองนี้</p>`;

    [...document.querySelectorAll('.saq-decide')].forEach((b) => {
        b.onclick = () => decide(b.dataset.cluster, b.dataset.decision);
    });
    [...document.querySelectorAll('.saq-card')].forEach((el) => {
        el.onclick = (ev) => {
            if (ev.target.closest('.saq-decide')) return;
            cursor = Number(el.dataset.index) || 0;
            renderCards();
        };
    });
    renderStatusBar();
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
        renderTabs();
        renderReference();
        renderFilters();
        renderCards();
    } catch (err) {
        $('cardList').innerHTML = `<p class="text-center text-rose-600 text-sm py-10">${esc(err.message)}</p>`;
    }
}

/**
 * ส่งคำตัดสินของกรรมการ 1 คลัสเตอร์.
 * CORRECT/INCORRECT = ยืนยันทันที (Human_Status = Confirmed)
 * UNSURE = พักไว้ ไม่ยืนยัน — ยังบล็อกการยืนยันทั้งข้อไว้เหมือนเดิม
 * ไม่อัปเดตหน้าจอแบบมองโลกในแง่ดี: รอผลจากเซิร์ฟเวอร์แล้วค่อยเขียนสถานะจริง
 */
async function decide(clusterId, decision) {
    if (inFlight.has(clusterId)) return;
    const c = (payload?.clusters || []).find((x) => x.clusterId === clusterId);
    if (!c) return;

    // คลัสเตอร์ที่ยืนยันแล้วคือของที่ล็อกไว้ — หนึ่งคลัสเตอร์ถือคะแนนของหลายสิบทีม
    // การกดซ้ำโดยไม่ตั้งใจจึงเปลี่ยนคะแนนจริง ต้องพิมพ์คำยืนยันเองก่อน
    let unlock = false;
    if (c.humanStatus === 'Confirmed') {
        if (c.humanJudgment === decision) {
            toast(`คลัสเตอร์นี้ยืนยันเป็น "${JUDGMENT_PILL[decision]?.text || decision}" อยู่แล้ว`);
            return;
        }
        if (!askUnlock(c, decision)) return;
        unlock = true;
    }

    inFlight.add(clusterId);
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

        c.humanJudgment = decision;
        c.humanStatus = data.humanStatus || '';
        c.humanScore = data.score === '' ? null : data.score;
        c.state = decision === 'UNSURE' ? 'PENDING'
            : 'CONFIRMED';
        recount();
        advance(clusterId);
        renderTabs();
        renderFilters();
        renderCards();
        scrollToCursor();
    } catch (err) {
        toast(err.message, 'red');
    } finally {
        inFlight.delete(clusterId);
    }
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
 * เลื่อนไปการ์ดถัดไปที่ยังไม่ตัดสิน — ถ้าไม่มีก็เลื่อนไปการ์ดถัดไปเฉย ๆ
 *
 * ต้องรู้ว่าการ์ดที่เพิ่งตัดสิน "ยังอยู่ในตัวกรองหรือไม่": ถ้าตัวกรองเป็น
 * "ต้องตัดสิน" การ์ดนั้นจะหลุดออกจากรายการทันที ทุกใบหลังจากนั้นเลื่อนขึ้นมา
 * หนึ่งช่อง — ถ้ายังข้ามไปเริ่มที่ cursor+1 จะกลายเป็นตรวจเว้นใบ
 */
function advance(decidedClusterId) {
    const list = visible();
    const stillThere = list.findIndex((x) => x.clusterId === decidedClusterId);
    const start = stillThere === -1 ? cursor : stillThere + 1;
    const next = list.findIndex((x, i) => i >= start && x.state === 'PENDING');
    cursor = Math.min(next !== -1 ? next : start, Math.max(0, list.length - 1));
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
function onKey(ev) {
    if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
    const tag = (ev.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || ev.target.isContentEditable) return;

    const list = visible();
    if (!list.length) return;
    const card = list[Math.min(cursor, list.length - 1)];

    const move = (delta) => {
        cursor = Math.min(Math.max(cursor + delta, 0), list.length - 1);
        renderCards();
        scrollToCursor();
    };

    switch (ev.key) {
        case '1': ev.preventDefault(); decide(card.clusterId, 'CORRECT'); break;
        case '2': ev.preventDefault(); decide(card.clusterId, 'INCORRECT'); break;
        case '3': ev.preventDefault(); decide(card.clusterId, 'UNSURE'); break;
        case 'ArrowRight': case 'ArrowDown': case 'j': ev.preventDefault(); move(1); break;
        case 'ArrowLeft': case 'ArrowUp': case 'k': ev.preventDefault(); move(-1); break;
        default: break;
    }
}

// ── entry ──────────────────────────────────────────────────────────────────
export function initSaqGrading(opts) {
    getIdToken = opts.getIdToken;
    itemId = DEFAULT_ITEMS[0];
    renderTabs();
    document.addEventListener('keydown', onKey);
    return load(itemId);
}

export const saqReload = () => load(itemId);
