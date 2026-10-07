// js/r1-backup-app.js — UI for the R1 backup exam page.
// Local-first: every change hits localStorage synchronously, then the sync module (live mode only).
import {
    parseUsername, canAnswerUnseen, storageKeys, normalizeQuestions, buildNavigator,
    mergeAnswers, makeClock, serverNow, formatClock, answerFromKey, STORAGE_PREFIX
} from './r1-backup-engine.js';

const params = new URLSearchParams(location.search);
const FIXTURE = params.get('fixture') === '1';
const FIXTURE_MINS = Math.max(0.2, Number(params.get('mins')) || 45);

const $ = (id) => document.getElementById(id);
const PARTS = ['mcq', 'unseen'];

// ---------- storage (always try/catch) ----------
const store = {
    load(key, fallback) {
        try { const v = localStorage.getItem(key); return v == null ? fallback : JSON.parse(v); } catch (e) { return fallback; }
    },
    save(key, value) {
        try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* page works without it */ }
    },
    drop(key) {
        try { localStorage.removeItem(key); } catch (e) { /* ignore */ }
    }
};

// ---------- state ----------
let sync = null;              // sync module (live only)
let user = null;              // parseUsername result
let keys = null;
let answers = {};
let flags = {};
let submitted = {};
let blur = 0;
let control = {};             // {mcq:{startAt,endAt}, unseen:{…}}
let questions = {};           // part → normalized
let curPart = 'mcq';
let itemByPart = {};
let focusIdx = 0;
let clockSynced = false;      // live mode: no auto-submit on an unsynced (possibly skewed) local clock
let nowFn = Date.now;       // replaced by server clock (live) or monotonic local clock (fixture)
let examShown = false;
let fetching = {};
let autoSubmitted = {};
let modalStep = 0;
let blurTimer = null;
let tickN = 0;

// ---------- helpers ----------
function show(id) {
    ['screenSeat', 'screenConfirm', 'screenWait', 'screenExam'].forEach((s) => { $(s).hidden = s !== id; });
}

function setText(id, t) { $(id).textContent = t; }

function showError(id, msg) {
    const el = $(id);
    el.textContent = msg || '';
    el.hidden = !msg;
}

const ALLOWED = { B: 'b', I: 'i', SUB: 'sub', SUP: 'sup' };
function appendRich(parent, node) {
    node.childNodes.forEach((c) => {
        if (c.nodeType === Node.TEXT_NODE) parent.appendChild(document.createTextNode(c.textContent));
        else if (c.nodeType === Node.ELEMENT_NODE) {
            const tag = ALLOWED[c.tagName];
            if (tag) { const el = document.createElement(tag); appendRich(el, c); parent.appendChild(el); } else appendRich(parent, c);
        }
    });
}
/** textContent-safe: inline <b><i><sub><sup> only, via inert DOMParser doc. */
function rich(el, text) {
    el.textContent = '';
    appendRich(el, new DOMParser().parseFromString(String(text == null ? '' : text), 'text/html').body);
    return el;
}

function mk(tag, cls, text) {
    const el = document.createElement(tag);
    if (cls) el.className = cls;
    if (text != null) el.textContent = text;
    return el;
}

const ctlOf = (part) => control[part] && control[part].startAt != null ? control[part] : null;
const partRemaining = (part) => { const c = ctlOf(part); return c ? c.endAt - nowFn() : null; };
const partStarted = (part) => { const c = ctlOf(part); return !!c && nowFn() >= c.startAt; };
const isLocked = (part) =>
    !!submitted[part] || (part === 'unseen' && !canAnswerUnseen(user.member)) || !partStarted(part) || partRemaining(part) <= 0;

function currentItem() {
    const norm = questions[curPart];
    if (!norm || !norm.items.length) return null;
    return norm.items.find((i) => i.id === itemByPart[curPart]) || norm.items[0];
}

// ---------- local-first mutations ----------
function savePos() {
    const it = currentItem();
    if (it) store.save(keys.pos, { part: curPart, itemId: it.id });
}

