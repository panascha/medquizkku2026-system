// Spot grading engine: pure ES module. No DOM, no Firebase, no Date.now().
// QID_RE.source is mirrored in spot_grading.rules.json (test enforces).

export const TEAM_COUNT = 40;
export const QUESTION_COUNT = 35;
export const CUT = 8;
export const HEARTBEAT_MS = 20000;
export const STALE_MS = 60000;

export const QIDS = Array.from({ length: QUESTION_COUNT }, (_, i) => 'q' + String(i + 1).padStart(2, '0'));
export const QID_RE = /^q(0[1-9]|[12][0-9]|3[0-5])$/;
export const TEAM_RE = /^MQ(00[1-9]|0[1-9][0-9]|100)$/;

const isCell = (v) => v === 0 || v === 0.5 || v === 1;

// q01-q30 may score 0.5; q31-q35 are 0/1 only (academic team, 2026-10-30).
export const HALF_MAX_Q = 30;
export const halfAllowed = (qid) => {
    const m = /^q(\d{2})$/.exec(qid);
    return !!m && Number(m[1]) >= 1 && Number(m[1]) <= HALF_MAX_Q;
};

function hasTeam(teamSet, id) {
    if (teamSet instanceof Set) return teamSet.has(id);
    if (Array.isArray(teamSet)) return teamSet.includes(id);
    return !!teamSet && Object.prototype.hasOwnProperty.call(teamSet, id);
}

export function normalizeTeamId(raw, teamSet) {
    // " - ชื่อทีม" suffix = a datalist pick ("MQ043 - name")
    const m = /^(?:mq)?0*(\d{1,3})$/i.exec(String(raw).trim().replace(/\s+-\s.*$/, ''));
    if (!m) return null;
    const n = Number(m[1]);
    if (n < 1 || n > 100) return null;
    const id = 'MQ' + String(n).padStart(3, '0');
    return hasTeam(teamSet, id) ? id : null;
}

// Arm without Enter only when no further keystroke could mean another team: 2 digits 10–99
// (not "10" while MQ100 is active), 3 digits, or a datalist pick. 1 digit / "MQ1" → Enter.
// A wrong early arm is dangerous: the next typed "0"/"1" leaves the input and scores.
export function autoArmId(raw, teamSet) {
    const s = String(raw).trim();
    if (/\s+-\s/.test(s)) return normalizeTeamId(s, teamSet);
    const m = /^(?:mq)?(\d{2,3})$/i.exec(s);
    if (!m || /^0\d$/.test(m[1])) return null;
    const id = normalizeTeamId(m[1], teamSet);
    if (!id || m[1].length === 3) return id;
    for (let d = 0; d <= 9; d++) {
        const n = Number(m[1] + d);
        if (n <= 100 && hasTeam(teamSet, 'MQ' + String(n).padStart(3, '0'))) return null;
    }
    return id;
}

export function progress(scores, teams, qids = QIDS) {
    const perQuestion = {};
    const perTeam = {};
    teams.forEach((t) => { perTeam[t] = 0; });
    let done = 0;
    qids.forEach((q) => {
        let qDone = 0;
        const row = (scores && scores[q]) || {};
        teams.forEach((t) => {
            if (isCell(row[t])) { qDone++; perTeam[t]++; }
        });
        perQuestion[q] = { done: qDone, total: teams.length };
        done += qDone;
    });
    return { done, total: qids.length * teams.length, perQuestion, perTeam };
}

export function totals(scores, teams) {
    const out = {};
    if (teams) teams.forEach((t) => { out[t] = 0; });
    Object.keys(scores || {}).forEach((q) => {
        const row = scores[q] || {};
        Object.keys(row).forEach((t) => {
            if (teams && !hasTeam(teams, t)) return;
            if (!(t in out)) out[t] = 0;
            if (isCell(row[t])) out[t] += row[t];
        });
    });
    return out;
}

// 9 representative discipline items shown beside the total in the 8/9 tie view. Display only: never feeds rankWithCut/buildPushPayload.
export const TIE_SUBSET_QIDS = ['q06', 'q08', 'q11', 'q12', 'q20', 'q24', 'q26', 'q28', 'q32'];

export function subScore(scores, team, qids = TIE_SUBSET_QIDS) {
    return qids.reduce((n, q) => n + (scores && scores[q] && isCell(scores[q][team]) ? scores[q][team] : 0), 0);
}

