import test from 'node:test';
import assert from 'node:assert/strict';
import {
    sanitizeQuestions, planControl, controlState, monitorRows, RELEASE_SEAT_UPDATE, parseAnswerKey,
    scoreMcq, scoreUnseen, formatMoodleDate, formatMoodleDuration, buildMcqTsv, buildUnseenTsvs,
    MCQ_HEADER, UNSEEN_HEADER
} from '../js/r1-backup-staff-engine.js';
import { FIXTURE_QUESTIONS, buildFixtureKey, buildFixtureDb } from '../js/r1-backup-staff-fixture.js';

// Replicas of the GAS importer's parsers (www/appscript clasp/MedQuiz 2026 OnSite/Code.js, _parseMoodleDate / _parseMoodleDuration).
const MONTHS = { january: 0, february: 1, march: 2, april: 3, may: 4, june: 5, july: 6, august: 7, september: 8, october: 9, november: 10, december: 11 };
function gasParseDate(cell) {
    const s = String(cell || '').replace(/\s+/g, ' ').trim();
    const m = s.match(/^(\d{1,2}) ([A-Za-z]+) (\d{4}) (\d{1,2}):(\d{2})(?::(\d{2}))? ?(AM|PM)?$/i);
    if (!m) return null;
    let hour = Number(m[4]);
    const ap = (m[7] || '').toUpperCase();
    if (ap === 'PM' && hour !== 12) hour += 12;
    if (ap === 'AM' && hour === 12) hour = 0;
    return { y: Number(m[3]), mo: MONTHS[m[2].toLowerCase()], d: Number(m[1]), h: hour, mi: Number(m[5]) };
}
function gasParseDuration(cell) {
    const s = String(cell || '').trim().toLowerCase();
    let secs = 0, matched = false;
    const grab = (re, mult) => { const m = s.match(re); if (m) { secs += Number(m[1]) * mult; matched = true; } };
    grab(/(\d+)\s*hour/, 3600); grab(/(\d+)\s*min/, 60); grab(/(\d+)\s*sec/, 1);
    return matched ? secs : null;
}
const parseUsernameGas = (raw) => /^mq(?:2026-)?0*(\d{1,3})-([123])$/i.test(String(raw || '').trim());

const NOW = Date.UTC(2026, 10, 1, 3, 0, 0); // 1 Nov 2026 10:00 Bangkok
const key = parseAnswerKey(buildFixtureKey());

test('sanitizeQuestions accepts fixture shapes unchanged', () => {
    assert.deepEqual(sanitizeQuestions('mcq', FIXTURE_QUESTIONS.mcq), FIXTURE_QUESTIONS.mcq);
    assert.deepEqual(sanitizeQuestions('unseen', FIXTURE_QUESTIONS.unseen), FIXTURE_QUESTIONS.unseen);
});

test('sanitizeQuestions refuses answer-key fields at every level', () => {
    const clone = () => JSON.parse(JSON.stringify(FIXTURE_QUESTIONS.mcq));
    let q = clone(); q.answerKey = {}; assert.throws(() => sanitizeQuestions('mcq', q), /ไม่อนุญาต/);
    q = clone(); q.items.m01.answer = 'A'; assert.throws(() => sanitizeQuestions('mcq', q), /answer/);
    q = clone(); q.items.m01.correct = 'A'; assert.throws(() => sanitizeQuestions('mcq', q), /correct/);
    q = clone(); q.items.m24.statements.m24s1.isTrue = true; assert.throws(() => sanitizeQuestions('mcq', q), /isTrue/);
    const u = JSON.parse(JSON.stringify(FIXTURE_QUESTIONS.unseen));
    u.articles.u1.sections.u1a.statements.u1a1.key = 'T';
    assert.throws(() => sanitizeQuestions('unseen', u), /key/);
});

test('sanitizeQuestions validation', () => {
    const q = JSON.parse(JSON.stringify(FIXTURE_QUESTIONS.mcq));
    assert.throws(() => sanitizeQuestions('unseen', q), /part/);
    q.items.m01.imageUrl = 'http://x/y.png';
    assert.throws(() => sanitizeQuestions('mcq', q), /https/);
    const b = JSON.parse(JSON.stringify(FIXTURE_QUESTIONS.mcq));
    b.items.m99 = b.items.m01;
    assert.throws(() => sanitizeQuestions('mcq', b), /id/);
    const o = JSON.parse(JSON.stringify(FIXTURE_QUESTIONS.mcq));
    o.items.m01.options.F = 'x';
    assert.throws(() => sanitizeQuestions('mcq', o), /A-E/);
});