function setAnswer(qid, value, toggle) {
    if (isLocked(curPart)) return;
    if (toggle && answers[qid] === value) {
        delete answers[qid];
        store.save(keys.answers, answers);
        if (sync) sync.writeAnswer(qid, null);
    } else {
        answers[qid] = value;
        store.save(keys.answers, answers);
        if (sync) sync.writeAnswer(qid, value);
    }
    refresh();
}

function toggleFlag() {
    const it = currentItem();
    if (!it || isLocked(curPart)) return;
    if (flags[it.id]) delete flags[it.id]; else flags[it.id] = true;
    store.save(keys.flags, flags);
    if (sync) sync.writeFlag(it.id, !!flags[it.id]);
    refresh();
}

function gotoItem(id) {
    itemByPart[curPart] = id;
    focusIdx = 0;
    savePos();
    refresh();
}

function stepItem(dir) {
    const norm = questions[curPart];
    if (!norm) return;
    const i = norm.items.findIndex((x) => x.id === (currentItem() || {}).id);
    const next = norm.items[Math.min(norm.items.length - 1, Math.max(0, i + dir))];
    if (next) gotoItem(next.id);
}

function switchPart(part) {
    curPart = part;
    focusIdx = 0;
    savePos();
    refresh();
}

// ---------- render ----------
function note(text) {
    const n = mk('div', 'readonly-note', text);
    $('canvas').replaceChildren(n);
    $('navGrid').replaceChildren();
}

function renderCanvas() {
    const canvas = $('canvas');
    if (curPart === 'unseen' && !canAnswerUnseen(user.member)) return note('ส่งโดยหัวหน้าทีม (-1)');
    if (!partStarted(curPart)) return note(ctlOf(curPart) ? 'ยังไม่ถึงเวลาเริ่ม Part นี้' : 'รอกรรมการเปิดข้อสอบ Part นี้');
    const item = currentItem();
    if (!item) return note('กำลังโหลดข้อสอบ…');
    const locked = isLocked(curPart);
    const frag = document.createDocumentFragment();

    if (submitted[curPart]) frag.appendChild(mk('p', 'error', 'ส่งแล้ว — แก้ไขไม่ได้'));
    else if (locked) frag.appendChild(mk('p', 'error', 'หมดเวลา — ล็อกคำตอบแล้ว'));

    if (curPart === 'unseen') {
        frag.appendChild(mk('div', 'article', item.articleTitle));
        frag.appendChild(mk('h2', null, `ตอน ${item.label}`));
        frag.appendChild(rich(mk('div', 'stem'), item.prompt));
    } else {
        frag.appendChild(mk('h2', null, `ข้อ ${item.no}`));
        frag.appendChild(rich(mk('div', 'stem'), item.stem));
        if (item.imageUrl && item.imageUrl.startsWith('https://')) {
            const img = mk('img');
            img.src = item.imageUrl;
            img.alt = '';
            frag.appendChild(img);
        }
    }

    if (item.type === 'sba') {
        item.options.forEach((o, i) => {
            const b = mk('button', 'opt' + (answers[item.id] === o.key ? ' sel' : ''));
            b.type = 'button';
            b.disabled = locked;
            b.setAttribute('aria-pressed', String(answers[item.id] === o.key));
            b.appendChild(mk('span', 'k', `${o.key}.`));
            b.appendChild(rich(mk('span'), o.text));
            b.addEventListener('click', () => setAnswer(item.id, o.key, true));
            frag.appendChild(b);
        });
    } else {
        item.statements.forEach((s, i) => {
            const row = mk('div', 'stmt' + (i === focusIdx ? ' focus' : ''));
            row.appendChild(mk('span', 'no', `${i + 1}.`));
            row.appendChild(rich(mk('span', 'txt'), s.text));
            const tf = mk('div', 'tf');
            ['T', 'F'].forEach((v) => {
                const b = mk('button', null, v === 'T' ? 'จริง' : 'เท็จ');
                b.type = 'button';
                b.disabled = locked;
                b.setAttribute('aria-pressed', String(answers[s.id] === v));
                b.addEventListener('click', () => { focusIdx = i; setAnswer(s.id, v, true); });
                tf.appendChild(b);
            });
            row.appendChild(tf);
            frag.appendChild(row);
        });
    }
    canvas.replaceChildren(frag);
}

