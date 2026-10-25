#!/usr/bin/env node
// R1 backup exam: 300-client load test. Zero dependencies (Node 18+, global fetch).
// Writes ONLY under r1_backup_exam_loadtest/ (hardcoded below, no option changes it).
// Default mode is DRY RUN (in-memory stub, no network). Live needs --live plus env vars.
//
//   node loadtest.mjs print-rules            # rules snippet for the test subtree (merge into RTDB rules)
//   node loadtest.mjs seed                   # JSON to Import in console at r1_backup_exam_loadtest
//   node loadtest.mjs run [--live] [opts]    # the test
//   node loadtest.mjs cleanup [--live]       # delete the test subtree
//
// Env (live only): R1_LT_DB_URL, R1_LT_API_KEY (both are in js/firebase-config.js),
//                  R1_LT_AUTH (cleanup only: staff Firebase ID token, or OAuth access token).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = 'r1_backup_exam_loadtest';
const LIVE_ROOT = 'r1_backup_exam';
const SV = { '.sv': 'timestamp' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rand = (a, b) => a + Math.random() * (b - a);
const pad3 = (n) => String(n).padStart(3, '0');

// ---------- args ----------
const argv = process.argv.slice(2);
const cmd = argv[0] && !argv[0].startsWith('--') ? argv.shift() : 'run';
const opt = {
    live: false, json: false, clients: 300, writes: 28,
    rampMs: 20000, thinkMin: 800, thinkMax: 3500, burstMs: 3000, barrierMaxMs: 180000,
    stubLatency: 1, stubFail: 0.01,
};
const num = new Set(['clients', 'writes', 'rampMs', 'thinkMin', 'thinkMax', 'burstMs', 'barrierMaxMs', 'stubLatency', 'stubFail']);
for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) die(`unexpected argument: ${a}`);
    const k = a.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    if (!(k in opt)) die(`unknown option: ${a}`);
    if (typeof opt[k] === 'boolean') opt[k] = true;
    else {
        const v = Number(argv[++i]);
        if (!Number.isFinite(v) || v < 0) die(`bad value for ${a}`);
        opt[k] = v;
    }
}
function die(m) { console.error('ERROR: ' + m); process.exit(2); }
if (opt.clients < 1 || opt.clients > 300) die('--clients must be 1..300 (seat usernames are mq2026-001..100 x 1..3)');
if (opt.thinkMax < opt.thinkMin) die('--think-max < --think-min');

// ---------- seats / ids ----------
// Same id contract as R1_BACKUP_EXAM.md: m01-m23 (A-E), m24s1..m28s4 (T/F), u1a1..u3b4 (T/F, member -1 only).
function seatUsername(i) { return `mq2026-${pad3(Math.floor(i / 3) + 1)}-${(i % 3) + 1}`; }
const MCQ_IDS = [];
for (let n = 1; n <= 23; n++) MCQ_IDS.push({ id: 'm' + pad3(n).slice(1), v: 'ABCDE' });
for (let n = 24; n <= 28; n++) for (let s = 1; s <= 4; s++) MCQ_IDS.push({ id: `m${n}s${s}`, v: 'TF' });
const UNSEEN_IDS = [];
for (const a of [1, 2, 3]) for (const b of ['a', 'b']) for (let s = 1; s <= 4; s++) UNSEEN_IDS.push({ id: `u${a}${b}${s}`, v: 'TF' });
const pick = (s) => s[Math.floor(Math.random() * s.length)];

// ---------- stats ----------
const stats = new Map(); // op -> { lat:[], ok, fail, codes:{} }
function record(op, ms, ok, code) {
    let s = stats.get(op);
    if (!s) stats.set(op, (s = { lat: [], ok: 0, fail: 0, codes: {} }));
    s.lat.push(ms);
    if (ok) s.ok++; else { s.fail++; s.codes[code] = (s.codes[code] || 0) + 1; }
}
const pct = (sorted, p) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)] : 0);

