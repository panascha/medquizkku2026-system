// js/spot-grading-app.js
// DOM glue for pages/spot-grading.html. Pure logic lives in spot-grading-engine.js.
// Live callers must already have passed requireStaff(user). RTDB layout: SPOT_GRADING.md.
import { QIDS, HEARTBEAT_MS, TEAM_COUNT, normalizeTeamId, autoArmId, lockState, fmtClock } from './spot-grading-engine.js';

const $ = (id) => document.getElementById(id);
const BASE = 'spot_grading_2026';
const FLUSH_MS = 5000;

let backend = null;
let me = null;          // { email, name }
let outboxKey = 'spot:v1:outbox';
let teams = {};         // MQxxx -> { name, r1Rank }
let teamIds = [];
let config = {};
let graders = {};
let curQ = null;
let curQuestion = null; // loaded question (key/rubric), memory only
let serverScores = {};  // MQxxx -> 0|1 for curQ
let serverMeta = {};    // MQxxx -> { by, at } for curQ
let unsubScores = null;
let unsubMeta = null;
let unlocked = false;   // overwrite confirmed for the armed (already graded) team
let armed = null;      // committed team id, ready for 1/0
let last = null;        // { q, team, prev, next }
let outbox = {};        // `${q}/${team}` -> { q, team, v, by, at }
const inflight = new Set();

const store = {
    load() { try { return JSON.parse(localStorage.getItem(outboxKey)) || {}; } catch (e) { return {}; } },
    save() { try { localStorage.setItem(outboxKey, JSON.stringify(outbox)); } catch (e) { /* storage blocked: keep in memory */ } }
};

function toast(msg, bad) {
    const t = $('toast');
    t.textContent = msg;
    t.className = 'fixed bottom-4 left-1/2 -translate-x-1/2 px-4 py-2 rounded-lg text-white text-sm shadow-lg ' + (bad ? 'bg-red-600' : 'bg-slate-800');
    t.hidden = false;
    clearTimeout(toast.t);
    toast.t = setTimeout(() => { t.hidden = true; }, 4000);
}

const lc = (s) => String(s || '').toLowerCase();
const mine = (g) => !!g && lc(g.email) === lc(me.email);
const canScore = () => !!curQ && config.isGradingOpen === true && mine(graders[curQ]);

// ── scores (outbox overlay on server value) ──
function scoreOf(team) {
    const k = curQ + '/' + team;
    if (outbox[k]) return outbox[k].v;
    return serverScores[team] === 0 || serverScores[team] === 1 ? serverScores[team] : null;
}

// who/when graded a team: pending outbox entry is ours, else the server audit row
function metaOf(team) {
    const o = outbox[curQ + '/' + team];
    if (o) return { by: o.by, at: o.at };
    return serverMeta[team] || null;
}

function metaText(team) {
    const m = metaOf(team);
    return m ? `${m.by || '-'} (${fmtClock(m.at)})` : '';
}

function enqueue(q, team, v) {
    outbox[q + '/' + team] = { q, team, v, by: me.email, at: backend.now() };
    store.save();
    flush();
}

function flush() {
    Object.keys(outbox).forEach((k) => {
        if (inflight.has(k)) return;
        const entry = outbox[k];
        inflight.add(k);
        backend.writeScore(entry).then(() => {
            if (outbox[k] === entry) { delete outbox[k]; store.save(); }
        }).catch(() => { /* stays queued, retried */ }).finally(() => { inflight.delete(k); renderPending(); renderStrip(); });
    });
    renderPending();
}

function renderPending() {
    const n = Object.keys(outbox).length;
    const el = $('pending');
    el.textContent = n ? `รอส่ง ${n}` : 'ส่งครบแล้ว';
    el.className = 'text-xs px-2 py-1 rounded-full ' + (n ? 'bg-amber-100 text-amber-900' : 'bg-emerald-100 text-emerald-800');
}