function renderNav() {
    const norm = questions[curPart];
    const grid = $('navGrid');
    if (!norm || (curPart === 'unseen' && !canAnswerUnseen(user.member)) || !partStarted(curPart)) { grid.replaceChildren(); return; }
    const cur = (currentItem() || {}).id;
    const cells = buildNavigator(curPart, norm, answers, flags).map((c) => {
        const b = mk('button', `cell s-${c.status}${c.flagged ? ' flagged' : ''}${c.id === cur ? ' cur' : ''}`, c.label);
        b.type = 'button';
        b.title = `${c.status}${c.flagged ? ' + flag' : ''}`;
        b.addEventListener('click', () => gotoItem(c.id));
        return b;
    });
    grid.replaceChildren(...cells);
}

function renderChrome() {
    setText('hdrSeat', user.username);
    $('tabMcq').setAttribute('aria-selected', String(curPart === 'mcq'));
    $('tabUnseen').setAttribute('aria-selected', String(curPart === 'unseen'));
    const unlocked = !isLocked(curPart);
    $('btnFlag').disabled = !unlocked || !currentItem();
    $('btnSubmit').disabled = !unlocked;
    $('btnPrev').disabled = $('btnNext').disabled = !currentItem();
    const it = currentItem();
    $('btnFlag').textContent = it && flags[it.id] ? 'เอาธงออก (M)' : 'ติดธง (M)';
    $('hdrBlur').hidden = blur === 0;
    setText('hdrBlur', `ออกนอกหน้าจอ ${blur} ครั้ง`);
    $('hdrBlur').classList.add('bad');
    updateClock();
}

function refresh() {
    if (!examShown) return;
    renderChrome();
    renderCanvas();
    renderNav();
}

function updateClock() {
    const el = $('hdrClock');
    const rem = partRemaining(curPart);
    if (curPart === 'unseen' && !canAnswerUnseen(user.member)) { el.textContent = '--:--'; return; }
    if (submitted[curPart]) el.textContent = 'ส่งแล้ว';
    else if (rem == null) el.textContent = '--:--';
    else if (!partStarted(curPart)) el.textContent = 'รอเริ่ม';
    else el.textContent = formatClock(rem);
    el.classList.toggle('low', rem != null && rem > 0 && rem <= 5 * 60000 && !submitted[curPart]);
}

function updateSyncChip() {
    const chip = $('hdrSync');
    if (!sync) { chip.textContent = 'บันทึกในเครื่อง'; return; }
    const n = Object.keys(store.load(keys.outbox, {}) || {}).length;
    chip.textContent = n ? `รอซิงก์ ${n}` : 'ซิงก์แล้ว';
    chip.classList.toggle('bad', n > 0);
}

// ---------- routing ----------
function route() {
    if (!user) return;
    if (!examShown) {
        if (partStarted('mcq')) {
            examShown = true;
            show('screenExam');
            updateFsBanner();
            refresh();
        } else {
            show('screenWait');
            setText('waitSeat', user.username);
            const c = ctlOf('mcq');
            if (!c) { setText('waitText', 'รอกรรมการเปิดข้อสอบ'); setText('waitClock', '--:--'); }
            else { setText('waitText', 'ข้อสอบจะเริ่มใน'); setText('waitClock', formatClock(c.startAt - nowFn())); }
            setText('waitParts', canAnswerUnseen(user.member) ? 'Part 1 และ Part 2 (หัวหน้าทีม)' : 'Part 1 (Part 2 ส่งโดยหัวหน้าทีม)');
        }
    }
}

