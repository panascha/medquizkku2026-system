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

const isCell = (v) => v === 0 || v === 1;

function hasTeam(teamSet, id) {
    if (teamSet instanceof Set) return teamSet.has(id);
    if (Array.isArray(teamSet)) return teamSet.includes(id);
    return !!teamSet && Object.prototype.hasOwnProperty.call(teamSet, id);
}

export function normalizeTeamId(raw, teamSet) {
    const m = /^(?:mq)?0*(\d{1,3})$/i.exec(String(raw).trim());
    if (!m) return null;
    const n = Number(m[1]);
    if (n < 1 || n > 100) return null;
    const id = 'MQ' + String(n).padStart(3, '0');
    return hasTeam(teamSet, id) ? id : null;
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
            if (row[t] === 1) out[t]++;
        });
    });
    return out;
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
    if (!teams.every((t) => Number.isInteger(tot[t]) && tot[t] >= 0 && tot[t] <= QUESTION_COUNT)) {
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
