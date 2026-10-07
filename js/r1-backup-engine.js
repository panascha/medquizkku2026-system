// js/r1-backup-engine.js
// Pure logic for the R1 backup exam page. No DOM, no Firebase — node-testable.
// ID_RE sources must equal the regex strings in r1_backup_exam.rules.json (tests enforce this).

export const STORAGE_PREFIX = 'r1bk:v1:';

export const ID_RE = {
    SBA: /^m(0[1-9]|1[0-9]|2[01])$/,
    MTF_STMT: /^m(2[2-8])s[1-4]$/,
    UNSEEN_STMT: /^u[1-3][ab][1-4]$/,
    FLAG: /^m(0[1-9]|1[0-9]|2[0-8])$|^u[1-3][ab]$/
};

/** 'mq2026-007-2' (legacy 'mq007-2' accepted, case-insensitive) → canonical parts; null if invalid. Team 1..100. */
export function parseUsername(raw) {
    const m = String(raw || '').trim().match(/^mq(?:2026-)?0*(\d{1,3})-([123])$/i);
    if (!m) return null;
    const teamNo = Number(m[1]);
    if (teamNo < 1 || teamNo > 100) return null;
    const member = Number(m[2]);
    const pad = String(teamNo).padStart(3, '0');
    return { teamNo, teamId: 'MQ' + pad, member, username: `mq2026-${pad}-${member}` };
}

/** Only member 1 answers Part 2 (Unseen). */
export function canAnswerUnseen(member) {
    return member === 1;
}

export function storageKeys(username) {
    const p = STORAGE_PREFIX;
    const u = p + username + ':';
    return {
        session: p + 'session',
        theme: p + 'theme',
        answers: u + 'answers',
        flags: u + 'flags',
        submitted: u + 'submitted',
        blur: u + 'blur',
        outbox: u + 'outbox',
        pos: u + 'pos',
        qMcq: u + 'q:mcq',
        qUnseen: u + 'q:unseen',
        ctl: u + 'ctl'
    };
}

const byNo = (a, b) => (a.no || 0) - (b.no || 0);
const toList = (obj) => Object.keys(obj || {}).map((id) => ({ id, ...obj[id] })).sort(byNo);
const normStmts = (obj) => toList(obj).map((s) => ({ id: s.id, no: s.no, text: s.text }));

/**
 * mcq   → { items:[{id,no,type:'sba'|'mtf',stem,imageUrl,options:[{key,text}],statements:[{id,no,text}]}] }
 * unseen→ { items:[{id,no,type:'section',label,prompt,articleId,articleTitle,statements:[…]}] } (flat, article order)
 * Answer-key fields, if present, are dropped here.
 */
export function normalizeQuestions(part, raw) {
    const out = { part, title: (raw && raw.title) || '', items: [] };
    if (!raw) return out;
    if (part === 'mcq') {
        out.items = toList(raw.items).map((it) => ({
            id: it.id,
            no: it.no,
            type: it.type,
            stem: it.stem || '',
            imageUrl: it.imageUrl || '',
            options: Object.keys(it.options || {}).sort().map((k) => ({ key: k, text: it.options[k] })),
            statements: normStmts(it.statements)
        }));
    } else {
        toList(raw.articles).forEach((a) => {
            toList(a.sections).forEach((s) => {
                out.items.push({
                    id: s.id,
                    no: out.items.length + 1,
                    type: 'section',
                    label: s.label || '',
                    prompt: s.prompt || '',
                    articleId: a.id,
                    articleTitle: a.title || '',
                    options: [],
                    statements: normStmts(s.statements)
                });
            });
        });
    }
    return out;
}

/** Answer ids an item needs. */
function neededIds(item) {
    return item.type === 'sba' ? [item.id] : item.statements.map((s) => s.id);
}

/** 'answered' | 'partial' | 'unanswered' */
export function itemStatus(item, answers) {
    const ids = neededIds(item);
    const n = ids.filter((id) => answers && answers[id] != null).length;
    if (n === 0) return 'unanswered';
    return n === ids.length ? 'answered' : 'partial';
}

export function buildNavigator(part, norm, answers, flags) {
    return norm.items.map((it) => ({
        id: it.id,
        no: it.no,
        label: part === 'unseen' && it.label ? it.label : String(it.no),
        status: itemStatus(it, answers),
        flagged: !!(flags && flags[it.id])
    }));
}

/** Local wins when present. pushLocalOnly = keys whose local value is absent/different on remote. */
export function mergeAnswers(local, remote) {
    const l = local || {};
    const r = remote || {};
    const merged = { ...r, ...l };
    const pushLocalOnly = Object.keys(l).filter((k) => r[k] !== l[k]);
    return { merged, pushLocalOnly };
}

/** server time = serverNowAtSync + (monoNow − monoAtSync); immune to wall-clock changes. */
export function makeClock({ serverNowAtSync, monoAtSync }) {
    return { serverNowAtSync, monoAtSync };
}

export function serverNow(clock, monoNow) {
    return clock.serverNowAtSync + (monoNow - clock.monoAtSync);
}

export function remainingMs(endAt, clock, monoNow) {
    return endAt - serverNow(clock, monoNow);
}

/** ms → 'MM:SS' (clamped at 0; minutes may exceed 99). */
export function formatClock(ms) {
    const total = Math.max(0, Math.ceil(ms / 1000));
    const mm = String(Math.floor(total / 60)).padStart(2, '0');
    const ss = String(total % 60).padStart(2, '0');
    return `${mm}:${ss}`;
}

/**
 * Keyboard map → action or null. Enter (and anything unmapped) → null.
 * focusedStmt = 0-based statement index (MTF/section).
 * Actions: {type:'answer',qid,value} | {type:'focus',index} | {type:'flag'} | {type:'nav',dir:-1|1}
 */
export function answerFromKey(item, key, focusedStmt) {
    if (!item || typeof key !== 'string') return null;
    if (key === 'ArrowLeft') return { type: 'nav', dir: -1 };
    if (key === 'ArrowRight') return { type: 'nav', dir: 1 };
    const k = key.length === 1 ? key.toLowerCase() : key;
    if (k === 'm') return { type: 'flag' };
    if (item.type === 'sba') {
        let letter = null;
        if (/^[1-5]$/.test(k)) letter = 'ABCDE'[Number(k) - 1];
        else if (/^[a-e]$/.test(k)) letter = k.toUpperCase();
        if (!letter) return null;
        if (item.options.length && !item.options.some((o) => o.key === letter)) return null;
        return { type: 'answer', qid: item.id, value: letter };
    }
    if (/^[1-4]$/.test(k)) {
        const index = Number(k) - 1;
        return index < item.statements.length ? { type: 'focus', index } : null;
    }
    if (k === 't' || k === 'f') {
        const st = item.statements[focusedStmt];
        return st ? { type: 'answer', qid: st.id, value: k.toUpperCase() } : null;
    }
    return null;
}