test('planControl start / extend / end', () => {
    const s = planControl('start', null, 1000000);
    assert.deepEqual(s, { startAt: 1000000, endAt: 1000000 + 45 * 60000 });
    assert.deepEqual(planControl('extend', s, 0, 10), { startAt: s.startAt, endAt: s.endAt + 600000 });
    assert.throws(() => planControl('extend', s, 0, 0), /1-180/);
    assert.throws(() => planControl('extend', s, 0, 2.5), /1-180/);
    assert.throws(() => planControl('extend', null, 0, 5), /ยังไม่ได้เริ่ม/);
    assert.deepEqual(planControl('end', s, 1500000), { startAt: s.startAt, endAt: 1500000 });
    assert.equal(planControl('end', s, 500).endAt, s.startAt + 1); // endAt must stay > startAt
});

test('controlState', () => {
    const c = { startAt: 100, endAt: 200 };
    assert.equal(controlState(undefined, 150), 'รอเริ่ม');
    assert.equal(controlState(c, 50), 'รอเริ่ม');
    assert.equal(controlState(c, 150), 'กำลังสอบ');
    assert.equal(controlState(c, 201), 'จบแล้ว');
});

test('monitorRows + release seat clears uid and claimedAt', () => {
    const root = buildFixtureDb(NOW);
    root['mq2026-099-1'] = { blurCount: 2 }; // unclaimed
    const rows = monitorRows(root);
    assert.equal(rows.some((r) => r.username.startsWith('_')), false);
    const r = rows.find((x) => x.username === 'mq2026-001-1');
    assert.equal(r.claimed, true);
    assert.equal(r.answeredMcq, 43);
    assert.equal(r.answeredUnseen, 24);
    assert.equal(r.submittedMcq, true);
    assert.equal(rows.find((x) => x.username === 'mq2026-005-2').submittedMcq, false);
    assert.equal(rows.find((x) => x.username === 'mq2026-099-1').claimed, false);
    assert.equal(rows.find((x) => x.username === 'mq2026-002-2').answeredUnseen, 0);
    assert.deepEqual(RELEASE_SEAT_UPDATE, { uid: null, claimedAt: null });
});

test('parseAnswerKey completeness and values', () => {
    assert.equal(Object.keys(key).length, 23 + 20 + 24);
    const k = buildFixtureKey();
    delete k.key.m01;
    assert.throws(() => parseAnswerKey(k), /ไม่ครบ/);
    const bad = buildFixtureKey(); bad.key.m01 = 'Z';
    assert.throws(() => parseAnswerKey(bad), /A-E/);
    const unk = buildFixtureKey(); unk.key.zz = 'A';
    assert.throws(() => parseAnswerKey(unk), /ไม่รู้จัก/);
    assert.equal(Object.keys(parseAnswerKey(buildFixtureKey().key)).length, 67); // flat map accepted
});

test('scoreMcq: SBA 4, MTF 1, max 112', () => {
    const perfect = {};
    Object.keys(key).forEach((id) => { perfect[id] = key[id]; });
    assert.equal(scoreMcq(key, perfect), 112);
    assert.equal(scoreMcq(key, {}), 0);
    assert.equal(scoreMcq(key, { m01: 'A' }), 4);
    assert.equal(scoreMcq(key, { m01: 'B' }), 0);
    assert.equal(scoreMcq(key, { m24s1: 'T', m24s2: 'F' }), 1);
    assert.equal(scoreMcq(key, { u1a1: 'T' }), 0); // unseen ids never count in MCQ
    assert.equal(scoreMcq(key, null), 0);
});

test('scoreUnseen per article, max 8', () => {
    const perfect = {};
    Object.keys(key).forEach((id) => { perfect[id] = key[id]; });
    [1, 2, 3].forEach((a) => assert.equal(scoreUnseen(key, perfect, a), 8));
    assert.equal(scoreUnseen(key, { u1a1: 'T', u1b4: 'T', u2a1: 'T' }, 1), 2);
    assert.equal(scoreUnseen(key, { u1a1: 'F' }, 1), 0);
});

