// js/r1-backup-sync.js
// Firebase side of the R1 backup exam page. Loaded only in live mode (never in ?fixture=1).
// Does NOT import js/auth.js or js/staff-guard.js (they sign out non-KKU users).
import { db, auth, ref, set, get, onValue, update, remove } from './firebase-config.js';
import { signInAnonymously, onAuthStateChanged }
    from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { serverTimestamp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js";
import { makeClock, serverNow } from './r1-backup-engine.js';

const ROOT = 'r1_backup_exam';

let username = null;
let store = null;      // { load(key, fallback), save(key, value) } injected by app
let outboxKey = null;
let outbox = {};
const inflight = new Map(); // id → promise
let clock = null;
let onDropped = () => {};

const isDenied = (e) => e && /permission[_ ]denied/i.test(String(e.code || e.message || e));

export function configure({ username: u, store: s, outboxKey: k, onDroppedWrite }) {
    username = u;
    store = s;
    outboxKey = k;
    outbox = store.load(outboxKey, {}) || {};
    if (onDroppedWrite) onDropped = onDroppedWrite;
}

/** Resolves with the anon user; rejects Error('STAFF_SESSION') on a non-anonymous (staff Google) session. */
export async function ensureAnon() {
    const user = await new Promise((resolve) => {
        const off = onAuthStateChanged(auth, (u) => { off(); resolve(u); });
    });
    if (user) {
        if (!user.isAnonymous) throw new Error('STAFF_SESSION');
        return user;
    }
    return (await signInAnonymously(auth)).user;
}

/** "claimed" | "resumed" | "taken" */
export async function claimSeat(u) {
    const uid = auth.currentUser.uid;
    const node = ref(db, `${ROOT}/${u}`);
    const snap = await get(ref(db, `${ROOT}/${u}/uid`));
    if (snap.exists()) return snap.val() === uid ? 'resumed' : 'taken';
    try {
        await update(node, { uid, claimedAt: serverTimestamp() });
        return 'claimed';
    } catch (e) {
        if (isDenied(e)) return 'taken';
        throw e;
    }
}

/** Resolves after first `.info/serverTimeOffset`; clock re-syncs on every later update. */
export function startServerClock() {
    return new Promise((resolve) => {
        onValue(ref(db, '.info/serverTimeOffset'), (s) => {
            clock = makeClock({ serverNowAtSync: Date.now() + (s.val() || 0), monoAtSync: performance.now() });
            resolve(clock);
        });
    });
}

export const getServerNow = () => serverNow(clock, performance.now());
export const getClock = () => clock;

export function watchControl(cb) {
    return onValue(ref(db, `${ROOT}/_control`), (s) => cb(s.val() || {}), () => cb({}));
}

/** Raw question JSON for a part. Retries (jittered) while rules still deny reads before startAt. */
export async function fetchQuestions(part) {
    let lastErr;
    for (let i = 0; i < 30; i++) {
        try {
            const s = await get(ref(db, `${ROOT}/_questions/${part}`));
            if (s.exists()) return s.val();
            lastErr = new Error('NO_QUESTIONS');
        } catch (e) {
            lastErr = e;
            if (!isDenied(e)) throw e;
        }
        await new Promise((r) => setTimeout(r, 500 + Math.random() * 1500 + i * 300));
    }
    throw lastErr;
}

/** Own seat node (answers, flags, blurCount, submitted) for resume merge. */
export async function loadRemote() {
    const s = await get(ref(db, `${ROOT}/${username}`));
    return s.val() || {};
}

function persistOutbox() {
    store.save(outboxKey, outbox);
}

function send(path, value) {
    const id = path + '=' + JSON.stringify(value);
    if (inflight.has(id)) return inflight.get(id);
    const target = ref(db, `${ROOT}/${username}/${path}`);
    const p = (value === null ? remove(target) : set(target, value))
        .then(() => {
            if (outbox[path] === value) { delete outbox[path]; persistOutbox(); }
        })
        .catch((e) => {
            if (isDenied(e)) { // window closed / already submitted: retrying cannot help
                if (outbox[path] === value) { delete outbox[path]; persistOutbox(); }
                onDropped(path);
            }
        })
        .finally(() => inflight.delete(id));
    inflight.set(id, p);
    return p;
}

function queue(path, value) {
    outbox[path] = value;
    persistOutbox();
    return send(path, value);
}

export const writeAnswer = (qid, value) => queue(`answers/${qid}`, value);
export const writeFlag = (itemId, on) => queue(`flags/${itemId}`, on ? true : null);
export const writeBlur = (count) => queue('blurCount', count);

export function flushOutbox() {
    return Promise.allSettled(Object.keys(outbox).map((p) => send(p, outbox[p])));
}

/** Call after configure(). Flushes on reconnect and every 5 s. */
export function startOutboxFlusher() {
    onValue(ref(db, '.info/connected'), (s) => { if (s.val() === true) flushOutbox(); });
    setInterval(flushOutbox, 5000);
}

/** Flush pending writes, then stamp submitted/{part} with server time. */
export async function submitPart(part) {
    await flushOutbox();
    await set(ref(db, `${ROOT}/${username}/submitted/${part}`), serverTimestamp());
}