// ── render ──
function renderPicker() {
    const box = $('picker');
    box.textContent = '';
    const now = backend.now();
    QIDS.forEach((q, i) => {
        const g = graders[q];
        const st = lockState(g, now);
        const other = st === 'held' && !mine(g);
        const b = document.createElement('button');
        b.className = 'rounded-lg border px-1 py-1 text-xs leading-tight ' +
            (q === curQ ? 'border-blue-600 bg-blue-50 ' : 'border-slate-200 bg-white ') +
            (other ? 'text-amber-800' : '');
        const n = document.createElement('div');
        n.className = 'font-bold text-sm';
        n.textContent = String(i + 1);
        const tag = document.createElement('div');
        tag.className = 'truncate';
        tag.textContent = other ? g.name : (st === 'held' ? 'คุณ' : 'ว่าง');
        b.append(n, tag);
        b.onclick = () => pick(q);
        box.appendChild(b);
    });
}

function renderLock() {
    const bar = $('lockBar');
    const take = $('takeover');
    take.hidden = true;
    if (!curQ) { bar.textContent = 'เลือกข้อที่จะตรวจ'; bar.className = 'text-sm text-slate-500'; return; }
    const g = graders[curQ];
    const st = lockState(g, backend.now());
    if (st === 'held' && !mine(g)) {
        bar.textContent = `${g.name || g.email} กำลังตรวจข้อนี้`;
        bar.className = 'text-sm font-bold text-amber-800';
        take.hidden = false;
    } else if (config.isGradingOpen !== true) {
        bar.textContent = 'ยังไม่เปิดรับการตรวจ (isGradingOpen = false)';
        bar.className = 'text-sm font-bold text-red-700';
    } else if (mine(g)) {
        bar.textContent = 'คุณกำลังตรวจข้อนี้';
        bar.className = 'text-sm font-bold text-emerald-700';
    } else {
        bar.textContent = 'กำลังจองข้อนี้...';
        bar.className = 'text-sm text-slate-500';
    }
}

function renderKey() {
    $('qNo').textContent = curQ ? 'ข้อ ' + (curQuestion ? curQuestion.no : Number(curQ.slice(1))) : '-';
    $('qSubject').textContent = curQuestion ? `${curQuestion.subject} · ${curQuestion.type}` : '';
    $('qKey').textContent = curQuestion ? curQuestion.key : '-';
    $('qRubric').textContent = curQuestion ? (curQuestion.rubric || '') : '';
}

function renderStrip() {
    const strip = $('strip');
    strip.textContent = '';
    teamIds.forEach((t) => {
        const v = curQ ? scoreOf(t) : null;
        const b = document.createElement('button');
        b.title = t + (teams[t] && teams[t].name ? ' · ' + teams[t].name : '') + (v !== null ? ` | ตรวจโดย: ${metaText(t) || '-'}` : '');
        b.className = 'rounded-md text-xs font-bold py-2 text-white ' +
            (v === 1 ? 'bg-emerald-600' : v === 0 ? 'bg-red-600' : 'bg-slate-300 text-slate-700') +
            (t === armed ? ' ring-4 ring-blue-500' : '');
        b.textContent = t.slice(2);
        b.onclick = () => arm(t);
        strip.appendChild(b);
    });
    let g = 0, r = 0;
    teamIds.forEach((t) => { const v = curQ ? scoreOf(t) : null; if (v === 1) g++; else if (v === 0) r++; });
    $('stripSum').textContent = curQ ? `ตรวจแล้ว ${g + r}/${teamIds.length} (ถูก ${g} · ผิด ${r})` : '';
}

function renderLast() {
    const el = $('last');
    if (!last) { el.hidden = true; return; }
    el.hidden = false;
    $('lastText').textContent = `ข้อ ${Number(last.q.slice(1))} · ${last.team} = ${last.next === null ? 'ลบ' : last.next}`;
}

const needsUnlock = () => !!armed && !unlocked && scoreOf(armed) !== null;

function renderInputState() {
    const ok = canScore();
    const locked = needsUnlock();
    $('team').disabled = !ok;
    $('btn1').disabled = !ok || !armed || locked;
    $('btn0').disabled = !ok || !armed || locked;
    const prev = armed ? scoreOf(armed) : null;
    $('graded').hidden = !armed || prev === null;
    if (armed && prev !== null) {
        $('gradedText').textContent = `⚠️ ข้อนี้ตรวจแล้ว! คะแนนเดิม: ${prev} โดย ${(metaOf(armed) || {}).by || '-'} (${fmtClock((metaOf(armed) || {}).at)})`;
    }
    $('unlock').hidden = !locked;
    $('armed').textContent = armed ? `${armed} พร้อมให้คะแนน (กด 1 = ถูก, 0 = ผิด, Esc = ยกเลิก)` : '';
    renderPreview();
}

