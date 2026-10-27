// js/spot-dashboard-app.js
// DOM glue for pages/spot-dashboard.html. Pure logic lives in spot-grading-engine.js.
// Live callers must already have passed requireStaff(user). RTDB layout + push: SPOT_GRADING.md.
import {
    QIDS, QID_RE, QUESTION_COUNT, TEAM_COUNT, CUT,
    progress, totals, rankWithCut, laggards, buildPushPayload, fmtClock, recentActivity
} from './spot-grading-engine.js';

const $ = (id) => document.getElementById(id);
const BASE = 'spot_grading_2026';
const ONSITE_API = 'https://script.google.com/macros/s/AKfycbxqyrFCMHgwna03zGskM2d7xrk9kNQu8L71VU4gbAfBfwr7aJy0uLF2JIQ3lq4TXNZIGw/exec';
const REASON = {
    BAD_SCORE: 'คะแนนไม่ถูกต้อง',
    TOO_FEW_TEAMS: 'จำนวนทีมไม่พอ',
    TIE_UNRESOLVED: 'ยังไม่ได้เลือกทีมที่ผ่านในกลุ่มคะแนนเท่ากัน',
    TIE_INVALID: 'ผลเลือกทีมที่ผ่านใช้ไม่ได้กับคะแนนปัจจุบัน — เลือกใหม่'
};

let backend = null;
let me = null;             // { email, name }
let isAdmin = false;
let config = {};
let teams = {};            // MQxxx -> { name }
let teamIds = [];
let scores = {};           // qNN -> MQxxx -> 0|1
let scoreMeta = {};        // qNN -> MQxxx -> { by, at }
const ACTIVITY_LIMIT = 50;
let tieDecision = null;
let admins = {};
let picks = new Set();     // chair's unsaved tie ticks
let pushing = false;

function toast(msg, bad) {
    const t = $('toast');
    t.textContent = msg;
    t.className = 'fixed bottom-4 left-1/2 -translate-x-1/2 px-4 py-2 rounded-lg text-white text-sm shadow-lg ' + (bad ? 'bg-red-600' : 'bg-slate-800');
    t.hidden = false;
    clearTimeout(toast.t);
    toast.t = setTimeout(() => { t.hidden = true; }, 5000);
}

const tName = (t) => (teams[t] && teams[t].name) || '';

// ── derived state ──
function derive() {
    const prog = progress(scores, teamIds);
    const tot = totals(scores, teamIds);
    const rk = rankWithCut(tot, CUT);
    const tieScore = rk.cutTies.length ? rk.ranked[CUT - 1].score : null;
    const sure = tieScore === null ? [] : rk.ranked.filter((r) => r.score > tieScore).map((r) => r.team);
    const need = tieScore === null ? 0 : CUT - sure.length;
    const full = prog.done === prog.total && teamIds.length === TEAM_COUNT;
    const push = buildPushPayload(tot, tieDecision, CUT);
    return { prog, tot, rk, tieScore, sure, need, full, push };
}

function pushBlocker(d) {
    if (config.pushedAt) return 'ส่งผลเข้าชีตแล้ว';
    if (!isAdmin) return 'เฉพาะผู้ดูแล (admins) เท่านั้น';
    if (teamIds.length !== TEAM_COUNT) return `ต้องมี ${TEAM_COUNT} ทีม (ตอนนี้ ${teamIds.length})`;
    if (!d.full) return `ยังตรวจไม่ครบ ${d.prog.done}/${d.prog.total}`;
    if (!d.push.ok) return REASON[d.push.reason] || d.push.reason;
    return '';
}

// ── render ──
function renderSetup() {
    const open = config.isGradingOpen === true;
    $('gradingState').textContent = open ? 'เปิดรับการตรวจ' : 'ปิดอยู่';
    $('gradingState').className = 'font-bold ' + (open ? 'text-emerald-700' : 'text-red-700');
    $('btnToggle').textContent = open ? 'ปิดการตรวจ' : 'เปิดการตรวจ';
    $('teamsInfo').textContent = `ทีมในระบบ ${teamIds.length}/${TEAM_COUNT}`;
    ['btnToggle', 'btnLoadTeams', 'fileQ'].forEach((id) => { $(id).disabled = !isAdmin; });
    $('adminNote').hidden = isAdmin;
}

