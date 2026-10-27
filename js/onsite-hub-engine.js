// js/onsite-hub-engine.js
// Pure parse / validate / display helpers for pages/onsite-hub.html. No DOM, no network.
// NOT a scoring engine: GAS (OnSite Code.js) is the only scoring authority. Scaled values here
// are display-only previews of what the server will compute (published max / Grade-NN).
// Design: Idea/active/onsite-hub-design.md. Backend contract: OnSite Code.js doPost HUB map.

export const PUBLISHED = { mcq: 28, unseen: 6 };            // per exam / per Unseen article
export const UNSEEN_ARTICLES = 3;                           // 3 x 6 = 18
// Fallback only; the live page overrides with hubStatus.allowedRawMax (server is authority).
export const DEFAULT_ALLOWED = { mcq: [28, 112], unseen: [6, 8, 24] };

const USERNAME_RE = /^mq(?:2026-)?0*(\d{1,3})-([123])$/i;   // same as OnSite _parseUsername

/** CSV/TSV text -> string[][]. Delimiter auto-detected from the first line (tab wins if present). */
export function parseDelimited(text) {
    let s = String(text == null ? '' : text);
    if (s.charCodeAt(0) === 0xFEFF) s = s.slice(1);
    const firstLine = s.split(/\r\n|\n|\r/, 1)[0] || '';
    const delim = firstLine.includes('\t') ? '\t' : ',';
    const rows = [];
    let row = [], cell = '', inQ = false;
    for (let i = 0; i < s.length; i++) {
        const c = s[i];
        if (inQ) {
            if (c === '"') {
                if (s[i + 1] === '"') { cell += '"'; i++; } else inQ = false;
            } else cell += c;
        } else if (c === '"' && cell === '') {
            inQ = true;
        } else if (c === delim) {
            row.push(cell); cell = '';
        } else if (c === '\n' || c === '\r') {
            if (c === '\r' && s[i + 1] === '\n') i++;
            row.push(cell); cell = '';
            rows.push(row); row = [];
        } else cell += c;
    }
    if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
    // drop fully blank rows (trailing newline, spacer lines)
    return rows.filter(r => r.some(c => String(c).trim() !== ''));
}

/**
 * Header + row sanity for one Moodle grade export. kind: 'mcq' | 'unseen'.
 * Returns { ok, errors[], warnings[], rawMax, factor, publishedMax, dataRows, teams, duplicates[],
 *           unmatched[], badGrades[], blankGrades, scaledMax }.
 * ok=false means the server would refuse (or the file is unusable); the UI must block ingest.
 */
export function analyzeExport(grid, kind, allowed = DEFAULT_ALLOWED) {
    const out = {
        ok: false, errors: [], warnings: [], rawMax: null, factor: null,
        publishedMax: PUBLISHED[kind], dataRows: 0, teams: 0,
        duplicates: [], unmatched: [], badGrades: [], blankGrades: 0, scaledMax: null,
    };
    if (!Array.isArray(grid) || grid.length < 2) {
        out.errors.push('ไม่มีข้อมูล (ต้องมีหัวตาราง + อย่างน้อย 1 แถว)');
        return out;
    }
    const header = grid[0].map(h => String(h).trim());
    const iUser = header.indexOf('Username');
    const iGrade = header.findIndex(h => /^Grade\/[\d.]+$/.test(h));
    if (iUser < 0) out.errors.push('ไม่พบคอลัมน์ "Username" ในแถวหัวตาราง');
    if (iGrade < 0) out.errors.push('ไม่พบคอลัมน์ "Grade/NN.00" ในแถวหัวตาราง');
    if (header.indexOf('Completed') < 0) out.warnings.push('ไม่พบคอลัมน์ "Completed" — ไม่มีเวลาส่ง (เสมอกันจะตัดสินด้วยลำดับในชีท)');
    if (out.errors.length) return out;

    out.rawMax = Number(header[iGrade].split('/')[1]);
    if (!out.rawMax) { out.errors.push(`อ่านคะแนนเต็มจาก "${header[iGrade]}" ไม่ได้`); return out; }
    const okMax = (allowed && allowed[kind]) || DEFAULT_ALLOWED[kind];
    if (okMax.indexOf(out.rawMax) < 0) {
        out.errors.push(`คะแนนเต็ม ${out.rawMax} ไม่อยู่ในที่รองรับ (${okMax.join(' หรือ ')}) — server จะปฏิเสธ`);
    }
    out.factor = out.publishedMax / out.rawMax;
    out.scaledMax = out.publishedMax;

    const seen = new Set(), teams = new Set();
    for (let i = 1; i < grid.length; i++) {
        const u = String(grid[i][iUser] == null ? '' : grid[i][iUser]).trim();
        if (!u) continue;
        const m = u.match(USERNAME_RE);
        if (!m) { out.unmatched.push(u); continue; }   // e.g. Moodle "Overall average" row
        const key = `${Number(m[1])}-${m[2]}`;
        if (seen.has(key)) out.duplicates.push(u); else seen.add(key);
        teams.add(Number(m[1]));
        out.dataRows++;
        const g = grid[i][iGrade];
        if (g === '' || g === '-' || g === null || g === undefined) { out.blankGrades++; continue; }
        if (isNaN(Number(g))) out.badGrades.push(u);
    }
    out.teams = teams.size;
    if (!out.dataRows) out.errors.push('ไม่พบแถว Username รูปแบบ mq2026-NNN-M');
    if (out.badGrades.length) out.errors.push(`คะแนนไม่ใช่ตัวเลข: ${out.badGrades.slice(0, 5).join(', ')}`);
    if (out.duplicates.length) out.warnings.push(`Username ซ้ำ ${out.duplicates.length} แถว (server ใช้แถวแรก)`);
    if (out.blankGrades) out.warnings.push(`คะแนนว่าง ${out.blankGrades} แถว (นับเป็นไม่มีคะแนน)`);
    out.ok = out.errors.length === 0;
    return out;
}

