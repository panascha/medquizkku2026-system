// js/r1-backup-staff-engine.js
// Pure logic for the R1 backup exam STAFF page: upload sanitising, exam control,
// monitor rows, grading, Moodle TSV export. No DOM, no Firebase — node-testable.
// Reuses ID_RE / parseUsername from r1-backup-engine.js (same ids as rules + student page).
import { ID_RE, parseUsername } from './r1-backup-engine.js';

export const PARTS = ['mcq', 'unseen'];
export const DEFAULT_MINUTES = 45;
export const MCQ_HEADER = 'Grade/112.00';   // R1_CONFIG.MCQ_ALLOWED_RAW_MAX includes 112
export const UNSEEN_HEADER = 'Grade/8.00';  // R1_CONFIG.UNSEEN_ALLOWED_RAW_MAX includes 8
export const UNSEEN_TABS = ['From UNSEEN 1', 'From UNSEEN 2', 'From UNSEEN 3'];
export const MCQ_TAB = 'From KKUEXAM';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
    'August', 'September', 'October', 'November', 'December'];
const BANGKOK_OFFSET_MS = 7 * 3600000;

// ───────────────────────── Upload sanitising ─────────────────────────
// Whitelist rebuild: any field not listed is REFUSED (throws), so an answer key
// ("answer", "correct", "key", ...) can never be copied into RTDB.

const ALLOWED = {
    root: ['version', 'part', 'title', 'items', 'articles'],
    item: ['no', 'type', 'stem', 'imageUrl', 'options', 'statements'],
    stmt: ['no', 'text'],
    article: ['no', 'title', 'sections'],
    section: ['no', 'label', 'prompt', 'statements']
};

function onlyKeys(obj, allowed, path) {
    if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) throw new Error(`${path}: ต้องเป็น object`);
    const bad = Object.keys(obj).filter((k) => !allowed.includes(k));
    if (bad.length) throw new Error(`${path}: ปฏิเสธฟิลด์ที่ไม่อนุญาต (${bad.join(', ')}) — อาจเป็นเฉลย`);
}

const str = (v, path) => {
    if (typeof v !== 'string') throw new Error(`${path}: ต้องเป็นข้อความ`);
    return v;
};
const num = (v, path) => {
    if (typeof v !== 'number' || !isFinite(v)) throw new Error(`${path}: ต้องเป็นตัวเลข`);
    return v;
};

function cleanStatements(obj, idRe, path) {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj) || !Object.keys(obj).length) throw new Error(`${path}: ต้องมี statements`);
    const out = {};
    Object.keys(obj).forEach((id) => {
        if (!idRe.test(id)) throw new Error(`${path}.${id}: id ไม่ถูกต้อง`);
        const s = obj[id];
        onlyKeys(s, ALLOWED.stmt, `${path}.${id}`);
        out[id] = { no: num(s.no, `${path}.${id}.no`), text: str(s.text, `${path}.${id}.text`) };
    });
    return out;
}