function renderHeatmap() {
    const box = $('heat');
    box.textContent = '';
    const frag = document.createDocumentFragment();
    box.style.gridTemplateColumns = `2.5rem repeat(${Math.max(teamIds.length, 1)}, minmax(0, 1fr))`;
    const corner = document.createElement('div');
    frag.appendChild(corner);
    teamIds.forEach((t) => {
        const h = document.createElement('div');
        h.className = 'text-[9px] text-center text-slate-500 truncate';
        h.title = t + ' ' + tName(t);
        h.textContent = t.slice(2);
        frag.appendChild(h);
    });
    QIDS.forEach((q, qi) => {
        const l = document.createElement('div');
        l.className = 'text-[10px] text-right pr-1 text-slate-500';
        l.textContent = 'ข้อ ' + (qi + 1);
        frag.appendChild(l);
        const row = scores[q] || {};
        teamIds.forEach((t) => {
            const c = document.createElement('div');
            const v = row[t];
            c.className = 'h-3 rounded-sm ' + (v === 1 ? 'bg-emerald-500' : v === 0 ? 'bg-red-500' : 'bg-slate-200');
            const m = (scoreMeta[q] || {})[t];
            c.title = (v === 0 || v === 1)
                ? `ข้อ ${qi + 1} · ${t} = ${v} | ตรวจโดย: ${(m && m.by) || '-'} (${fmtClock(m && m.at)})`
                : `${q} · ${t} = -`;
            frag.appendChild(c);
        });
    });
    box.appendChild(frag);
}

function renderActivity() {
    const body = $('activity');
    body.textContent = '';
    const rows = recentActivity(scoreMeta, scores, ACTIVITY_LIMIT);
    if (!rows.length) {
        const tr = document.createElement('tr');
        const td = document.createElement('td');
        td.colSpan = 5;
        td.className = 'px-2 py-1 text-slate-500';
        td.textContent = 'ยังไม่มีการตรวจ';
        tr.appendChild(td);
        body.appendChild(tr);
        return;
    }
    rows.forEach((r) => {
        const tr = document.createElement('tr');
        [fmtClock(r.at), r.q, r.team, String(r.v), r.by].forEach((v, i) => {
            const td = document.createElement('td');
            td.className = 'px-2 py-1 ' + (i === 3 ? 'font-bold ' + (r.v === 1 ? 'text-emerald-600' : 'text-red-600') : '');
            td.textContent = v;
            tr.appendChild(td);
        });
        body.appendChild(tr);
    });
}

function renderProgress(d) {
    const pct = d.prog.total ? Math.round((d.prog.done / d.prog.total) * 100) : 0;
    $('progText').textContent = `${d.prog.done} / ${d.prog.total || QUESTION_COUNT * TEAM_COUNT}`;
    $('progBar').style.width = pct + '%';
    const lag = laggards(d.prog);
    const box = $('lag');
    box.textContent = '';
    if (!lag.length) { box.textContent = 'ไม่มีข้อที่ตรวจช้ากว่าค่ากลาง'; return; }
    lag.forEach((r) => {
        const s = document.createElement('span');
        s.className = 'inline-block bg-amber-100 text-amber-900 rounded px-2 py-1 text-xs font-bold mr-1 mb-1';
        s.textContent = `q${Number(r.qid.slice(1))}: ${r.done}/${r.total} (ค่ากลาง ${r.median})`;
        box.appendChild(s);
    });
}

function renderBoard(d) {
    const body = $('board');
    body.textContent = '';
    const tied = new Set(d.rk.cutTies);
    d.rk.ranked.forEach((r) => {
        const tr = document.createElement('tr');
        const inTop = tieDecision && Array.isArray(tieDecision.passed) && tieDecision.passed.includes(r.team);
        tr.className = tied.has(r.team) ? 'bg-amber-50' : (r.rank <= CUT && !tied.size ? 'bg-emerald-50' : '');
        const cells = [r.rank, r.team, tName(r.team), r.score + ' / ' + QUESTION_COUNT];
        cells.forEach((v, i) => {
            const td = document.createElement('td');
            td.className = 'px-2 py-1 ' + (i === 3 ? 'text-right font-bold' : '');
            td.textContent = v;
            tr.appendChild(td);
        });
        const flag = document.createElement('td');
        flag.className = 'px-2 py-1 text-xs';
        if (tied.has(r.team)) {
            const cb = document.createElement('input');
            cb.type = 'checkbox';
            cb.checked = picks.has(r.team);
            cb.disabled = !isAdmin;
            cb.onchange = () => { if (cb.checked) picks.add(r.team); else picks.delete(r.team); renderTie(derive()); };
            const lab = document.createElement('label');
            lab.className = 'font-bold text-amber-800';
            lab.append(cb, ' เสมอที่ 8/9 — ผ่าน');
            flag.appendChild(lab);
        } else if (d.tieScore !== null && r.score > d.tieScore) {
            flag.textContent = 'ผ่านแน่นอน';
        }
        if (inTop) flag.append(' ✓');
        tr.appendChild(flag);
        body.appendChild(tr);
    });
}

