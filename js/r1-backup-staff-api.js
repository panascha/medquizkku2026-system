// js/r1-backup-staff-api.js
// Cloudflare Worker side of the R1 backup STAFF page (contract: R1_BACKUP_API.md). Live mode only.
// Same exports as the retired Firebase module r1-backup-staff-sync.js (removed in #27) plus admin-token, image and export helpers.
// No Firebase, no requireStaff: every call carries the admin token typed by staff (kept in sessionStorage).
import { API_BASE } from './r1-backup-config.js';

const TOKEN_KEY = 'r1bk:admin-token';
const POLL_MS = 5000;

let offset = 0; // serverNow - Date.now(), refreshed from the `now` of every response
let token = null;

try { token = sessionStorage.getItem(TOKEN_KEY); } catch (e) { /* storage blocked */ }

export const getAdminToken = () => token;
export function setAdminToken(t) {
    token = t || null;
    try { token ? sessionStorage.setItem(TOKEN_KEY, token) : sessionStorage.removeItem(TOKEN_KEY); } catch (e) { /* ignore */ }
}

/** Fetch with Bearer; syncs the server clock from `now`; throws Error (err.status set) on non-2xx. */
async function adminFetch(path, { method = 'GET', headers = {}, body, raw } = {}) {
    const h = { ...headers, Authorization: `Bearer ${token || ''}` };
    const t0 = Date.now();
    const res = await fetch(API_BASE + path, { method, headers: h, body, cache: 'no-store' });
    if (raw && res.ok) return res;
    let parsed = null;
    try { parsed = await res.json(); } catch (e) { /* non-JSON */ }
    if (parsed && typeof parsed.now === 'number') offset = parsed.now + (Date.now() - t0) / 2 - Date.now();
    if (!res.ok) {
        const err = new Error(res.status === 401 ? 'admin token ไม่ถูกต้อง' : (parsed && (parsed.error || parsed.status)) || `HTTP ${res.status}`);
        err.status = res.status;
        throw err;
    }
    return parsed;
}

const sendJson = (method, path, value) =>
    adminFetch(path, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) });

/** Tree from the worker → the RTDB shape the engine expects (monitorRows reads `uid` for "claimed"). */
function toRoot(tree) {
    const root = {};
    Object.keys(tree || {}).forEach((k) => {
        if (k === 'now') return;
        const n = tree[k];
        if (k.startsWith('_') || !n || typeof n !== 'object') { root[k] = n; return; }
        const { claimed, ...rest } = n;
        root[k] = claimed ? { ...rest, uid: true } : rest;
    });
    return root;
}

const localQuestions = {}; // parts uploaded in this page session (worker has no read-back for staff)

async function fetchRoot() {
    const root = toRoot(await adminFetch('/api/admin/tree'));
    if (Object.keys(localQuestions).length) root._questions = { ...localQuestions };
    return root;
}

/** Throws (status 401 on a wrong token). Resolves once the clock is synced. */
export async function verifyToken() { await fetchRoot(); }

export async function startServerClock() { await fetchRoot(); }

export const getServerNow = () => Date.now() + offset;

/** cb(root) now and every 5 s; returns a stop function. A failed poll calls onError and keeps polling. */
export function watchRoot(cb, onError) {
    let stopped = false;
    let timer = null;
    const tick = async () => {
        try {
            const root = await fetchRoot();
            if (!stopped) cb(root);
        } catch (e) {
            if (!stopped && onError) onError(e);
        }
        if (!stopped) timer = setTimeout(tick, POLL_MS);
    };
    tick();
    return () => { stopped = true; clearTimeout(timer); };
}

export async function readControl(part) {
    const root = await fetchRoot();
    return (root._control || {})[part] || null;
}
export const writeControl = (part, ctl) => sendJson('PUT', `/api/admin/control/${encodeURIComponent(part)}`, ctl);
export async function writeQuestions(part, clean) {
    await sendJson('PUT', `/api/admin/questions/${encodeURIComponent(part)}`, clean);
    localQuestions[part] = true;
}
export const releaseSeat = (username) => adminFetch(`/api/admin/release/${encodeURIComponent(username)}`, { method: 'POST' });

/** PNG/JPEG <= 1 MB; the question JSON references it as `${API_BASE}/api/img/<name>`. */
export const uploadImage = (part, name, file) =>
    adminFetch(`/api/admin/img/${encodeURIComponent(name)}?part=${encodeURIComponent(part)}`, {
        method: 'PUT', headers: { 'Content-Type': file.type }, body: file
    });

export const imageUrl = (name) => `${API_BASE}/api/img/${encodeURIComponent(name)}`;

/** Raw, ungraded export JSON text (attachment r1-backup-export.json). */
export async function fetchExportText() {
    return (await adminFetch('/api/export', { raw: true })).text();
}
