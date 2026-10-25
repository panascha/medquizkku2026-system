// Pure rules ported from the retired RTDB rules (r1_backup_exam.rules.json, removed in #27). No I/O, no Date.now: `now` is passed in.

export const USERNAME_RE = /^mq2026-(00[1-9]|0[1-9][0-9]|100)-[123]$/;
const SBA_RE = /^m(0[1-9]|1[0-9]|2[0-3])$/;
const MTF_RE = /^m(2[4-8])s[1-4]$/;
const UNSEEN_Q_RE = /^u[1-3][ab][1-4]$/;
const MCQ_FLAG_RE = /^m(0[1-9]|1[0-9]|2[0-8])$/;
const UNSEEN_FLAG_RE = /^u[1-3][ab]$/;
const IMG_NAME_RE = /^[A-Za-z0-9._-]{1,80}$/;

export const MAX_IMG = 1048576;
export const MAX_BLUR = 100000;
export const PARTS = ['mcq', 'unseen'];

export const isValidUsername = (u) => typeof u === 'string' && USERNAME_RE.test(u);
export const isUnseenSeat = (u) => isValidUsername(u) && u.endsWith('-1');
export const isPart = (p) => p === 'mcq' || p === 'unseen';

export function partOfQid(id) {
  if (typeof id !== 'string') return null;
  if (SBA_RE.test(id) || MTF_RE.test(id)) return 'mcq';
  if (UNSEEN_Q_RE.test(id)) return 'unseen';
  return null;
}

export function partOfFlag(id) {
  if (typeof id !== 'string') return null;
  if (MCQ_FLAG_RE.test(id)) return 'mcq';
  if (UNSEEN_FLAG_RE.test(id)) return 'unseen';
  return null;
}

export const validateFlagId = (id) => partOfFlag(id) !== null;

// -> { ok:true, delete:true } | { ok:true, value } | { ok:false }
export function validateAnswer(qid, val) {
  const part = partOfQid(qid);
  if (!part) return { ok: false };
  if (val === null) return { ok: true, delete: true };
  if (typeof val !== 'string') return { ok: false };
  if (SBA_RE.test(qid)) return /^[A-E]$/.test(val) ? { ok: true, value: val } : { ok: false };
  return /^[TF]$/.test(val) ? { ok: true, value: val } : { ok: false };
}

const num = (x) => typeof x === 'number' && Number.isFinite(x);

// ctl: { startAt, endAt } for the part, or undefined.
export function inWindow(ctl, now, grace = 0) {
  if (!ctl || !num(ctl.startAt) || !num(ctl.endAt)) return false;
  return now >= ctl.startAt && now <= ctl.endAt + grace;
}

const seatAllowsPart = (part, username) =>
  isPart(part) && isValidUsername(username) && (part !== 'unseen' || isUnseenSeat(username));

// Non-final writes (answers/flags): in window (+grace) and part not submitted.
export function canWrite({ part, username, ctl, now, grace = 0, submitted = false }) {
  return seatAllowsPart(part, username) && !submitted && inWindow(ctl, now, grace);
}

// Final submit: only needs now >= startAt and not already submitted (rules.json submitted/$part).
export function canFinalSubmit({ part, username, ctl, now, submitted = false }) {
  return seatAllowsPart(part, username) && !submitted && !!ctl && num(ctl.startAt) && now >= ctl.startAt;
}

// blurCount: integer, 0..100000, non-decreasing. Caller ignores (not errors) when false.
export function validBlur(prev, next) {
  const p = num(prev) ? prev : 0;
  return Number.isInteger(next) && next >= p && next <= MAX_BLUR;
}

const FORBIDDEN_KEYS = new Set(['key', 'answer', 'correct']);

// Returns { ok:true } or { ok:false, path } for the first forbidden key (any depth, arrays too).
export function sanitizeQuestions(obj) {
  const walk = (v, path) => {
    if (Array.isArray(v)) {
      for (let i = 0; i < v.length; i++) {
        const r = walk(v[i], `${path}[${i}]`);
        if (r) return r;
      }
    } else if (v && typeof v === 'object') {
      for (const k of Object.keys(v)) {
        if (FORBIDDEN_KEYS.has(k.toLowerCase())) return `${path}.${k}`;
        const r = walk(v[k], `${path}.${k}`);
        if (r) return r;
      }
    }
    return null;
  };
  const bad = walk(obj, '$');
  return bad ? { ok: false, path: bad } : { ok: true };
}

export const isImageName = (n) => typeof n === 'string' && IMG_NAME_RE.test(n);
export const isImageMime = (m) => {
  if (typeof m !== 'string') return false;
  const base = m.split(';')[0].trim().toLowerCase();
  return base === 'image/png' || base === 'image/jpeg';
};

export async function sha256Hex(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