function renderTie(d) {
    const box = $('tieBox');
    box.hidden = !d.rk.cutTies.length;
    if (!d.rk.cutTies.length) return;
    $('tieInfo').textContent = `${d.rk.cutTies.length} ทีมคะแนนเท่ากัน (${d.tieScore}) คร่อมอันดับ 8/9 — ผ่านแน่นอน ${d.sure.length} ทีม ต้องเลือกอีก ${d.need} ทีม (เลือกแล้ว ${picks.size})`;
    const ok = isAdmin && picks.size === d.need && [...picks].every((t) => d.rk.cutTies.includes(t));
    $('btnTie').disabled = !ok;
    const td = tieDecision;
    $('tieSaved').textContent = td && td.passed
        ? `บันทึกแล้วโดย ${td.by} (${new Date(td.at).toLocaleTimeString('th-TH')})`
        : 'ยังไม่ได้บันทึกผลตัดสิน';
}

function renderPush(d) {
    const why = pushBlocker(d);
    $('btnPush').disabled = !!why || pushing;
    $('pushWhy').textContent = config.pushedAt
        ? `ส่งแล้วโดย ${config.pushedBy || '-'} (${new Date(config.pushedAt).toLocaleTimeString('th-TH')})`
        : (why || 'พร้อมส่ง — กดเพื่อเขียนผลลงชีต OnSite');
}

function renderAll() {
    const d = derive();
    renderSetup();
    renderHeatmap();
    renderActivity();
    renderProgress(d);
    renderBoard(d);
    renderTie(d);
    renderPush(d);
}

// ── actions ──
async function toggleGrading() {
    const next = config.isGradingOpen !== true;
    if (!next && !confirm('ปิดการตรวจ? ผู้ตรวจจะเขียนคะแนนไม่ได้จนกว่าจะเปิดใหม่')) return;
    try { await backend.setPath('config/isGradingOpen', next); } catch (e) { toast('บันทึกไม่สำเร็จ: ' + (e && e.message), true); }
}

async function loadTeams() {
    if (teamIds.length && !confirm('มีรายชื่อทีมอยู่แล้ว — โหลดใหม่และเขียนทับ?')) return;
    $('btnLoadTeams').disabled = true;
    try {
        const rows = await backend.fetchOnSiteTeams();
        const passed = rows.filter((r) => r && r.r1Passed === true);
        if (passed.length !== TEAM_COUNT) {
            toast(`ได้ ${passed.length} ทีมที่ผ่านรอบ 1 (ต้องเป็น ${TEAM_COUNT}) — ไม่เขียน`, true);
            return;
        }
        const out = {};
        passed.forEach((r) => { out[r.teamId] = { name: r.teamName || '' }; });
        await backend.setPath('teams', out);
        toast(`โหลด ${TEAM_COUNT} ทีมแล้ว`);
    } catch (e) {
        toast('โหลดทีมไม่สำเร็จ: ' + (e && e.message), true);
    } finally {
        $('btnLoadTeams').disabled = !isAdmin;
    }
}

function validateQuestions(obj) {
    const q = obj && obj.questions;
    if (!q || typeof q !== 'object') return 'ไม่มี questions';
    const keys = Object.keys(q);
    if (keys.length !== QUESTION_COUNT) return `ต้องมี ${QUESTION_COUNT} ข้อ (พบ ${keys.length})`;
    if (!keys.every((k) => QID_RE.test(k))) return 'รหัสข้อต้องเป็น q01..q35';
    if (!QIDS.every((k) => q[k] && typeof q[k].key === 'string' && q[k].key)) return 'ทุกข้อต้องมี key';
    return '';
}

async function uploadQuestions(file) {
    if (!file) return;
    try {
        const obj = JSON.parse(await file.text());
        const bad = validateQuestions(obj);
        if (bad) { toast('ไฟล์ข้อสอบไม่ถูกต้อง: ' + bad, true); return; }
        await backend.setPath('questions', obj.questions);
        toast(`อัปโหลด ${QUESTION_COUNT} ข้อแล้ว`);
    } catch (e) {
        toast('อัปโหลดไม่สำเร็จ: ' + (e && e.message), true);
    } finally {
        $('fileQ').value = '';
    }
}

async function saveTie() {
    const d = derive();
    const passed = [...d.sure, ...picks].sort();
    try {
        await backend.setPath('tieDecision', { passed, by: me.email, at: backend.now() });
        toast('บันทึกผลตัดสินแล้ว');
    } catch (e) { toast('บันทึกไม่สำเร็จ: ' + (e && e.message), true); }
}

