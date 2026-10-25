#!/usr/bin/env node
// R1 backup exam: 300-client load test against the Cloudflare Worker + D1 API (R1_BACKUP_API.md).
// Zero dependencies (Node 18+, global fetch). Synthetic questions/answers only.
//
//   node loadtest.mjs run --base http://127.0.0.1:8787 --admin-token T [opts]
//   node loadtest.mjs cleanup                      # prints the SQL that resets the test D1 (does not run it)
//
// Env alternatives: R1_LT_BASE, R1_LT_ADMIN_TOKEN.
// WARNING: `run` overwrites control/mcq, control/unseen and questions/mcq, questions/unseen with synthetic data
// and leaves 300 seats, answers and submissions behind. Use a throwaway D1 only. Non-localhost bases need --confirm-test-db.
//
// Phases (one metrics row each): claim, control (initial + 30 s polls), questions (burst at startAt),
// checkpoint (10 s delta POST /api/submit per part), final (burst POST /api/submit final:true).
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rand = (a, b) => a + Math.random() * (b - a);
const pad3 = (n) => String(n).padStart(3, '0');

// ---------- args ----------
const argv = process.argv.slice(2);
const cmd = argv[0] && !argv[0].startsWith('--') ? argv.shift() : 'run';
const opt = {
    base: process.env.R1_LT_BASE || '', adminToken: process.env.R1_LT_ADMIN_TOKEN || '',
    confirmTestDb: false, json: false, clients: 300, writes: 28,
    rampMs: 20000, thinkMin: 800, thinkMax: 3500, burstMs: 3000, checkpointMs: 10000, controlPollMs: 30000,
    startLeadMs: 3000, };
const strOpts = new Set(['base', 'adminToken']);
const bad = (m) => { console.error('ERROR: ' + m); process.exit(2); };
for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) bad(`unexpected argument: ${a}`);
    const k = a.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    if (!(k in opt)) bad(`unknown option: ${a}`);
    if (typeof opt[k] === 'boolean') opt[k] = true;
    else if (strOpts.has(k)) opt[k] = argv[++i] || bad(`missing value for ${a}`);
    else {
        const v = Number(argv[++i]);
        if (!Number.isFinite(v) || v < 0) bad(`bad value for ${a}`);
        opt[k] = v;
    }
}
if (opt.clients < 1 || opt.clients > 300) bad('--clients must be 1..300 (seats are mq2026-001..100 x 1..3)');
if (opt.thinkMax < opt.thinkMin) bad('--think-max < --think-min');
opt.base = opt.base.replace(/\/+$/, '');

// ---------- ids / seats (same id contract as R1_BACKUP_API.md) ----------
const seatUsername = (i) => `mq2026-${pad3(Math.floor(i / 3) + 1)}-${(i % 3) + 1}`;
const MCQ_IDS = [];
for (let n = 1; n <= 23; n++) MCQ_IDS.push({ id: 'm' + pad3(n).slice(1), v: 'ABCDE' });
for (let n = 24; n <= 28; n++) for (let s = 1; s <= 4; s++) MCQ_IDS.push({ id: `m${n}s${s}`, v: 'TF' });
const UNSEEN_IDS = [];
for (const a of [1, 2, 3]) for (const b of ['a', 'b']) for (let s = 1; s <= 4; s++) UNSEEN_IDS.push({ id: `u${a}${b}${s}`, v: 'TF' });
const pick = (s) => s[Math.floor(Math.random() * s.length)];
const partOf = (id) => (id.startsWith('m') ? 'mcq' : 'unseen');

