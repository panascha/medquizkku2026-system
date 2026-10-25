// js/r1-backup-api.js
// Cloudflare Worker side of the R1 backup exam page (contract: R1_BACKUP_API.md). Live mode only.
// Same exports as the retired Firebase module r1-backup-sync.js (removed in #27). No Firebase, no Google auth:
// the seat is guarded by a random token kept in the app's session key.
import { API_BASE } from './r1-backup-config.js';
import { makeClock } from './r1-backup-engine.js';

const CONTROL_POLL_MS = 60000;
const CHECKPOINT_MS = 10000;

let username = null;
let store = null;      // { load(key, fallback), save(key, value) } injected by app
let outboxKey = null;
let outbox = {};       // 'answers/<qid>' → value|null, 'flags/<id>' → true|null, 'blurCount' → n, 'final/<part>' → 1
let token = null;
let clock = null;
let onDropped = () => {};
let flushing = null;

const partOf = (id) => (/^m/.test(id) ? 'mcq' : 'unseen');

export function configure({ username: u, store: s, outboxKey: k, onDroppedWrite }) {
    username = u;
    store = s;
    outboxKey = k;
    outbox = store.load(outboxKey, {}) || {};
    if (onDroppedWrite) onDropped = onDroppedWrite;
}

/** Seat token (null before a claim). The app keeps it in its session key and passes it back on resume. */
export const getToken = () => token;
export const setToken = (t) => { token = t || null; };

/** Kept for export parity with the retired r1-backup-sync.js; there is no anonymous auth on this path. */
export async function ensureAnon() { return {}; }

function syncClock(body, t0, t1) {
    if (!body || typeof body.now !== 'number') return;
    const next = makeClock({ serverNowAtSync: body.now + (t1 - t0) / 2, monoAtSync: t1 });
    if (clock) Object.assign(clock, next); // app holds this object: mutate so every later response re-syncs it
    else clock = next;
}

/** → { status, body } ; throws on network failure. */
async function call(path, { method = 'GET', headers = {}, body } = {}) {
    const h = { ...headers };
    if (token) h['X-Seat-Token'] = token;
    if (body !== undefined) h['Content-Type'] = 'application/json';
    const t0 = performance.now();
    const res = await fetch(API_BASE + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body), cache: 'no-store' });
    const t1 = performance.now();
    let parsed = null;
    try { parsed = await res.json(); } catch (e) { /* non-JSON */ }
    syncClock(parsed, t0, t1);
    return { status: res.status, body: parsed };
}

/** "claimed" | "resumed" | "taken" */
export async function claimSeat(u) {
    const { status, body } = await call('/api/claim', { method: 'POST', body: { username: u } });
    if (status === 409) return 'taken';
    if (status === 200 && body && body.status === 'claimed' && body.token) { token = body.token; return 'claimed'; }
    if (status === 200 && body && body.status === 'resumed') return 'resumed';
    throw new Error('CLAIM_' + status);
}

/** Resolves after the first successful /api/control (retries while offline); later responses re-sync the clock. */
export async function startServerClock() {
    for (;;) {
        try {
            const { status } = await call('/api/control');
            if (status === 200 && clock) return clock;
        } catch (e) { /* retry */ }
        await new Promise((r) => setTimeout(r, 2000));
    }
}

export const getServerNow = () => clock.serverNowAtSync + (performance.now() - clock.monoAtSync);
export const getClock = () => clock;

/** Polls /api/control every 60 s; cb gets {mcq:{startAt,endAt}?, unseen:{…}?}. A failed poll keeps the last value. Returns stop(). */
export function watchControl(cb) {
    const poll = async () => {
        try {
            const { status, body } = await call('/api/control');
            if (status === 200 && body) { const { now, ...ctl } = body; cb(ctl); }
        } catch (e) { /* offline: keep last control */ }
    };
    poll();
    const id = setInterval(poll, CONTROL_POLL_MS);
    return () => clearInterval(id);
}