// armed team, else whatever the typed text resolves to — checked against the paper before 1/0
function renderPreview() {
    const id = armed || normalizeTeamId($('team').value, teams);
    $('teamPreview').textContent = id ? id + (teams[id] && teams[id].name ? ' · ' + teams[id].name : '') : '';
}

function renderTeamList() {
    const list = $('teamList');
    list.textContent = '';
    teamIds.forEach((t) => {
        const o = document.createElement('option');
        o.value = t + (teams[t] && teams[t].name ? ' - ' + teams[t].name : '');
        list.appendChild(o);
    });
}

function renderAll() { renderPicker(); renderLock(); renderKey(); renderStrip(); renderInputState(); renderPending(); }

// ── actions ──
function setError(msg) { $('teamErr').textContent = msg || ''; }

function disarm(focus) {
    armed = null;
    unlocked = false;
    $('team').value = '';
    setError('');
    renderStrip();
    renderInputState();
    if (focus) $('team').focus();
}

function arm(team) {
    if (!canScore()) { toast('ยังไม่ได้จองข้อนี้ หรือยังไม่เปิดตรวจ', true); return; }
    if (armed !== team) unlocked = false;
    armed = team;
    $('team').value = team;
    setError('');
    $('team').blur();
    renderStrip();
    renderInputState();
}

function commitTypedTeam() {
    const id = normalizeTeamId($('team').value, teams);
    if (!id) { setError(`ไม่พบทีม "${$('team').value.trim()}" ใน ${TEAM_COUNT} ทีมที่ผ่าน`); return; }
    arm(id);
}

function score(v) {
    if (!armed || !canScore() || needsUnlock()) return;
    const team = armed;
    last = { q: curQ, team, prev: scoreOf(team), next: v };
    enqueue(curQ, team, v);
    disarm(true);
    renderLast();
}

function undo() {
    if (!last || !canScore() || last.q !== curQ) { if (last && last.q !== curQ) toast('ย้อนกลับได้เฉพาะข้อเดียวกัน', true); return; }
    enqueue(last.q, last.team, last.prev);
    last = null;
    renderLast();
    renderStrip();
}

async function claim(q) {
    try { await backend.claim(q, me); } catch (e) { toast('จองข้อไม่สำเร็จ: ' + (e && e.message), true); }
}

async function pick(q) {
    if (q === curQ) return;
    const prevQ = curQ;
    if (prevQ && mine(graders[prevQ])) backend.release(prevQ).catch(() => {});
    curQ = q;
    curQuestion = null;
    serverScores = {};
    serverMeta = {};
    last = null;
    renderLast();
    disarm(false);
    if (unsubScores) unsubScores();
    if (unsubMeta) unsubMeta();
    unsubScores = backend.watch('scores/' + q, (v) => { serverScores = v || {}; renderStrip(); renderInputState(); });
    unsubMeta = backend.watch('scoreMeta/' + q, (v) => { serverMeta = v || {}; renderStrip(); renderInputState(); });
    renderAll();
    backend.get('questions/' + q).then((v) => { if (curQ === q) { curQuestion = v; renderKey(); } })
        .catch(() => { if (curQ === q) toast('อ่านเฉลยไม่ได้ (ยังไม่เปิดตรวจ?)', true); });
    const g = graders[q];
    if (!(lockState(g, backend.now()) === 'held' && !mine(g))) await claim(q);
    if (curQ === q) $('team').focus();
}

async function takeover() {
    const g = graders[curQ];
    if (!g || !confirm(`${g.name || g.email} กำลังตรวจข้อนี้อยู่ — ตรวจแทนหรือไม่?`)) return;
    await claim(curQ);
    $('team').focus();
}

