import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
    QIDS, QID_RE, TEAM_RE, CUT, STALE_MS, normalizeTeamId, autoArmId, progress, totals,
    rankWithCut, laggards, buildPushPayload, lockState
} from '../js/spot-grading-engine.js';

const ids = (n) => Array.from({ length: n }, (_, i) => 'MQ' + String(i + 1).padStart(3, '0'));
// totals helper: scores by team order
const tot = (arr) => Object.fromEntries(arr.map((s, i) => [ids(arr.length)[i], s]));

test('constants', () => {
    assert.equal(QIDS.length, 35);
    assert.equal(QIDS[0], 'q01');
    assert.equal(QIDS[34], 'q35');
    QIDS.forEach((q) => assert.match(q, QID_RE));
    assert.doesNotMatch('q00', QID_RE);
    assert.doesNotMatch('q36', QID_RE);
    assert.match('MQ100', TEAM_RE);
    assert.doesNotMatch('MQ101', TEAM_RE);
});

test('normalizeTeamId', () => {
    const set = new Set(ids(40));
    ['15', '015', 'MQ015', 'mq15', ' 15 ', 15].forEach((r) => assert.equal(normalizeTeamId(r, set), 'MQ015'));
    ['MQ101', '0', 'MQ0', '', null, 'abc', '101'].forEach((r) => assert.equal(normalizeTeamId(r, set), null));
    assert.equal(normalizeTeamId('41', set), null);
    assert.equal(normalizeTeamId('7', ids(40)), 'MQ007');
    assert.equal(normalizeTeamId('7', { MQ007: true }), 'MQ007');
    assert.equal(normalizeTeamId('MQ015 - ทีม - เอ', set), 'MQ015');
});

test('autoArmId: arms only when unambiguous', () => {
    const set = new Set(ids(40));
    ['15', '015', 'MQ015', 'mq015', 'MQ15', 'MQ015 - ทีมทดสอบ'].forEach((r) => assert.equal(autoArmId(r, set), 'MQ015'));
    // 1 digit, "MQ1", "0x" wait for Enter / more digits; unknown team never arms
    ['5', 'MQ5', '05', 'MQ05', '', '41', '041', 'abc'].forEach((r) => assert.equal(autoArmId(r, set), null));
    // "10" while MQ100 is active: the next "0" would score MQ010 → wait
    assert.equal(autoArmId('10', new Set(['MQ010', 'MQ100'])), null);
    assert.equal(autoArmId('100', new Set(['MQ010', 'MQ100'])), 'MQ100');
    assert.equal(autoArmId('10', new Set(['MQ010'])), 'MQ010');
});

test('progress counts, ignores unknown team and non-0/1', () => {
    const teams = ids(3);
    const scores = { q01: { MQ001: 1, MQ002: 0, MQ003: 2, MQ099: 1 }, q02: { MQ001: 1, MQ002: '1' } };
    const p = progress(scores, teams, ['q01', 'q02']);
    assert.equal(p.total, 6);
    assert.equal(p.done, 3);
    assert.deepEqual(p.perQuestion, { q01: { done: 2, total: 3 }, q02: { done: 1, total: 3 } });
    assert.deepEqual(p.perTeam, { MQ001: 2, MQ002: 1, MQ003: 0 });
});

test('totals with and without teams', () => {
    const scores = { q01: { MQ001: 1, MQ002: 0, MQ009: 1 }, q02: { MQ001: 1, MQ002: 3 } };
    assert.deepEqual(totals(scores, ids(3)), { MQ001: 2, MQ002: 0, MQ003: 0 });
    assert.deepEqual(totals(scores), { MQ001: 2, MQ002: 0, MQ009: 1 });
});

test('rankWithCut: no tie, ranks, ties across/inside cut', () => {
    let r = rankWithCut(tot([20, 19, 18, 17, 16, 15, 14, 13, 12, 11]));
    assert.deepEqual(r.cutTies, []);
    assert.equal(r.ranked[0].team, 'MQ001');

    r = rankWithCut(tot([30, 29, 29, 20, 10]), 2);
    assert.deepEqual(r.ranked.map((x) => x.rank), [1, 2, 2, 4, 5]);
    assert.deepEqual(r.cutTies, ['MQ002', 'MQ003']);

    // 3 teams tied at positions 8/9/10
    r = rankWithCut(tot([30, 29, 28, 27, 26, 25, 24, 20, 20, 20, 5]));
    assert.deepEqual(r.cutTies, ['MQ008', 'MQ009', 'MQ010']);

    // tie fully inside top 8
    r = rankWithCut(tot([30, 30, 28, 27, 26, 25, 24, 23, 20, 5]));
    assert.deepEqual(r.cutTies, []);

    // n <= cut
    assert.deepEqual(rankWithCut(tot([5, 5, 5, 5, 5, 5, 5, 5])).cutTies, []);

    // tie order deterministic by id asc
    r = rankWithCut({ MQ009: 5, MQ002: 5, MQ005: 7 });
    assert.deepEqual(r.ranked.map((x) => x.team), ['MQ005', 'MQ002', 'MQ009']);
});

