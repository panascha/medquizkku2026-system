import test from 'node:test';
import assert from 'node:assert/strict';
import { progress, totals, rankWithCut, buildPushPayload, CUT, recentActivity, fmtClock } from '../js/spot-grading-engine.js';
import { buildDashboardFixtureDb, fixtureOnSiteTeams, fixtureQuestionsJson } from '../js/spot-dashboard-fixture.js';

const ids = (db) => Object.keys(db.teams).sort();

test('incomplete fixture: 1395/1400, push blocked by gate input', () => {
    const db = buildDashboardFixtureDb(0);
    const p = progress(db.scores, ids(db));
    assert.equal(p.total, 1400);
    assert.equal(p.done, 1395);
});

test('complete fixture: 1400/1400 and 3-way tie across 8/9 cut', () => {
    const db = buildDashboardFixtureDb(0, { complete: true });
    const t = ids(db);
    assert.equal(progress(db.scores, t).done, 1400);
    const tot = totals(db.scores, t);
    const { cutTies } = rankWithCut(tot, CUT);
    assert.equal(cutTies.length, 3);
    assert.equal(buildPushPayload(tot, null).reason, 'TIE_UNRESOLVED');
});

test('tieDecision with 7 sure + 1 tied team resolves push; 2 tied teams rejected', () => {
    const db = buildDashboardFixtureDb(0, { complete: true });
    const t = ids(db);
    const tot = totals(db.scores, t);
    const { ranked, cutTies } = rankWithCut(tot, CUT);
    const sure = ranked.filter((r) => r.score > tot[cutTies[0]]).map((r) => r.team);
    assert.equal(sure.length, 7);
    const ok = buildPushPayload(tot, { passed: [...sure, cutTies[0]] });
    assert.equal(ok.ok, true);
    assert.equal(ok.payload.passed.length, 8);
    const bad = buildPushPayload(tot, { passed: [...sure.slice(0, 6), cutTies[0], cutTies[1]] });
    assert.equal(bad.ok, false);
});

test('fixture scoreMeta: one audit row per graded cell; recentActivity newest-first, capped', () => {
    const now = 1_700_000_000_000;
    const db = buildDashboardFixtureDb(now);
    const nMeta = Object.values(db.scoreMeta).reduce((n, m) => n + Object.keys(m).length, 0);
    assert.equal(nMeta, 1395);
    const rows = recentActivity(db.scoreMeta, db.scores, 50);
    assert.equal(rows.length, 50);
    assert.ok(rows.every((r, i) => i === 0 || rows[i - 1].at >= r.at));
    assert.ok(rows.every((r) => r.at < now && /^[^@]+@kku\.ac\.th$/.test(r.by) && (r.v === 0 || r.v === 1)));
    assert.equal(recentActivity({ q01: { MQ003: { by: 'x', at: 1 } } }, {}, 5).length, 0);
});

test('fmtClock: HH:mm:ss, dash for non-numbers', () => {
    assert.match(fmtClock(1_700_000_000_000), /^\d{2}:\d{2}:\d{2}$/);
    assert.equal(fmtClock(undefined), '-');
});

test('fixture onsite rows: exactly 40 r1Passed; questions file has 35 entries', () => {
    assert.equal(fixtureOnSiteTeams().filter((r) => r.r1Passed === true).length, 40);
    assert.equal(Object.keys(fixtureQuestionsJson().questions).length, 35);
});