export function rankWithCut(tot, cut = CUT) {
    const sorted = Object.keys(tot)
        .map((team) => ({ team, score: tot[team] }))
        .sort((a, b) => b.score - a.score || (a.team < b.team ? -1 : a.team > b.team ? 1 : 0));
    const ranked = sorted.map((r, i) => ({
        ...r,
        rank: i > 0 && sorted[i - 1].score === r.score ? 0 : i + 1
    }));
    ranked.forEach((r, i) => { if (r.rank === 0) r.rank = ranked[i - 1].rank; });
    let cutTies = [];
    if (ranked.length > cut && ranked[cut - 1].score === ranked[cut].score) {
        const s = ranked[cut - 1].score;
        cutTies = ranked.filter((r) => r.score === s).map((r) => r.team).sort();
    }
    return { ranked, cutTies };
}

export function laggards(prog, { minGap = 3 } = {}) {
    const qs = Object.keys(prog.perQuestion);
    if (!qs.length) return [];
    const vals = qs.map((q) => prog.perQuestion[q].done).sort((a, b) => a - b);
    const mid = vals.length >> 1;
    const median = vals.length % 2 ? vals[mid] : (vals[mid - 1] + vals[mid]) / 2;
    return qs
        .map((qid) => ({ qid, done: prog.perQuestion[qid].done, total: prog.perQuestion[qid].total, median }))
        .filter((r) => r.median - r.done >= minGap)
        .sort((a, b) => a.done - b.done || (a.qid < b.qid ? -1 : a.qid > b.qid ? 1 : 0));
}

export function buildPushPayload(tot, tieDecision, cut = CUT) {
    const teams = Object.keys(tot || {});
    if (!teams.every((t) => Number.isFinite(tot[t]) && (tot[t] * 2) % 1 === 0 && tot[t] >= 0 && tot[t] <= QUESTION_COUNT)) {
        return { ok: false, reason: 'BAD_SCORE' };
    }
    if (teams.length <= cut) return { ok: false, reason: 'TOO_FEW_TEAMS' };
    const r = rankWithCut(tot, cut);
    let passed;
    if (!r.cutTies.length) {
        passed = r.ranked.slice(0, cut).map((x) => x.team);
    } else {
        const p = tieDecision && tieDecision.passed;
        if (!p) return { ok: false, reason: 'TIE_UNRESOLVED' };
        const tieScore = r.ranked[cut - 1].score;
        if (!Array.isArray(p)) return { ok: false, reason: 'TIE_INVALID' };
        const set = new Set(p);
        const valid = Array.isArray(p) && p.length === cut && set.size === cut
            && p.every((t) => hasTeam(tot, t))
            && teams.every((t) => tot[t] <= tieScore || set.has(t))
            && Math.min(...p.map((t) => tot[t])) >= Math.max(...teams.filter((t) => !set.has(t)).map((t) => tot[t]));
        if (!valid) return { ok: false, reason: 'TIE_INVALID' };
        passed = p;
    }
    return { ok: true, payload: { scores: { ...tot }, passed: [...passed].sort() } };
}

export function lockState(grader, now) {
    if (!grader || !Number.isFinite(grader.lastActive)) return 'free';
    return now - grader.lastActive < STALE_MS ? 'held' : 'stale';
}

/** ms -> "HH:mm:ss" (local time); '-' if not a finite number. */
export function fmtClock(ms) {
    if (typeof ms !== 'number' || !Number.isFinite(ms)) return '-';
    const d = new Date(ms);
    return [d.getHours(), d.getMinutes(), d.getSeconds()].map((n) => String(n).padStart(2, '0')).join(':');
}

/** Newest-first audit rows { q, team, v, by, at } from scoreMeta joined with scores; entries without a 0/1 score or numeric `at` are skipped. */
export function recentActivity(scoreMeta, scores, limit = 50) {
    const rows = [];
    Object.keys(scoreMeta || {}).forEach((q) => {
        const m = scoreMeta[q] || {};
        Object.keys(m).forEach((team) => {
            const e = m[team];
            const v = scores && scores[q] ? scores[q][team] : undefined;
            if (e && isCell(v) && typeof e.at === 'number') rows.push({ q, team, v, by: String(e.by || ''), at: e.at });
        });
    });
    rows.sort((a, b) => b.at - a.at || (a.q + a.team < b.q + b.team ? -1 : 1));
    return rows.slice(0, limit);
}