function prog(dones, total = 40) {
    const perQuestion = {};
    dones.forEach((d, i) => { perQuestion['q' + String(i + 1).padStart(2, '0')] = { done: d, total }; });
    return { perQuestion };
}

test('laggards: median, minGap boundary, sort', () => {
    // odd: median 40
    assert.deepEqual(laggards(prog([40, 40, 40])), []);
    // gap 2 excluded, gap 3 included (median 40)
    let l = laggards(prog([40, 40, 40, 38, 37]));
    assert.deepEqual(l, [{ qid: 'q05', done: 37, total: 40, median: 40 }]);
    // even n -> mean of middle two: [10,20,30,40] -> median 25
    l = laggards(prog([40, 30, 20, 10]), { minGap: 3 });
    assert.equal(l[0].median, 25);
    assert.deepEqual(l.map((x) => x.qid), ['q04', 'q03']);
    // sort done asc then qid asc
    l = laggards(prog([40, 40, 40, 40, 30, 30, 20]));
    assert.deepEqual(l.map((x) => x.qid), ['q07', 'q05', 'q06']);
    assert.deepEqual(laggards({ perQuestion: {} }), []);
});

test('buildPushPayload', () => {
    const clean = tot([20, 19, 18, 17, 16, 15, 14, 13, 12, 11]);
    const frozen = structuredClone(clean);
    let r = buildPushPayload(clean);
    assert.equal(r.ok, true);
    assert.deepEqual(r.payload.passed, ids(8));
    assert.deepEqual(r.payload.scores, clean);
    assert.notEqual(r.payload.scores, clean);
    assert.deepEqual(clean, frozen);

    const tie = tot([30, 29, 28, 27, 26, 25, 24, 20, 20, 20, 5]);
    assert.deepEqual(buildPushPayload(tie), { ok: false, reason: 'TIE_UNRESOLVED' });
    assert.deepEqual(buildPushPayload(tie, {}), { ok: false, reason: 'TIE_UNRESOLVED' });

    const base = ids(7);
    const bad = (passed) => buildPushPayload(tie, { passed }).reason;
    assert.equal(bad([...base]), 'TIE_INVALID'); // wrong count
    assert.equal(bad([...base, 'MQ007']), 'TIE_INVALID'); // dup
    assert.equal(bad([...base, 'MQ099']), 'TIE_INVALID'); // unknown
    assert.equal(bad([...base.slice(0, 6), 'MQ008', 'MQ011']), 'TIE_INVALID'); // omits MQ007, passes lower scorer
    assert.equal(bad([...base.slice(0, 6), 'MQ011', 'MQ008']), 'TIE_INVALID');
    assert.equal(bad(null), 'TIE_UNRESOLVED');

    r = buildPushPayload(tie, { passed: [...base, 'MQ009'] });
    assert.equal(r.ok, true);
    assert.deepEqual(r.payload.passed, [...base, 'MQ009']);

    assert.equal(buildPushPayload(tot([36, 1, 1, 1, 1, 1, 1, 1, 1])).reason, 'BAD_SCORE');
    assert.equal(buildPushPayload(tot([1.5, 1, 1, 1, 1, 1, 1, 1, 1])).reason, 'BAD_SCORE');
    assert.equal(buildPushPayload(tot([-1, 1, 1, 1, 1, 1, 1, 1, 1])).reason, 'BAD_SCORE');
    assert.equal(buildPushPayload(tot([5, 5, 5, 5, 5, 5, 5, CUT])).reason, 'TOO_FEW_TEAMS');
});

test('lockState', () => {
    assert.equal(lockState(null, 1000), 'free');
    assert.equal(lockState({}, 1000), 'free');
    assert.equal(lockState({ lastActive: NaN }, 1000), 'free');
    const t = 1000000;
    assert.equal(lockState({ lastActive: t }, t + 59999), 'held');
    assert.equal(lockState({ lastActive: t }, t + STALE_MS), 'stale');
    assert.equal(lockState({ lastActive: t }, t + 120000), 'stale');
    assert.equal(lockState({ lastActive: t + 5000 }, t), 'held');
});

test('qid regex appears in rules json; no cascade at root', () => {
    const raw = readFileSync(new URL('../spot_grading.rules.json', import.meta.url), 'utf8');
    assert.ok(raw.includes('/' + QID_RE.source + '/'), 'rules missing qid regex');
    const root = JSON.parse(raw).spot_grading_2026;
    // SPOT_GRADING.md line 28 "read/write needs staff" is per-child: parent grants cascade and cannot be revoked
    assert.equal(root['.read'], undefined);
    assert.equal(root['.write'], undefined);
    assert.ok(root.questions['.read'].includes('isGradingOpen'));
});