// ---------- synthetic questions (shape only; no real content, no key/answer/correct fields) ----------
function fakeQuestions(part) {
    const items = {};
    if (part === 'mcq') {
        for (let n = 1; n <= 23; n++) {
            items['m' + pad3(n).slice(1)] = {
                no: n, type: 'sba', stem: `FAKE stem ${n}. ` + 'Lorem ipsum dolor sit amet. '.repeat(12),
                options: { A: 'FAKE A', B: 'FAKE B', C: 'FAKE C', D: 'FAKE D', E: 'FAKE E' },
            };
        }
        for (let n = 24; n <= 28; n++) {
            const statements = {};
            for (let s = 1; s <= 4; s++) statements[`m${n}s${s}`] = { no: s, text: `FAKE statement ${s}. ` + 'Lorem ipsum. '.repeat(6) };
            items['m' + n] = { no: n, type: 'mtf', stem: `FAKE stem ${n}. ` + 'Lorem ipsum dolor sit amet. '.repeat(10), statements };
        }
    } else {
        for (const a of [1, 2, 3]) {
            const statements = {};
            for (const b of ['a', 'b']) for (let s = 1; s <= 4; s++) statements[`u${a}${b}${s}`] = { text: `FAKE unseen statement. ` + 'Lorem ipsum. '.repeat(8) };
            items['u' + a] = { no: a, type: 'unseen', stem: `FAKE unseen article ${a}. ` + 'Lorem ipsum dolor sit amet. '.repeat(40), statements };
        }
    }
    return { version: 1, part, title: 'FAKE LOADTEST ' + part.toUpperCase(), items };
}

const RESET_SQL = 'DELETE FROM seats; DELETE FROM answers; DELETE FROM flags; DELETE FROM submitted; DELETE FROM control; DELETE FROM questions;';
if (cmd === 'cleanup') {
    console.log('Reset the TEST D1 (run from r1-backup-worker/; add --local for wrangler dev state, --remote for deployed staging):');
    console.log(`  npx wrangler d1 execute r1-backup --remote --command "${RESET_SQL}"`);
    console.log('Local dev state alternative: delete r1-backup-worker/.wrangler/');
    process.exit(0);
}
if (cmd !== 'run') bad(`unknown command: ${cmd}`);

if (!opt.base) bad('--base (or R1_LT_BASE) required, e.g. http://127.0.0.1:8787');
if (!opt.adminToken) bad('--admin-token (or R1_LT_ADMIN_TOKEN) required');
const isLocal = /^https?:\/\/(127\.0\.0\.1|localhost)(:|\/|$)/.test(opt.base);
if (!isLocal && !opt.confirmTestDb) bad('non-localhost base: pass --confirm-test-db to confirm this D1 is disposable (run overwrites control/questions)');

// ---------- stats ----------
const stats = new Map(); // phase -> { lat:[], ok, fail, codes:{} }
function record(op, ms, ok, code) {
    let s = stats.get(op);
    if (!s) stats.set(op, (s = { lat: [], ok: 0, fail: 0, codes: {} }));
    s.lat.push(ms);
    if (ok) s.ok++; else { s.fail++; s.codes[code] = (s.codes[code] || 0) + 1; }
}
const pct = (sorted, p) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)] : 0);

// api(op, method, path, {token, admin, body}) -> { ok, status, body }. Records latency under `op` (skipped if op is null).
async function api(op, method, path, { token, admin, body, check } = {}) {
    const headers = {};
    if (token) headers['X-Seat-Token'] = token;
    if (admin) headers.Authorization = 'Bearer ' + opt.adminToken;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const t0 = performance.now();
    let r;
    try {
        const res = await fetch(opt.base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), cache: 'no-store' });
        const text = await res.text();
        let parsed = null;
        try { parsed = JSON.parse(text); } catch { /* non-JSON */ }
        r = { ok: res.ok && (!check || check(parsed) === true), status: res.ok && check && check(parsed) !== true ? res.status + ':badbody' : res.status, body: parsed };
    } catch (e) {
        r = { ok: false, status: 'EXC:' + (e.cause?.code || e.message), body: null };
    }
    if (op) record(op, performance.now() - t0, r.ok, String(r.status));
    return r;
}

// ---------- setup: synthetic control window + questions ----------
const mode = `base=${opt.base}`;
console.error(`${mode} clients=${opt.clients} writes=${opt.writes} ramp=${opt.rampMs}ms think=${opt.thinkMin}-${opt.thinkMax}ms checkpoint=${opt.checkpointMs}ms burst=${opt.burstMs}ms`);
for (const part of ['mcq', 'unseen']) {
    const q = await api(null, 'PUT', `/api/admin/questions/${part}`, { admin: true, body: fakeQuestions(part) });
    if (!q.ok) { console.error(`ABORTED: seed questions/${part} failed (${q.status}). Wrong admin token or worker not running?`); process.exit(3); }
}
// startAt is in the SERVER clock: take server `now` from the response and compute our offset.
const startAtFor = (serverNow) => serverNow + opt.rampMs + opt.startLeadMs;
let serverOffset = 0;
{
    const probe = await api(null, 'GET', '/api/control');
    if (!probe.ok || typeof probe.body?.now !== 'number') { console.error('ABORTED: GET /api/control failed'); process.exit(3); }
    serverOffset = probe.body.now - Date.now(); // approx; fine for a load test
}
const startAt = startAtFor(Date.now() + serverOffset);
const endAt = startAt + 2 * 60 * 60 * 1000;
for (const part of ['mcq', 'unseen']) {
    const c = await api(null, 'PUT', `/api/admin/control/${part}`, { admin: true, body: { startAt, endAt } });
    if (!c.ok) { console.error(`ABORTED: seed control/${part} failed (${c.status})`); process.exit(3); }
}
const serverNow = () => Date.now() + serverOffset;