// ---------- transports ----------
// request(method, path, body, token) -> { ok, status, json }. signUp() -> { token, uid }.
function liveTransport() {
    const db = (process.env.R1_LT_DB_URL || '').replace(/\/+$/, '');
    const key = process.env.R1_LT_API_KEY || '';
    if (!db || !key) die('live mode needs env R1_LT_DB_URL and R1_LT_API_KEY');
    return {
        async signUp() {
            const r = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${encodeURIComponent(key)}`, {
                method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ returnSecureToken: true }),
            });
            const j = await r.json().catch(() => ({}));
            if (!r.ok) return { ok: false, status: j?.error?.message || r.status };
            return { ok: true, token: j.idToken, uid: j.localId };
        },
        async request(method, path, body, token) {
            const r = await fetch(`${db}/${path}.json?auth=${encodeURIComponent(token)}`, {
                method, headers: body === undefined ? {} : { 'content-type': 'application/json' },
                body: body === undefined ? undefined : JSON.stringify(body),
            });
            const j = await r.json().catch(() => null);
            return { ok: r.ok, status: r.ok ? r.status : (j && j.error) || r.status, json: j };
        },
    };
}

function stubTransport() {
    // In-memory stand-in. Mimics: seat uid write-once, answers need own uid + open window + not submitted,
    // submitted write-once. Injects latency and random 503s. Not a rules test.
    const tree = {};
    let nextUid = 1;
    const lat = () => sleep(rand(20, 120) * opt.stubLatency);
    const flaky = () => Math.random() < opt.stubFail;
    const control = () => tree._control;
    return {
        tree,
        async signUp() {
            await lat();
            if (flaky()) return { ok: false, status: 'TOO_MANY_ATTEMPTS_TRY_LATER' };
            const uid = 'stub-uid-' + nextUid++;
            return { ok: true, token: uid, uid };
        },
        async request(method, path, body, token) {
            await lat();
            if (flaky()) return { ok: false, status: 503, json: null };
            const denied = { ok: false, status: 'Permission denied', json: null };
            const parts = path.split('/'); // [ROOT, ...]
            if (parts[0] !== ROOT) return denied;
            const rest = parts.slice(1);
            if (method === 'GET') {
                if (rest[0] === '_control') return { ok: true, status: 200, json: control() ?? null };
                if (rest[0] === '_questions') return { ok: true, status: 200, json: tree._questions?.[rest[1]] ?? null };
                if (rest[1] === 'uid') return { ok: true, status: 200, json: tree[rest[0]]?.uid ?? null }; // uid is world-readable to authed users
                return denied;
            }
            if (method === 'DELETE' && rest.length === 0) { for (const k of Object.keys(tree)) delete tree[k]; return { ok: true, status: 200, json: null }; }
            const [u, kind, id] = rest;
            const seat = (tree[u] ||= {});
            const open = (part) => { const c = control()?.[part]; const now = Date.now(); return c && now >= c.startAt && now <= c.endAt; };
            if (method === 'PATCH' && rest.length === 1) {
                if (seat.uid || body?.uid !== token) return denied;
                seat.uid = body.uid; seat.claimedAt = Date.now();
                return { ok: true, status: 200, json: body };
            }
            if (seat.uid !== token) return denied;
            if (method === 'PUT' && kind === 'answers') {
                const part = id.startsWith('m') ? 'mcq' : 'unseen';
                if (!open(part) || seat.submitted?.[part]) return denied;
                (seat.answers ||= {})[id] = body;
                return { ok: true, status: 200, json: body };
            }
            if (method === 'PUT' && kind === 'submitted') {
                if (seat.submitted?.[id]) return denied;
                (seat.submitted ||= {})[id] = Date.now();
                return { ok: true, status: 200, json: body };
            }
            return denied;
        },
    };
}

// ---------- fake data for seed + stub ----------
function fakeQuestions() {
    const items = {};
    for (let n = 1; n <= 23; n++) {
        items['m' + pad3(n).slice(1)] = {
            no: n, type: 'sba', stem: `FAKE stem ${n}. ` + 'Lorem ipsum dolor sit amet. '.repeat(12),
            options: { A: 'FAKE option A', B: 'FAKE option B', C: 'FAKE option C', D: 'FAKE option D', E: 'FAKE option E' },
        };
    }
    for (let n = 24; n <= 28; n++) {
        const statements = {};
        for (let s = 1; s <= 4; s++) statements[`m${n}s${s}`] = { no: s, text: `FAKE statement ${s}. ` + 'Lorem ipsum. '.repeat(6) };
        items['m' + n] = { no: n, type: 'mtf', stem: `FAKE stem ${n}. ` + 'Lorem ipsum dolor sit amet. '.repeat(10), statements };
    }
    return { version: 1, part: 'mcq', title: 'FAKE LOADTEST MCQ', items };
}
function controlWindow(now) {
    const w = { startAt: now - 60 * 1000, endAt: now + 2 * 60 * 60 * 1000 };
    return { mcq: { ...w }, unseen: { ...w } };
}

// ---------- commands ----------
const here = dirname(fileURLToPath(import.meta.url));

if (cmd === 'print-rules') {
    const src = readFileSync(join(here, '..', '..', 'r1_backup_exam.rules.json'), 'utf8');
    const out = src.replace(new RegExp(LIVE_ROOT + '(?!_loadtest)', 'g'), ROOT);
    JSON.parse(out); // fail loudly if the transform broke it
    console.log(out);
    process.exit(0);
}

if (cmd === 'seed') {
    console.log(JSON.stringify({ _control: controlWindow(Date.now()), _questions: { mcq: fakeQuestions() } }, null, 2));
    console.error(`# Import this JSON at /${ROOT} (console: Realtime Database > Data > ... > Import JSON). Window = now-1min .. now+2h. Re-seed before each run.`);
    process.exit(0);
}

if (cmd === 'cleanup') {
    const t = opt.live ? liveTransport() : stubTransport();
    if (!opt.live) { console.log('dry-run: stub only, nothing deleted (no network).'); process.exit(0); }
    const auth = process.env.R1_LT_AUTH;
    if (!auth) die(`cleanup live needs env R1_LT_AUTH (staff ID token). Alternative: delete /${ROOT} in the Firebase console.`);
    const r = await t.request('DELETE', ROOT, undefined, auth);
    console.log(r.ok ? `deleted /${ROOT}` : `FAILED: ${JSON.stringify(r.status)}`);
    console.log('Anonymous Auth users created by the test remain: delete them in Authentication > Users if wanted.');
    process.exit(r.ok ? 0 : 1);
}

if (cmd !== 'run') die(`unknown command: ${cmd}`);

// ---------- run ----------
const T = opt.live ? liveTransport() : stubTransport();
const mode = opt.live ? 'LIVE' : 'DRY-RUN (stub, no network)';
console.error(`mode=${mode} root=${ROOT} clients=${opt.clients} writes=${opt.writes} ramp=${opt.rampMs}ms think=${opt.thinkMin}-${opt.thinkMax}ms burst=${opt.burstMs}ms`);

const timed = async (op, fn) => {
    const t0 = performance.now();
    let r;
    try { r = await fn(); } catch (e) { r = { ok: false, status: 'EXC:' + (e.cause?.code || e.message) }; }
    record(op, performance.now() - t0, r.ok, String(typeof r.status === 'object' ? JSON.stringify(r.status) : r.status));
    return r;
};

if (!opt.live) {
    T.tree._control = controlWindow(Date.now());
    T.tree._questions = { mcq: fakeQuestions() };
}

// barrier: resolves when every client has finished its write phase (or failed out), or after barrierMaxMs.
let waiting = opt.clients;
let release;
const barrier = new Promise((r) => { release = r; });
const barrierTimer = setTimeout(() => release('timeout'), opt.barrierMaxMs);
const arrive = () => { if (--waiting === 0) { clearTimeout(barrierTimer); release('all'); } };

const burstTimes = [];
let preflightDone = false;
let preflightErr = null;

async function client(i) {
    await sleep((opt.rampMs * i) / opt.clients);
    const username = seatUsername(i);
    const isLead = username.endsWith('-1');
    let arrived = false;
    const done = () => { if (!arrived) { arrived = true; arrive(); } };
    try {
        const su = await timed('signUp', () => T.signUp());
        if (!su.ok) return done();
        const { token, uid } = su;

        // first client checks that the test window is open; everyone else skips if it is not
        const ctl = await timed('readControl', () => T.request('GET', `${ROOT}/_control`, undefined, token));
        if (!preflightDone) {
            preflightDone = true;
            const c = ctl.json;
            const now = Date.now();
            if (!ctl.ok || !c?.mcq || now < c.mcq.startAt || now > c.mcq.endAt) {
                preflightErr = `_control/mcq window not open at /${ROOT} (ok=${ctl.ok}). Run: seed, import it, then rerun.`;
                release('preflight');
            }
        }
        if (preflightErr) return done();

        // seat claim (what the page does: get uid, then update uid+claimedAt)
        const probe = await timed('claimProbe', () => T.request('GET', `${ROOT}/${username}/uid`, undefined, token));
        if (probe.ok && probe.json) return done();
        const claim = await timed('claimSeat', () => T.request('PATCH', `${ROOT}/${username}`, { uid, claimedAt: SV }, token));
        if (!claim.ok) return done();

        // question fetch (all students hit this together at startAt in real life)
        await timed('fetchQuestions', () => T.request('GET', `${ROOT}/_questions/mcq`, undefined, token));

        // answer writes with human-like spacing
        const pool = MCQ_IDS.slice(0, Math.max(1, opt.writes));
        for (const q of pool) {
            await sleep(rand(opt.thinkMin, opt.thinkMax));
            await timed('answerWrite', () => T.request('PUT', `${ROOT}/${username}/answers/${q.id}`, pick(q.v), token));
        }
        if (isLead) {
            for (const q of UNSEEN_IDS) {
                await sleep(rand(opt.thinkMin, opt.thinkMax));
                await timed('answerWrite', () => T.request('PUT', `${ROOT}/${username}/answers/${q.id}`, pick(q.v), token));
            }
        }
        done();

        // synchronized burst: everyone submits inside the same few seconds
        await barrier;
        if (preflightErr) return;
        await sleep(rand(0, opt.burstMs));
        burstTimes.push(Date.now());
        await timed('submitBurst', () => T.request('PUT', `${ROOT}/${username}/submitted/mcq`, SV, token));
        if (isLead) await timed('submitBurst', () => T.request('PUT', `${ROOT}/${username}/submitted/unseen`, SV, token));
    } finally {
        done();
    }
}

const wall0 = performance.now();
await Promise.all(Array.from({ length: opt.clients }, (_, i) => client(i)));
const wallMs = performance.now() - wall0;

// ---------- report ----------
if (preflightErr) { console.error('ABORTED: ' + preflightErr); process.exit(3); }
const rows = [];
for (const [op, s] of stats) {
    const l = s.lat.slice().sort((a, b) => a - b);
    rows.push({ op, n: l.length, ok: s.ok, fail: s.fail, p50: pct(l, 50), p90: pct(l, 90), p95: pct(l, 95), p99: pct(l, 99), max: l[l.length - 1] || 0, codes: s.codes });
}
const burstSpan = burstTimes.length ? Math.max(...burstTimes) - Math.min(...burstTimes) : 0;
const seatsClaimed = stats.get('claimSeat')?.ok || 0;
const report = { mode, root: ROOT, clients: opt.clients, wallSeconds: +(wallMs / 1000).toFixed(1), seatsClaimed, burstStartSpanMs: burstSpan, ops: rows };

if (opt.json) console.log(JSON.stringify(report, null, 2));
else {
    console.log(`\nmode=${mode} root=/${ROOT} clients=${opt.clients} wall=${report.wallSeconds}s seatsClaimed=${seatsClaimed} burstStartSpan=${burstSpan}ms`);
    console.log('op'.padEnd(16) + 'n'.padStart(6) + 'ok'.padStart(6) + 'fail'.padStart(6) + 'p50'.padStart(8) + 'p90'.padStart(8) + 'p95'.padStart(8) + 'p99'.padStart(8) + 'max'.padStart(8) + '  (ms)');
    for (const r of rows) {
        console.log(r.op.padEnd(16) + String(r.n).padStart(6) + String(r.ok).padStart(6) + String(r.fail).padStart(6) +
            [r.p50, r.p90, r.p95, r.p99, r.max].map((x) => String(Math.round(x)).padStart(8)).join(''));
        for (const [c, n] of Object.entries(r.codes)) console.log(`    fail ${n}x ${c}`);
    }
}
const expectedClaims = opt.clients;
if (seatsClaimed < expectedClaims) console.log(`\nWARNING: only ${seatsClaimed}/${expectedClaims} seats claimed (see signUp / claimSeat failures above).`);
if (!opt.live) console.log('\nDRY RUN only: numbers come from the stub, not Firebase.');
process.exit(0);