/** Raw question JSON for a part. Retries (jittered) while the part is not open yet (403) or not uploaded (404). */
export async function fetchQuestions(part) {
    let lastErr;
    for (let i = 0; i < 30; i++) {
        try {
            const { status, body } = await call('/api/questions/' + encodeURIComponent(part));
            if (status === 200 && body) return body;
            lastErr = new Error(status === 404 ? 'NO_QUESTIONS' : 'FORBIDDEN');
            if (status !== 403 && status !== 404) throw new Error('HTTP_' + status);
        } catch (e) {
            lastErr = e;
            if (/^HTTP_/.test(e && e.message)) throw e;
        }
        await new Promise((r) => setTimeout(r, 500 + Math.random() * 1500 + i * 300));
    }
    throw lastErr;
}

/** Own seat (answers, flags, blurCount, submitted) for resume merge. */
export async function loadRemote() {
    const { status, body } = await call('/api/seat?username=' + encodeURIComponent(username));
    if (status !== 200 || !body) throw new Error('SEAT_' + status);
    const { now, ...seat } = body;
    return seat;
}

function persistOutbox() {
    store.save(outboxKey, outbox);
}

function queue(path, value) {
    outbox[path] = value;
    persistOutbox();
    return Promise.resolve(); // sent by the next checkpoint
}

export const writeAnswer = (qid, value) => queue(`answers/${qid}`, value);
export const writeFlag = (itemId, on) => queue(`flags/${itemId}`, on ? true : null);
export const writeBlur = (count) => queue('blurCount', count);

async function flushOnce() {
    const snap = { ...outbox };
    const parts = {};
    const slot = (p) => (parts[p] = parts[p] || { answers: {}, flags: {}, final: false });
    Object.keys(snap).forEach((path) => {
        const [kind, id] = path.split('/');
        if (kind === 'answers') slot(partOf(id)).answers[id] = snap[path];
        else if (kind === 'flags') slot(partOf(id)).flags[id] = snap[path] === true;
        else if (kind === 'final') slot(id).final = true;
    });
    const blurPending = Object.prototype.hasOwnProperty.call(snap, 'blurCount');
    if (blurPending && !Object.keys(parts).length) slot('mcq');

    const done = (path) => { if (outbox[path] === snap[path]) delete outbox[path]; };
    let blurSent = false;
    for (const part of Object.keys(parts)) {
        const d = parts[part];
        const body = { username, part, answers: d.answers, flags: d.flags };
        if (blurPending && !blurSent) body.blurCount = snap.blurCount;
        if (d.final) body.final = true;
        let r;
        try { r = await call('/api/submit', { method: 'POST', body }); } catch (e) { continue; } // offline: retry next tick
        if (r.status === 200 && r.body && r.body.ok) {
            const rejected = new Set(r.body.rejected || []);
            Object.keys(d.answers).forEach((id) => { done(`answers/${id}`); if (rejected.has(id)) onDropped(`answers/${id}`); });
            Object.keys(d.flags).forEach((id) => { done(`flags/${id}`); if (rejected.has(id)) onDropped(`flags/${id}`); });
            if (d.final) done(`final/${part}`);
            if (body.blurCount !== undefined) { done('blurCount'); blurSent = true; }
        } else if (r.status === 403 && r.body && r.body.status === 'not_open') {
            // final refused: window closed / not open; retrying cannot help
            if (d.final) { done(`final/${part}`); onDropped(`final/${part}`); }
            Object.keys(d.answers).forEach((id) => done(`answers/${id}`));
            Object.keys(d.flags).forEach((id) => done(`flags/${id}`));
        }
        // 401/403 seat errors, 5xx: keep in outbox, retried
    }
    persistOutbox();
}

/** One /api/submit delta per part, never overlapping. */
export function flushOutbox() {
    if (!flushing) flushing = flushOnce().finally(() => { flushing = null; });
    return flushing;
}

/** Call after configure(). Checkpoint every 10 s and on the browser `online` event. */
export function startOutboxFlusher() {
    if (typeof window !== 'undefined' && window.addEventListener) window.addEventListener('online', flushOutbox);
    setInterval(flushOutbox, CHECKPOINT_MS);
}

/** Queue the final flag, then flush. Server stamps submitted/{part}; if offline the flusher retries. */
export async function submitPart(part) {
    outbox[`final/${part}`] = 1;
    persistOutbox();
    if (flushing) await flushing; // let an in-flight checkpoint finish so this flush carries the final
    await flushOutbox();
}