test('Moodle date/duration round-trip through the GAS parsers', () => {
    const d = formatMoodleDate(Date.UTC(2025, 10, 9, 2, 51)); // 09:51 Bangkok
    assert.equal(d, '9 November 2025  9:51 AM');
    assert.match(d, /2025  9:51/); // double space
    assert.deepEqual(gasParseDate(d), { y: 2025, mo: 10, d: 9, h: 9, mi: 51 });
    assert.deepEqual(gasParseDate(formatMoodleDate(Date.UTC(2026, 10, 1, 5, 5))), { y: 2026, mo: 10, d: 1, h: 12, mi: 5 }); // 12:05 PM
    assert.deepEqual(gasParseDate(formatMoodleDate(Date.UTC(2026, 10, 1, 17, 30))), { y: 2026, mo: 10, d: 2, h: 0, mi: 30 }); // 00:30 AM next day
    assert.equal(formatMoodleDuration((22 * 60 + 51) * 1000), '22 mins 51 secs');
    assert.equal(formatMoodleDuration(29 * 60000), '29 mins');
    assert.equal(formatMoodleDuration(3780000), '1 hour 3 mins');
    assert.equal(formatMoodleDuration(45000), '45 secs');
    assert.equal(gasParseDuration(formatMoodleDuration(3780000)), 3780);
    assert.equal(gasParseDuration(formatMoodleDuration((22 * 60 + 51) * 1000)), 1371);
});

function parseTsv(tsv) {
    const lines = tsv.trimEnd().split('\n').map((l) => l.split('\t'));
    return { header: lines[0], rows: lines.slice(1) };
}

test('buildMcqTsv matches the importer header contract', () => {
    const root = buildFixtureDb(NOW);
    const { tsv, count, notSubmitted } = buildMcqTsv(root, key, root._control);
    const { header, rows } = parseTsv(tsv);
    assert.deepEqual(header, ['Username', 'State', 'Completed', 'Time taken', MCQ_HEADER]);
    assert.equal(header.findIndex((h) => /^Grade\/[\d.]+$/.test(h)), 4);
    assert.equal(count, 17); // 6 teams x 3 members minus never-claimed
    assert.equal(rows.length, 17);
    rows.forEach((r) => assert.ok(parseUsernameGas(r[0])));
    const r1 = rows.find((r) => r[0] === 'mq2026-001-1');
    assert.equal(r1[1], 'Finished');
    assert.ok(gasParseDate(r1[2]));
    assert.equal(gasParseDuration(r1[3]), 21 * 60 + 51);
    assert.equal(r1[4], String(scoreMcq(key, root['mq2026-001-1'].answers).toFixed(2)));
    const open = rows.find((r) => r[0] === 'mq2026-005-2');
    assert.deepEqual(open.slice(1, 4), ['In progress', '-', '-']);
    assert.deepEqual(notSubmitted, ['mq2026-005-2']);
    assert.equal(rows.some((r) => r[0] === 'mq2026-006-3'), false);
});

test('buildUnseenTsvs: three tabs, -1 usernames only, Grade/8.00', () => {
    const root = buildFixtureDb(NOW);
    const { tabs, notSubmitted } = buildUnseenTsvs(root, key, root._control);
    assert.deepEqual(tabs.map((t) => t.tab), ['From UNSEEN 1', 'From UNSEEN 2', 'From UNSEEN 3']);
    tabs.forEach((t, i) => {
        const { header, rows } = parseTsv(t.tsv);
        assert.deepEqual(header, ['Username', 'State', 'Completed', 'Time taken', UNSEEN_HEADER]);
        assert.equal(rows.length, 6);
        rows.forEach((r) => assert.match(r[0], /-1$/));
        const mine = rows.find((r) => r[0] === 'mq2026-001-1');
        assert.equal(mine[4], scoreUnseen(key, root['mq2026-001-1'].answers, i + 1).toFixed(2));
        assert.equal(gasParseDuration(mine[3]), 31 * 60 + 7);
    });
    assert.deepEqual(notSubmitted, ['mq2026-005-1']);
});
