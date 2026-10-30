// js/spot-dashboard-fixture.js
// FAKE data for pages/spot-dashboard.html?fixture=1. Not real teams, not a real key.
// Scores are built so the 8/9 cut is a 3-way tie (teams idx 7,8,9 all on 20).
import { QIDS } from './spot-grading-engine.js';
import { buildFixtureDb, FIXTURE_TEAM_IDS } from './spot-grading-fixture.js';

export { FIXTURE_ME } from './spot-grading-fixture.js';

// target score per team index: 0..6 distinct, 7..9 tie at 20, rest descending below
export const FIXTURE_TARGETS = FIXTURE_TEAM_IDS.map((_, i) => (i < 7 ? 30 - i : i < 10 ? 20 : 19 - (i - 10) / 2 | 0));

/** complete=false leaves the last 5 teams of q35 ungraded (their target there is 0 anyway). */
export function buildDashboardFixtureDb(now, { complete = false } = {}) {
    const db = buildFixtureDb(now);
    db.graders = {};
    db.admins = {};
    db.scores = {};
    db.scoreMeta = {};
    const graderEmails = ['grader.a@kku.ac.th', 'grader.b@kku.ac.th', 'grader.c@kku.ac.th'];
    QIDS.forEach((q, qi) => {
        db.scores[q] = {};
        db.scoreMeta[q] = {};
        FIXTURE_TEAM_IDS.forEach((t, ti) => {
            if (!complete && qi === QIDS.length - 1 && ti >= FIXTURE_TEAM_IDS.length - 5) return;
            db.scores[q][t] = qi < FIXTURE_TARGETS[ti] ? 1 : 0;
            // half-point demo: two 0.5s swap a 1 and a 0 (q01..q30 only), so team totals stay on target
            if (ti >= 12 && ti % 4 === 0 && (qi === 0 || qi === FIXTURE_TARGETS[ti])) db.scores[q][t] = 0.5;
            // one grading action every 2s, later questions newer; ends ~1 min before `now`
            db.scoreMeta[q][t] = { by: graderEmails[qi % graderEmails.length], at: now - 60000 - (QIDS.length * FIXTURE_TEAM_IDS.length - (qi * FIXTURE_TEAM_IDS.length + ti)) * 2000 };
        });
    });
    return db;
}

/** Fake OnSite getAllOnSiteTeams result: 40 passed + 5 not passed. */
export function fixtureOnSiteTeams() {
    const rows = FIXTURE_TEAM_IDS.map((t, i) => ({ teamId: t, teamName: 'ทีมทดสอบ ' + (i + 1), r1Passed: true }));
    ['MQ090', 'MQ091', 'MQ092', 'MQ093', 'MQ094'].forEach((t) => rows.push({ teamId: t, teamName: 'ทีมตกรอบ', r1Passed: false }));
    return rows;
}

/** Fake question upload (35 entries, FIXTURE content). */
export function fixtureQuestionsJson() {
    const { questions } = buildFixtureDb(0);
    return { questions };
}