// ---------- submit ----------
async function doSubmit(part) {
    if (submitted[part]) return;
    submitted[part] = Date.now();
    store.save(keys.submitted, submitted);
    refresh();
    if (sync) {
        try { await sync.submitPart(part); } catch (e) { /* already submitted / window rules: local mark stays */ }
    }
}

function openModal(step) {
    modalStep = step;
    const norm = questions[curPart];
    const label = curPart === 'mcq' ? 'Part 1' : 'Part 2';
    if (step === 1) {
        const items = norm ? buildNavigator(curPart, norm, answers, flags) : [];
        const un = items.filter((i) => i.status !== 'answered').length;
        const fl = items.filter((i) => i.flagged).length;
        setText('modalTitle', `ส่ง ${label}`);
        setText('modalBody', `ยังไม่ตอบครบ ${un} ข้อ · ติดธง ${fl} ข้อ`);
        setText('modalOk', 'ถัดไป');
    } else {
        setText('modalTitle', `ยืนยันส่ง ${label} จริงหรือไม่`);
        setText('modalBody', 'เมื่อส่งแล้วจะแก้ไขคำตอบไม่ได้');
        setText('modalOk', 'ยืนยันส่ง');
    }
    $('modal').hidden = false;
    $('modalCancel').focus();
}

function closeModal() { modalStep = 0; $('modal').hidden = true; }

// ---------- keyboard ----------
document.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.id !== 'seatInput') { e.preventDefault(); return; }
    if (!examShown || !$('modal').hidden || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.target.tagName === 'INPUT') return;
    const item = currentItem();
    if (!item || (curPart === 'unseen' && !canAnswerUnseen(user.member))) return;
    const act = answerFromKey(item, e.key, focusIdx);
    if (!act) return;
    e.preventDefault();
    if (act.type === 'nav') stepItem(act.dir);
    else if (act.type === 'flag') toggleFlag();
    else if (act.type === 'focus') { focusIdx = act.index; refresh(); }
    else if (act.type === 'answer') {
        setAnswer(act.qid, act.value, false);
        if (item.type !== 'sba' && focusIdx < item.statements.length - 1) { focusIdx += 1; refresh(); }
    }
});

// ---------- blur / fullscreen ----------
function noteBlur() {
    if (!examShown || blurTimer) return;
    blurTimer = setTimeout(() => {
        blurTimer = null;
        if (document.hidden || !document.hasFocus()) {
            blur += 1;
            store.save(keys.blur, blur);
            if (sync) sync.writeBlur(blur);
            refresh();
        }
    }, 1000);
}
window.addEventListener('blur', noteBlur);
document.addEventListener('visibilitychange', () => { if (document.hidden) noteBlur(); });

function updateFsBanner() {
    $('fsBanner').hidden = !examShown || !!document.fullscreenElement;
}
document.addEventListener('fullscreenchange', updateFsBanner);
function requestFs() {
    try { const p = document.documentElement.requestFullscreen(); if (p && p.catch) p.catch(() => {}); } catch (e) { /* ignore */ }
}

// ---------- theme ----------
function applyTheme(t) { document.documentElement.setAttribute('data-theme', t); }
function initTheme() {
    let t = store.load(STORAGE_PREFIX + 'theme', null);
    if (t !== 'light' && t !== 'dark') t = window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    applyTheme(t);
}

// ---------- seat start ----------
function loadLocalState() {
    keys = storageKeys(user.username);
    answers = store.load(keys.answers, {}) || {};
    flags = store.load(keys.flags, {}) || {};
    submitted = store.load(keys.submitted, {}) || {};
    blur = Number(store.load(keys.blur, 0)) || 0;
    control = store.load(keys.ctl, {}) || {};
    questions = {};
    [['mcq', keys.qMcq], ['unseen', keys.qUnseen]].forEach(([p, k]) => {
        const raw = store.load(k, null);
        if (raw) questions[p] = normalizeQuestions(p, raw);
    });
    const pos = store.load(keys.pos, null);
    if (pos && PARTS.includes(pos.part)) { curPart = pos.part; itemByPart[pos.part] = pos.itemId; }
}