async function doPush() {
    const d = derive();
    const why = pushBlocker(d);
    if (why) { toast(why, true); return; }
    if (!confirm(`ส่งผลเข้าชีต OnSite: ผ่าน 8 ทีม — ${d.push.payload.passed.join(', ')}\nยืนยัน?`)) return;
    pushing = true;
    renderPush(d);
    try {
        const res = await backend.pushResults(d.push.payload);
        if (res.status !== 'success') throw new Error(res.message || 'ส่งไม่สำเร็จ');
        await backend.setPath('config/pushedAt', backend.now());
        await backend.setPath('config/pushedBy', me.email);
        toast('ส่งผลเข้าชีตสำเร็จ');
    } catch (e) {
        toast('ส่งไม่สำเร็จ: ' + (e && e.message), true);
    } finally {
        pushing = false;
        renderAll();
    }
}

function bind() {
    $('btnToggle').onclick = toggleGrading;
    $('btnLoadTeams').onclick = loadTeams;
    $('fileQ').onchange = (e) => uploadQuestions(e.target.files[0]);
    $('btnTie').onclick = saveTie;
    $('btnPush').onclick = doPush;
}

// ── backends ──
function fixtureBackend(fx, complete) {
    const tree = fx.buildDashboardFixtureDb(Date.now(), { complete });
    const subs = [];
    const clone = (v) => (v === undefined ? null : JSON.parse(JSON.stringify(v)));
    const getPath = (p) => p.split('/').reduce((o, k) => (o == null ? undefined : o[k]), tree);
    const emit = () => subs.forEach((s) => s.cb(clone(getPath(s.path))));
    return {
        now: () => Date.now(),
        watch(path, cb) {
            const s = { path, cb };
            subs.push(s);
            cb(clone(getPath(path)));
        },
        async setPath(path, value) {
            const ks = path.split('/');
            const last = ks.pop();
            let o = tree;
            ks.forEach((k) => { o = o[k] = o[k] || {}; });
            o[last] = clone(value);
            emit();
        },
        fetchOnSiteTeams: async () => fx.fixtureOnSiteTeams(),
        pushResults: async () => ({ status: 'success', fixture: true })
    };
}

async function liveBackend() {
    const { db, ref, onValue, set, auth } = await import('./firebase-config.js');
    let offset = 0;
    onValue(ref(db, '.info/serverTimeOffset'), (s) => { offset = s.val() || 0; });
    const r = (p) => ref(db, BASE + '/' + p);
    return {
        now: () => Date.now() + offset,
        watch(path, cb) {
            onValue(r(path), (s) => cb(s.val()), (e) => toast(`อ่าน ${path} ไม่ได้: ${e && e.message}`, true));
        },
        setPath: (path, value) => set(r(path), value),
        async fetchOnSiteTeams() {
            const idToken = await auth.currentUser.getIdToken();
            const res = await fetch(`${ONSITE_API}?action=getAllOnSiteTeams&idToken=${encodeURIComponent(idToken)}`);
            const json = await res.json();
            if (json.status !== 'success') throw new Error(json.message || 'getAllOnSiteTeams failed');
            return json.teams || [];
        },
        async pushResults(payload) {
            const idToken = await auth.currentUser.getIdToken();
            // text/plain keeps this a simple CORS request (GAS web apps do not answer preflight)
            const res = await fetch(ONSITE_API, {
                method: 'POST',
                headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                body: JSON.stringify({ action: 'setSpotResults', idToken, scores: payload.scores, passed: payload.passed })
            });
            return res.json();
        }
    };
}

/** fixture: bool, complete: fixture only (all 1400 cells). Live: pass user (already through requireStaff). */
export async function initDashboardPage({ fixture, complete, user }) {
    if (fixture) {
        const fx = await import('./spot-dashboard-fixture.js');
        backend = fixtureBackend(fx, !!complete);
        me = fx.FIXTURE_ME;
        isAdmin = true;
        $('fixtureBanner').hidden = false;
    } else {
        const { escapeEmail } = await import('./firebase-config.js');
        backend = await liveBackend();
        me = { email: String(user.email).toLowerCase(), name: user.displayName || user.email };
        const key = escapeEmail(me.email);
        backend.watch('admins', (v) => { admins = v || {}; isAdmin = admins[key] === true; renderAll(); });
    }
    bind();
    backend.watch('config', (v) => { config = v || {}; renderAll(); });
    backend.watch('teams', (v) => { teams = v || {}; teamIds = Object.keys(teams).sort(); renderAll(); });
    backend.watch('scores', (v) => { scores = v || {}; renderAll(); });
    backend.watch('scoreMeta', (v) => { scoreMeta = v || {}; renderAll(); });
    backend.watch('tieDecision', (v) => { tieDecision = v; picks = new Set((v && v.passed) || []); picks.forEach((t) => { if (!derive().rk.cutTies.includes(t)) picks.delete(t); }); renderAll(); });
    renderAll();
}