/** Chip text for one analysed input. */
export function chipText(a, kind) {
    if (!a) return 'ยังไม่ได้ใส่ข้อมูล';
    if (!a.ok) return '✗ ' + a.errors[0];
    const note = kind === 'unseen' ? ' ต่อบทความ (รวม 3 บทความ /18)' : ' (MCQ/MTF)';
    return `✓ ${a.dataRows} แถว · ${a.teams} ทีม · Grade/${a.rawMax} → /${a.publishedMax}${note} ×${round(a.factor)}`;
}

const round = (n) => Math.round(n * 10000) / 10000;

/**
 * Build the r1Ingest payload. Server needs all 3 Unseen grids or none.
 * inputs = { mcq: grid|null, unseen: [grid|null x3] }. Throws if nothing sendable / partial Unseen / invalid.
 */
export function buildIngestPayload(inputs, allowed = DEFAULT_ALLOWED, allowAfterDecide = false) {
    const p = {};
    if (inputs.mcq) {
        const a = analyzeExport(inputs.mcq, 'mcq', allowed);
        if (!a.ok) throw new Error('MCQ: ' + a.errors[0]);
        p.mcq = inputs.mcq;
    }
    const u = inputs.unseen || [];
    const have = u.filter(Boolean).length;
    if (have) {
        if (have !== UNSEEN_ARTICLES) throw new Error(`Unseen ต้องใส่ครบ ${UNSEEN_ARTICLES} บทความ (ตอนนี้ ${have})`);
        u.forEach((g, i) => {
            const a = analyzeExport(g, 'unseen', allowed);
            if (!a.ok) throw new Error(`Unseen ${i + 1}: ${a.errors[0]}`);
        });
        p.unseen = u;
    }
    if (!p.mcq && !p.unseen) throw new Error('ยังไม่มีข้อมูลที่จะส่ง');
    if (allowAfterDecide) p.allowAfterDecide = true;
    return p;
}

/** Server error message -> { code, text } for the UI. Codes come from message prefixes (doPost sends message only). */
export function classifyError(message) {
    const m = String(message || '');
    const table = [
        ['PREVIEW_REQUIRED', 'ต้องกดพรีวิวก่อนตัดสิน'],
        ['INVALID_PREVIEW_TOKEN', 'ข้อมูลเปลี่ยนหลังพรีวิว — กดพรีวิวใหม่'],
        ['unauthorized', 'ไม่มีสิทธิ์ (ต้องอยู่ใน ONSITE_ADMINS)'],
        ['exists', 'มีเวลาเริ่มหมุนฐานแล้ว'],
        ['r2_started', 'มีคะแนน R2 แล้ว — รีเซ็ตรอบ 1 ไม่ได้'],
        ['invalid', 'ข้อมูลไม่ถูกต้อง'],
    ];
    for (const [code, text] of table) if (m.startsWith(code)) return { code, text, message: m };
    if (/\d+ ทีม \(ต้องการ ≥ 50\)/.test(m)) return { code: 'NOT_READY', text: 'คะแนนยังไม่ครบ (< 50 ทีม)', message: m };
    return { code: 'ERROR', text: m, message: m };
}

/**
 * Display model for the pre-flight table from an r1Preview response.
 * Server stays authority; this only formats and derives a checklist.
 */
export function preflightRows(pv, passCount = 40) {
    const cut = pv.cutoff;
    const noShows = pv.unscoredTeams || [];
    const rows = [
        { key: 'scored', label: 'ทีมที่มีคะแนน', value: `${pv.scoredCount}/100`, level: pv.ready ? 'ok' : 'bad' },
        { key: 'cutoff', label: `คะแนนตัดอันดับ ${passCount}`, value: cut ? `${cut.total} (${cut.teamId})` : '—', level: cut ? 'ok' : 'bad' },
        { key: 'ties', label: 'เสมอคร่อมอันดับตัด', value: pv.straddleTie ? 'มี — ตัดด้วย Unseen แล้วเวลาส่ง' : 'ไม่มี', level: pv.straddleTie ? 'warn' : 'ok' },
        { key: 'blind', label: 'เสมอแบบไม่มีเวลาส่ง', value: (pv.blindTies || []).length ? pv.blindTies.join(', ') : 'ไม่มี', level: (pv.blindTies || []).length ? 'warn' : 'ok' },
        { key: 'noshow', label: 'ไม่มีคะแนน (no-show)', value: noShows.length ? `${noShows.length} ทีม` : 'ไม่มี', level: noShows.length ? 'warn' : 'ok' },
    ];
    return rows;
}

/**
 * Decide gate (client mirror of the server rule): decide is allowed only with a preview taken
 * after the latest ingest/reset and the server said ready. Server still re-checks token.
 * state = { previewToken, previewReady, previewStale }
 */
export function canDecide(state) {
    const s = state || {};
    return !!(s.previewToken && s.previewReady && !s.previewStale);
}