function startFixture() {
    loadLocalState();
    if (!ctlOf('mcq')) {
        const t = Date.now();
        control = { mcq: { startAt: t, endAt: t + FIXTURE_MINS * 60000 }, unseen: { startAt: t, endAt: t + FIXTURE_MINS * 60000 } };
        store.save(keys.ctl, control);
    }
    const clock = makeClock({ serverNowAtSync: Date.now(), monoAtSync: performance.now() });
    nowFn = () => serverNow(clock, performance.now());
    import('./r1-backup-fixture.js').then(({ FIXTURE_QUESTIONS }) => {
        PARTS.forEach((p) => { questions[p] = normalizeQuestions(p, FIXTURE_QUESTIONS[p]); });
        begin();
    });
}

async function startLive(preloaded) {
    if (!preloaded) loadLocalState();
    sync.configure({
        username: user.username, store, outboxKey: keys.outbox,
        onDroppedWrite: () => { const c = $('hdrSync'); c.textContent = 'บันทึกไม่ได้ (ปิดรับ/ส่งแล้ว)'; c.classList.add('bad'); }
    });
    // render from local first; network afterwards
    begin();
    try {
        const clock = await sync.startServerClock();
        nowFn = () => serverNow(clock, performance.now());
        clockSynced = true;
        sync.watchControl((c) => { control = c; store.save(keys.ctl, c); });
        sync.startOutboxFlusher();
        const remote = await sync.loadRemote();
        mergeRemote(remote);
        refresh();
    } catch (e) { /* offline: local state keeps working, flusher retries */ }
}

function mergeRemote(remote) {
    const a = mergeAnswers(answers, remote.answers);
    answers = a.merged;
    a.pushLocalOnly.forEach((k) => sync.writeAnswer(k, answers[k]));
    const f = mergeAnswers(flags, remote.flags);
    flags = f.merged;
    f.pushLocalOnly.forEach((k) => sync.writeFlag(k, true));
    const outbox = store.load(keys.outbox, {}) || {}; // pending local removals win over remote
    Object.keys(outbox).forEach((p) => {
        const [kind, id] = p.split('/');
        if (kind === 'answers') { if (outbox[p] === null) delete answers[id]; else answers[id] = outbox[p]; }
        if (kind === 'flags') { if (outbox[p] === null) delete flags[id]; else flags[id] = true; }
    });
    blur = Math.max(blur, Number(remote.blurCount) || 0);
    Object.keys(remote.submitted || {}).forEach((p) => { submitted[p] = remote.submitted[p]; });
    store.save(keys.answers, answers);
    store.save(keys.flags, flags);
    store.save(keys.blur, blur);
    store.save(keys.submitted, submitted);
}

let started = false;
function begin() {
    route();
    refresh();
    if (!started) { started = true; setInterval(tick, 250); }
}

function tick() {
    tickN += 1;
    route();
    if (!examShown) return;
    updateClock();
    if (tickN % 4 === 0) updateSyncChip();
    PARTS.forEach((p) => {
        if (p === 'unseen' && !canAnswerUnseen(user.member)) return;
        const rem = partRemaining(p);
        if (rem != null && rem <= 0 && !submitted[p] && !autoSubmitted[p] && partStarted(p) && (!sync || clockSynced)) {
            autoSubmitted[p] = true;
            doSubmit(p);
        }
        if (sync && partStarted(p) && !questions[p] && !fetching[p]) loadQuestions(p);
    });
    // lock/unlock transitions that need a re-render
    const locked = isLocked(curPart);
    if (tick.lastLocked !== locked || tick.lastStarted !== partStarted(curPart)) {
        tick.lastLocked = locked;
        tick.lastStarted = partStarted(curPart);
        refresh();
    }
}

async function loadQuestions(part) {
    fetching[part] = true;
    try {
        const raw = await sync.fetchQuestions(part);
        store.save(part === 'mcq' ? keys.qMcq : keys.qUnseen, raw);
        questions[part] = normalizeQuestions(part, raw);
        refresh();
    } catch (e) {
        fetching[part] = false;
    }
}