const ctlOk = (b) => typeof b?.now === 'number' && !!b.mcq && b.mcq.startAt === startAt;

// ---------- clients ----------
let waiting = opt.clients;
let release;
const barrier = new Promise((r) => { release = r; });
const arrive = () => { if (--waiting === 0) release(); };
const burstTimes = [];
const finalState = new Map(); // username -> { answers: {qid:val}, finalFailed:bool }

async function client(i) {
    await sleep((opt.rampMs * i) / opt.clients * 0.95);
    const username = seatUsername(i);
    const isLead = username.endsWith('-1');
    const mine = {};          // qid -> latest value (ground truth)
    const outbox = {};        // qid -> value, unsent
    let arrived = false;
    const done = () => { if (!arrived) { arrived = true; arrive(); } };
    let polling = null;
    try {
        const cl = await api('claim', 'POST', '/api/claim', { body: { username }, check: (b) => b?.status === 'claimed' && typeof b.token === 'string' && b.token.length > 0 });
        if (!cl.ok || cl.body?.status !== 'claimed' || !cl.body.token) return done();
        const token = cl.body.token;
        finalState.set(username, { answers: mine, finalFailed: false });

        await api('control', 'GET', '/api/control', { token, check: ctlOk });
        polling = setInterval(() => api('control', 'GET', '/api/control', { token, check: ctlOk }), opt.controlPollMs);

        // questions burst at startAt (page waits for startAt via its server clock, then fetches)
        const wait = startAt - serverNow();
        if (wait > 0) await sleep(wait + rand(0, 200));
        const parts = isLead ? ['mcq', 'unseen'] : ['mcq'];
        await Promise.all(parts.map((p) => api('questions', 'GET', `/api/questions/${p}`, { token, check: (b) => b?.part === p && b.items && Object.keys(b.items).length > 0 })));

        const flushPart = async (part, final) => {
            const answers = {};
            const sent = [];
            for (const [qid, v] of Object.entries(outbox)) if (partOf(qid) === part) { answers[qid] = v; sent.push([qid, v]); }
            if (!sent.length && !final) return true;
            const body = { username, part, answers, flags: {} };
            if (final) body.final = true;
            const r = await api(final ? 'final' : 'checkpoint', 'POST', '/api/submit', { token, body, check: (b) => b?.ok === true && Array.isArray(b.rejected) && b.rejected.length === 0 });
            if (r.ok) {
                for (const [qid, v] of sent) if (outbox[qid] === v) delete outbox[qid];
                return true;
            }
            return false;
        };
        const flushAll = async () => { for (const p of parts) await flushPart(p, false); };

        // answer writing with human-like spacing; 10 s checkpoints run alongside
        let writing = true;
        const ck = (async () => {
            await sleep(rand(0, opt.checkpointMs));
            while (writing) { await flushAll(); await sleep(opt.checkpointMs); }
        })();
        const pool = [...MCQ_IDS.slice(0, Math.max(1, opt.writes)), ...(isLead ? UNSEEN_IDS : [])];
        const answered = [];
        for (const q of pool) {
            await sleep(rand(opt.thinkMin, opt.thinkMax));
            const v = pick(q.v);
            mine[q.id] = v; outbox[q.id] = v; answered.push(q);
            if (Math.random() < 0.1) { // change of mind on an earlier question
                const r = answered[Math.floor(Math.random() * answered.length)];
                const v2 = pick(r.v); mine[r.id] = v2; outbox[r.id] = v2;
            }
        }
        writing = false;
        await ck;
        done();

        // synchronized final submit burst
        await barrier;
        await sleep(rand(0, opt.burstMs));
        burstTimes.push(Date.now());
        for (const p of parts) {
            let ok = false;
            for (let attempt = 0; attempt < 3 && !ok; attempt++) {
                ok = await flushPart(p, true);
                if (!ok) await sleep(2000);
            }
            if (!ok) finalState.get(username).finalFailed = true;
        }
    } finally {
        if (polling) clearInterval(polling);
        done();
    }
}