/** Returns a clean copy safe to write to _questions/{part}. Throws Error(thai msg) on anything else. */
export function sanitizeQuestions(part, raw) {
    if (!PARTS.includes(part)) throw new Error('part ต้องเป็น mcq หรือ unseen');
    onlyKeys(raw, ALLOWED.root, 'root');
    if (raw.part !== part) throw new Error(`ไฟล์นี้เป็น part "${raw.part}" แต่เลือกอัปโหลด "${part}"`);
    const out = { version: 1, part, title: raw.title == null ? '' : str(raw.title, 'title') };
    if (part === 'mcq') {
        if (raw.articles !== undefined) throw new Error('root: ไฟล์ mcq ห้ามมี articles');
        const items = raw.items;
        if (!items || typeof items !== 'object' || !Object.keys(items).length) throw new Error('items: ว่าง');
        out.items = {};
        Object.keys(items).forEach((id) => {
            const it = items[id];
            const p = `items.${id}`;
            const isSba = ID_RE.SBA.test(id);
            const isMtf = /^m(2[4-8])$/.test(id);
            if (!isSba && !isMtf) throw new Error(`${p}: id ไม่ถูกต้อง`);
            onlyKeys(it, ALLOWED.item, p);
            if (it.type !== (isSba ? 'sba' : 'mtf')) throw new Error(`${p}.type ไม่ตรงกับ id`);
            const c = { no: num(it.no, `${p}.no`), type: it.type, stem: str(it.stem, `${p}.stem`) };
            if (it.imageUrl !== undefined && it.imageUrl !== '') {
                if (!/^https:\/\//.test(str(it.imageUrl, `${p}.imageUrl`))) throw new Error(`${p}.imageUrl: ต้องขึ้นต้น https://`);
                c.imageUrl = it.imageUrl;
            }
            if (isSba) {
                if (it.statements !== undefined) throw new Error(`${p}: SBA ห้ามมี statements`);
                const o = it.options;
                if (!o || typeof o !== 'object') throw new Error(`${p}.options: ต้องมี`);
                c.options = {};
                Object.keys(o).forEach((k) => {
                    if (!/^[A-E]$/.test(k)) throw new Error(`${p}.options.${k}: ต้องเป็น A-E`);
                    c.options[k] = str(o[k], `${p}.options.${k}`);
                });
                if (Object.keys(c.options).length < 2) throw new Error(`${p}.options: ต้องมีอย่างน้อย 2 ตัวเลือก`);
            } else {
                if (it.options !== undefined) throw new Error(`${p}: MTF ห้ามมี options`);
                c.statements = cleanStatements(it.statements, new RegExp(`^${id}s[1-4]$`), `${p}.statements`);
            }
            out.items[id] = c;
        });
    } else {
        if (raw.items !== undefined) throw new Error('root: ไฟล์ unseen ห้ามมี items');
        const arts = raw.articles;
        if (!arts || typeof arts !== 'object' || !Object.keys(arts).length) throw new Error('articles: ว่าง');
        out.articles = {};
        Object.keys(arts).forEach((aid) => {
            const a = arts[aid];
            const p = `articles.${aid}`;
            if (!/^u[1-3]$/.test(aid)) throw new Error(`${p}: id ไม่ถูกต้อง`);
            onlyKeys(a, ALLOWED.article, p);
            const ca = { no: num(a.no, `${p}.no`), title: str(a.title, `${p}.title`), sections: {} };
            const secs = a.sections;
            if (!secs || typeof secs !== 'object' || !Object.keys(secs).length) throw new Error(`${p}.sections: ว่าง`);
            Object.keys(secs).forEach((sid) => {
                const s = secs[sid];
                const sp = `${p}.sections.${sid}`;
                if (!new RegExp(`^${aid}[ab]$`).test(sid)) throw new Error(`${sp}: id ไม่ถูกต้อง`);
                onlyKeys(s, ALLOWED.section, sp);
                ca.sections[sid] = {
                    no: num(s.no, `${sp}.no`),
                    label: s.label == null ? '' : str(s.label, `${sp}.label`),
                    prompt: str(s.prompt, `${sp}.prompt`),
                    statements: cleanStatements(s.statements, new RegExp(`^${sid}[1-4]$`), `${sp}.statements`)
                };
            });
            out.articles[aid] = ca;
        });
    }
    return out;
}

// ───────────────────────── Exam control ─────────────────────────

/**
 * action: 'start' | 'extend' | 'end'. existing = {startAt,endAt}|undefined. serverNowMs = estimated server ms.
 * Returns {startAt,endAt} to write to _control/{part} (rules need endAt > startAt).
 */
export function planControl(action, existing, serverNowMs, minutes) {
    const ex = existing && typeof existing.startAt === 'number' && typeof existing.endAt === 'number' ? existing : null;
    if (action === 'start') {
        const startAt = Math.round(serverNowMs);
        return { startAt, endAt: startAt + DEFAULT_MINUTES * 60000 };
    }
    if (!ex) throw new Error('ยังไม่ได้เริ่มสอบ part นี้');
    if (action === 'extend') {
        const n = Number(minutes);
        if (!Number.isInteger(n) || n < 1 || n > 180) throw new Error('นาทีที่ขยายต้องเป็นจำนวนเต็ม 1-180');
        return { startAt: ex.startAt, endAt: ex.endAt + n * 60000 };
    }
    if (action === 'end') {
        return { startAt: ex.startAt, endAt: Math.max(Math.round(serverNowMs), ex.startAt + 1) };
    }
    throw new Error('action ไม่ถูกต้อง');
}

/** 'รอเริ่ม' | 'กำลังสอบ' | 'จบแล้ว' */
export function controlState(ctl, serverNowMs) {
    if (!ctl || typeof ctl.startAt !== 'number') return 'รอเริ่ม';
    if (serverNowMs < ctl.startAt) return 'รอเริ่ม';
    return serverNowMs <= ctl.endAt ? 'กำลังสอบ' : 'จบแล้ว';
}

// ───────────────────────── Monitor ─────────────────────────

/** Whole r1_backup_exam snapshot value → one row per username (skips `_control`/`_questions`). */
export function monitorRows(root) {
    return Object.keys(root || {})
        .filter((k) => !k.startsWith('_') && parseUsername(k))
        .sort()
        .map((username) => {
            const n = root[username] || {};
            const ans = n.answers || {};
            const sub = n.submitted || {};
            return {
                username,
                claimed: !!n.uid,
                answeredMcq: Object.keys(ans).filter((id) => ID_RE.SBA.test(id) || ID_RE.MTF_STMT.test(id)).length,
                answeredUnseen: Object.keys(ans).filter((id) => ID_RE.UNSEEN_STMT.test(id)).length,
                submittedMcq: !!sub.mcq,
                submittedUnseen: !!sub.unseen,
                blur: Number(n.blurCount) || 0
            };
        });
}

/** Release-seat write: claimedAt must go too — the rules only allow writing it while absent. */
export const RELEASE_SEAT_UPDATE = { uid: null, claimedAt: null };

// ───────────────────────── Answer key + grading ─────────────────────────

const KEY_RE = {
    mcq: { sba: ID_RE.SBA, stmt: ID_RE.MTF_STMT },
    unseen: { stmt: ID_RE.UNSEEN_STMT }
};

/**
 * Answer key file: { "key": { "m01": "C", "m24s1": "T", ..., "u1a1": "F", ... } } (or the flat map itself).
 * Must be complete: 23 SBA + 20 MTF statements (112 marks) and 24 Unseen statements (3 x 8).
 * Returns the flat map. Lives in browser memory only.
 */
export function parseAnswerKey(raw) {
    const map = raw && typeof raw === 'object' && raw.key && typeof raw.key === 'object' ? raw.key : raw;
    if (!map || typeof map !== 'object' || Array.isArray(map)) throw new Error('ไฟล์เฉลย: ต้องเป็น object { "key": {...} }');
    const out = {};
    Object.keys(map).forEach((id) => {
        const v = map[id];
        if (ID_RE.SBA.test(id)) {
            if (!/^[A-E]$/.test(v)) throw new Error(`เฉลย ${id}: ต้องเป็น A-E`);
        } else if (ID_RE.MTF_STMT.test(id) || ID_RE.UNSEEN_STMT.test(id)) {
            if (!/^[TF]$/.test(v)) throw new Error(`เฉลย ${id}: ต้องเป็น T หรือ F`);
        } else {
            throw new Error(`เฉลย: id ไม่รู้จัก "${id}"`);
        }
        out[id] = v;
    });
    const ids = Object.keys(out);
    const sba = ids.filter((i) => ID_RE.SBA.test(i)).length;
    const mtf = ids.filter((i) => ID_RE.MTF_STMT.test(i)).length;
    const uns = ids.filter((i) => ID_RE.UNSEEN_STMT.test(i)).length;
    if (sba !== 23 || mtf !== 20 || uns !== 24) {
        throw new Error(`เฉลยไม่ครบ: SBA ${sba}/23, MTF ${mtf}/20, Unseen ${uns}/24`);
    }
    return out;
}

/** MCQ marks for one student's answers: SBA = 4, MTF statement = 1 (max 112). */
export function scoreMcq(key, answers) {
    const a = answers || {};
    let score = 0;
    Object.keys(key).forEach((id) => {
        if (ID_RE.SBA.test(id)) { if (a[id] === key[id]) score += 4; }
        else if (ID_RE.MTF_STMT.test(id)) { if (a[id] === key[id]) score += 1; }
    });
    return score;
}

/** Unseen marks for article 1..3: 8 statements x 1. */
export function scoreUnseen(key, answers, article) {
    const a = answers || {};
    const re = new RegExp(`^u${article}[ab][1-4]$`);
    let score = 0;
    Object.keys(key).forEach((id) => { if (re.test(id) && a[id] === key[id]) score += 1; });
    return score;
}

// ───────────────────────── Moodle TSV ─────────────────────────

/** ms → "9 November 2025  9:51 AM" (Bangkok time, DOUBLE space before time, as Moodle prints). */
export function formatMoodleDate(ms) {
    const d = new Date(ms + BANGKOK_OFFSET_MS);
    const h24 = d.getUTCHours();
    const h = h24 % 12 || 12;
    const mm = String(d.getUTCMinutes()).padStart(2, '0');
    return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}  ${h}:${mm} ${h24 < 12 ? 'AM' : 'PM'}`;
}

/** ms → "22 mins 51 secs" / "1 hour 3 mins" / "45 secs". */
export function formatMoodleDuration(ms) {
    const total = Math.max(0, Math.round(ms / 1000));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    const parts = [];
    if (h) parts.push(`${h} ${h === 1 ? 'hour' : 'hours'}`);
    if (m) parts.push(`${m} ${m === 1 ? 'min' : 'mins'}`);
    if (s || !parts.length) parts.push(`${s} ${s === 1 ? 'sec' : 'secs'}`);
    return parts.join(' ');
}

function tsvRow(username, scoreOrNull, submittedAt, startAt, header) {
    const done = typeof submittedAt === 'number' && typeof startAt === 'number';
    return {
        username,
        line: [
            username,
            done ? 'Finished' : 'In progress',
            done ? formatMoodleDate(submittedAt) : '-',
            done ? formatMoodleDuration(submittedAt - startAt) : '-',
            scoreOrNull === null ? '-' : scoreOrNull.toFixed(2)
        ].join('\t'),
        header
    };
}

function buildTsv(header, lines) {
    return ['Username\tState\tCompleted\tTime taken\t' + header, ...lines].join('\n') + '\n';
}

/**
 * Students with a claimed seat and >=1 answer for the part get a score; claimed with none get '-'.
 * Returns { tsv, rows, notSubmitted: [username] } — notSubmitted rows export as "In progress".
 */
export function buildMcqTsv(root, key, control) {
    const startAt = control && control.mcq && control.mcq.startAt;
    const rows = monitorRows(root);
    const lines = [];
    const notSubmitted = [];
    rows.filter((r) => r.claimed).forEach((r) => {
        const n = root[r.username];
        const score = r.answeredMcq ? scoreMcq(key, n.answers) : null;
        const sub = n.submitted && n.submitted.mcq;
        if (!sub) notSubmitted.push(r.username);
        lines.push(tsvRow(r.username, score, sub, startAt, MCQ_HEADER).line);
    });
    return { tsv: buildTsv(MCQ_HEADER, lines), count: lines.length, notSubmitted };
}

/** Three TSVs (article 1..3), rows only for claimed `-1` usernames. */
export function buildUnseenTsvs(root, key, control) {
    const startAt = control && control.unseen && control.unseen.startAt;
    const rows = monitorRows(root).filter((r) => r.claimed && r.username.endsWith('-1'));
    const notSubmitted = rows.filter((r) => !r.submittedUnseen).map((r) => r.username);
    const tabs = [1, 2, 3].map((art) => {
        const lines = rows.map((r) => {
            const n = root[r.username];
            const score = r.answeredUnseen ? scoreUnseen(key, n.answers, art) : null;
            const sub = n.submitted && n.submitted.unseen;
            return tsvRow(r.username, score, sub, startAt, UNSEEN_HEADER).line;
        });
        return { tab: UNSEEN_TABS[art - 1], tsv: buildTsv(UNSEEN_HEADER, lines), count: lines.length };
    });
    return { tabs, notSubmitted };
}