// questions for mcq are needed already on the waiting screen once startAt passes; route() flips to exam, tick fetches.

// ---------- seat flow ----------
let pendingUser = null;

$('seatForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const p = parseUsername($('seatInput').value);
    if (!p) return showError('seatError', 'รูปแบบไม่ถูกต้อง เช่น mq2026-001-1 (ทีม 1–100, สมาชิก 1–3)');
    showError('seatError', '');
    pendingUser = p;
    setText('confirmText', `ใช่ ${p.username} หรือไม่?`);
    showError('confirmError', '');
    show('screenConfirm');
});

$('confirmNo').addEventListener('click', () => { pendingUser = null; show('screenSeat'); });

$('confirmYes').addEventListener('click', async () => {
    requestFs();
    user = pendingUser;
    if (FIXTURE) { startFixture(); return; }
    $('confirmYes').disabled = true;
    try {
        sync = await import('./r1-backup-sync.js');
        const u = await sync.ensureAnon();
        const r = await sync.claimSeat(user.username);
        if (r === 'taken') {
            sync = null;
            showError('confirmError', 'ที่นั่งนี้ถูกใช้งานแล้ว กรุณาแจ้งกรรมการ');
            return;
        }
        store.save(storageKeys(user.username).session,{ username: user.username, uid: u.uid, savedAt: Date.now() });
        await startLive();
    } catch (e) {
        sync = null;
        showError('confirmError', e && e.message === 'STAFF_SESSION'
            ? 'ออกจากระบบ staff ก่อน / ใช้โปรไฟล์อื่น'
            : 'เชื่อมต่อไม่สำเร็จ กรุณาลองใหม่ (' + (e && (e.code || e.message) || 'error') + ')');
    } finally {
        $('confirmYes').disabled = false;
    }
});

// ---------- auto-resume (live) ----------
async function tryResume() {
    const s = store.load(storageKeys('').session, null);
    const p = s && parseUsername(s.username);
    if (!p) return false;
    user = p;
    loadLocalState();
    begin(); // render from local state before any network await
    try {
        sync = await import('./r1-backup-sync.js');
        const u = await sync.ensureAnon();
        if (u.uid !== s.uid) throw new Error('UID_MISMATCH');
    } catch (e) {
        sync = null;
        user = null;
        examShown = false;
        if (e && e.message === 'STAFF_SESSION') showError('seatError', 'ออกจากระบบ staff ก่อน / ใช้โปรไฟล์อื่น');
        else store.drop(storageKeys('').session);
        return false;
    }
    await startLive(true);
    return true;
}

// ---------- wiring ----------
$('tabMcq').addEventListener('click', () => switchPart('mcq'));
$('tabUnseen').addEventListener('click', () => switchPart('unseen'));
$('btnPrev').addEventListener('click', () => stepItem(-1));
$('btnNext').addEventListener('click', () => stepItem(1));
$('btnFlag').addEventListener('click', toggleFlag);
$('btnSubmit').addEventListener('click', () => openModal(1));
$('modalCancel').addEventListener('click', closeModal);
$('modalOk').addEventListener('click', () => {
    if (modalStep === 1) { openModal(2); return; }
    const part = curPart;
    closeModal();
    doSubmit(part);
});
$('themeToggle').addEventListener('click', () => {
    const t = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    applyTheme(t);
    store.save(STORAGE_PREFIX + 'theme', t);
});
$('navToggle').addEventListener('click', () => {
    const closed = $('navPanel').classList.toggle('closed');
    $('navToggle').setAttribute('aria-expanded', String(!closed));
});
$('fsReenter').addEventListener('click', requestFs);

async function boot() {
    initTheme();
    if (FIXTURE) $('fixtureBanner').hidden = false;
    if (!FIXTURE && (await tryResume())) return;
    const preset = parseUsername(params.get('u'));
    if (FIXTURE && preset) { user = preset; startFixture(); return; }
    show('screenSeat');
    $('seatInput').focus();
}

boot();