const wall0 = performance.now();
await Promise.all(Array.from({ length: opt.clients }, (_, i) => client(i)));
const wallMs = performance.now() - wall0;

// ---------- verification ----------
const leads = [...finalState.keys()].filter((u) => u.endsWith('-1')).length;
const stat = (await api(null, 'GET', '/api/status')).body || {};
const finalFailed = [...finalState.values()].filter((s) => s.finalFailed).length;
let mismatches = 0, sampled = 0;
{
    // Full check: every claimed client's final ground truth vs the admin tree (answers per seat).
    const tree = (await api(null, 'GET', '/api/admin/tree', { admin: true })).body || {};
    for (const [u, st] of finalState) {
        sampled++;
        const got = tree[u]?.answers || {};
        const want = st.answers;
        if (Object.keys(want).length !== Object.keys(got).length || Object.keys(want).some((q) => got[q] !== want[q])) mismatches++;
    }
}

// ---------- report ----------
const order = ['claim', 'control', 'questions', 'checkpoint', 'final'];
const rows = [...stats.entries()].sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0])).map(([op, s]) => {
    const l = s.lat.slice().sort((a, b) => a - b);
    return { op, n: l.length, ok: s.ok, fail: s.fail, p50: pct(l, 50), p90: pct(l, 90), p95: pct(l, 95), p99: pct(l, 99), max: l[l.length - 1] || 0, codes: s.codes };
});
const burstSpan = burstTimes.length ? Math.max(...burstTimes) - Math.min(...burstTimes) : 0;
const report = {
    base: opt.base, clients: opt.clients, wallSeconds: +(wallMs / 1000).toFixed(1), burstStartSpanMs: burstSpan,
    status: { claimed: stat.claimed, submittedMcq: stat.submittedMcq, submittedUnseen: stat.submittedUnseen },
    expected: { claimed: opt.clients, submittedMcq: opt.clients - finalFailed, submittedUnseen: leads },
    clientsFinalFailed: finalFailed, treeChecked: sampled, treeMismatches: mismatches, ops: rows,
};
if (opt.json) console.log(JSON.stringify(report, null, 2));
else {
    console.log(`\n${mode} clients=${opt.clients} wall=${report.wallSeconds}s burstStartSpan=${burstSpan}ms`);
    console.log('phase'.padEnd(12) + 'n'.padStart(7) + 'ok'.padStart(7) + 'fail'.padStart(6) + 'p50'.padStart(8) + 'p90'.padStart(8) + 'p95'.padStart(8) + 'p99'.padStart(8) + 'max'.padStart(8) + '  (ms)');
    for (const r of rows) {
        console.log(r.op.padEnd(12) + String(r.n).padStart(7) + String(r.ok).padStart(7) + String(r.fail).padStart(6) +
            [r.p50, r.p90, r.p95, r.p99, r.max].map((x) => String(Math.round(x)).padStart(8)).join(''));
        for (const [c, n] of Object.entries(r.codes)) console.log(`    fail ${n}x ${c}`);
    }
    console.log(`\n/api/status: claimed=${stat.claimed} submittedMcq=${stat.submittedMcq} submittedUnseen=${stat.submittedUnseen} (expected claimed=${opt.clients} mcq=${opt.clients - finalFailed} unseen=${leads})`);
    console.log(`clientsFinalFailed=${finalFailed} treeChecked=${sampled} treeMismatches=${mismatches}`);
}
const bad2 = stat.claimed !== opt.clients || stat.submittedMcq !== opt.clients - finalFailed || stat.submittedUnseen !== leads || finalFailed > 0 || mismatches > 0 || rows.some((r) => r.fail > 0);
console.log(bad2 ? '\nRESULT: FAILURES PRESENT' : '\nRESULT: no failures');
process.exit(bad2 ? 1 : 0);