function bind() {
    $('team').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); commitTypedTeam(); }
    });
    $('team').addEventListener('input', () => {
        setError('');
        const id = autoArmId($('team').value, teams);
        if (id) arm(id); else renderPreview();
    });
    document.addEventListener('keydown', (e) => {
        if (e.target === $('team') || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
        if (e.key === '1' || e.key === '0') { if (armed) { e.preventDefault(); score(Number(e.key)); } }
        else if (e.key === 'Escape' && armed) disarm(true);
    });
    $('btn1').onclick = () => score(1);
    $('btn0').onclick = () => score(0);
    $('unlock').onclick = () => { unlocked = true; renderInputState(); };
    $('undo').onclick = undo;
    $('takeover').onclick = takeover;
    setInterval(() => {
        if (curQ && mine(graders[curQ])) backend.touch(curQ).catch(() => {});
        renderPicker();
        renderLock();
        renderInputState();
    }, HEARTBEAT_MS);
    setInterval(flush, FLUSH_MS);
}

// ── backends ──
function fixtureBackend(fx) {
    const tree = fx.buildFixtureDb(Date.now());
    const subs = [];
    const getPath = (p) => p.split('/').reduce((o, k) => (o == null ? undefined : o[k]), tree);
    const emit = () => subs.forEach((s) => s.cb(clone(getPath(s.path))));
    const clone = (v) => (v === undefined ? null : JSON.parse(JSON.stringify(v)));
    return {
        now: () => Date.now(),
        watch(path, cb) {
            const s = { path, cb };
            subs.push(s);
            cb(clone(getPath(path)));
            return () => { subs.splice(subs.indexOf(s), 1); };
        },
        get: async (path) => clone(getPath(path)),
        claim: async (q, who) => { tree.graders[q] = { email: who.email, name: who.name, lastActive: Date.now() }; emit(); },
        release: async (q) => { delete tree.graders[q]; emit(); },
        touch: async (q) => { if (tree.graders[q]) tree.graders[q].lastActive = Date.now(); emit(); },
        writeScore: async (e) => {
            tree.scores[e.q] = tree.scores[e.q] || {};
            tree.scoreMeta[e.q] = tree.scoreMeta[e.q] || {};
            if (e.v === null) { delete tree.scores[e.q][e.team]; delete tree.scoreMeta[e.q][e.team]; }
            else { tree.scores[e.q][e.team] = e.v; tree.scoreMeta[e.q][e.team] = { by: e.by.toLowerCase(), at: e.at }; }
            emit();
        }
    };
}

async function liveBackend() {
    const { db, ref, get, onValue, update, remove } = await import('./firebase-config.js');
    let offset = 0;
    onValue(ref(db, '.info/serverTimeOffset'), (s) => { offset = s.val() || 0; });
    const r = (p) => ref(db, BASE + '/' + p);
    const api = {
        now: () => Date.now() + offset,
        watch(path, cb) {
            return onValue(r(path), (s) => cb(s.val()), (e) => toast(`อ่าน ${path} ไม่ได้: ${e && e.message}`, true));
        },
        get: async (path) => (await get(r(path))).val(),
        claim: (q, who) => update(r('graders/' + q), { email: lc(who.email), name: who.name, lastActive: api.now() }),
        release: (q) => remove(r('graders/' + q)),
        touch: (q) => update(r('graders/' + q), { lastActive: api.now() }),
        writeScore(e) {
            const up = {};
            up[`scores/${e.q}/${e.team}`] = e.v;
            up[`scoreMeta/${e.q}/${e.team}`] = e.v === null ? null : { by: lc(e.by), at: e.at };
            return update(r(''), up);
        },
        onConnected(cb) {
            onValue(ref(db, '.info/connected'), (s) => { if (s.val() === true) cb(); });
        }
    };
    return api;
}

/** fixture: bool. Live: pass user (already through requireStaff). */
export async function initGraderPage({ fixture, user }) {
    if (fixture) {
        const fx = await import('./spot-grading-fixture.js');
        backend = fixtureBackend(fx);
        me = fx.FIXTURE_ME;
        outboxKey = 'spot:v1:outbox:fixture';
        $('fixtureBanner').hidden = false;
    } else {
        backend = await liveBackend();
        me = { email: lc(user.email), name: user.displayName || user.email };
    }
    outbox = store.load();
    bind();
    backend.watch('config', (v) => { config = v || {}; renderAll(); });
    backend.watch('teams', (v) => {
        teams = v || {};
        teamIds = Object.keys(teams).sort();
        renderTeamList();
        renderAll();
    });
    backend.watch('graders', (v) => { graders = v || {}; renderPicker(); renderLock(); renderInputState(); });
    if (backend.onConnected) backend.onConnected(flush);
    renderAll();
    flush();
}
