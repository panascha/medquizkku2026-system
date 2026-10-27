import test from 'node:test';
import assert from 'node:assert/strict';
import {
    parseDelimited, analyzeExport, buildIngestPayload, classifyError, preflightRows, canDecide, chipText,
} from '../js/onsite-hub-engine.js';
import { fixtureCsv, createFixtureBackend } from '../js/onsite-hub-fixture.js';

test('parseDelimited: CSV quoting, BOM, CRLF, embedded comma/quote/newline', () => {
    const g = parseDelimited('﻿a,b,c\r\n"x,1","he said ""hi""","l1\nl2"\r\n');
    assert.deepEqual(g, [['a', 'b', 'c'], ['x,1', 'he said "hi"', 'l1\nl2']]);
});

test('parseDelimited: TSV detected from first line; blank lines dropped', () => {
    const g = parseDelimited('Username\tGrade/28.00\n\nmq2026-001-1\t20\n');
    assert.deepEqual(g, [['Username', 'Grade/28.00'], ['mq2026-001-1', '20']]);
});

test('analyzeExport mcq Grade/112: factor 0.25, Overall average row ignored', () => {
    const a = analyzeExport(parseDelimited(fixtureCsv('mcq', 112)), 'mcq');
    assert.equal(a.ok, true);
    assert.equal(a.rawMax, 112);
    assert.equal(a.factor, 28 / 112);
    assert.equal(a.dataRows, 300);
    assert.equal(a.teams, 100);
    assert.deepEqual(a.unmatched, ['Overall average']);
    assert.match(chipText(a, 'mcq'), /Grade\/112 → \/28/);
});

test('analyzeExport unseen Grade/24 -> 6 per article, Grade/8 allowed', () => {
    assert.equal(analyzeExport(parseDelimited(fixtureCsv('unseen', 24)), 'unseen').factor, 0.25);
    assert.equal(analyzeExport(parseDelimited(fixtureCsv('unseen', 8)), 'unseen').factor, 6 / 8);
});

test('analyzeExport: rawMax not allowed -> not ok; allowed list overridable', () => {
    const grid = parseDelimited(fixtureCsv('mcq', 50));
    const a = analyzeExport(grid, 'mcq');
    assert.equal(a.ok, false);
    assert.match(a.errors[0], /50/);
    assert.equal(analyzeExport(grid, 'mcq', { mcq: [50], unseen: [6] }).ok, true);
});

test('analyzeExport: missing Username / Grade header, empty, non-numeric grade, duplicate', () => {
    assert.equal(analyzeExport([['Foo', 'Grade/28.00'], ['x', '1']], 'mcq').ok, false);
    assert.equal(analyzeExport([['Username', 'Total'], ['mq2026-001-1', '1']], 'mcq').ok, false);
    assert.equal(analyzeExport([['Username', 'Grade/28.00']], 'mcq').ok, false);
    const bad = analyzeExport([['Username', 'Grade/28.00'], ['mq2026-001-1', 'abc']], 'mcq');
    assert.equal(bad.ok, false);
    assert.deepEqual(bad.badGrades, ['mq2026-001-1']);
    const dup = analyzeExport([['Username', 'Grade/28.00'], ['mq2026-001-1', '1'], ['mq2026-001-1', '2'], ['mq2026-002-1', '-']], 'mcq');
    assert.equal(dup.ok, true);
    assert.equal(dup.duplicates.length, 1);
    assert.equal(dup.blankGrades, 1);
});

test('buildIngestPayload: needs all 3 unseen or none; blocks invalid; flag passthrough', () => {
    const m = parseDelimited(fixtureCsv('mcq', 112));
    const u = parseDelimited(fixtureCsv('unseen', 24));
    assert.deepEqual(Object.keys(buildIngestPayload({ mcq: m, unseen: [null, null, null] })), ['mcq']);
    assert.throws(() => buildIngestPayload({ mcq: null, unseen: [u, u, null] }), /ครบ 3/);
    assert.throws(() => buildIngestPayload({ mcq: null, unseen: [null, null, null] }), /ยังไม่มีข้อมูล/);
    assert.throws(() => buildIngestPayload({ mcq: parseDelimited(fixtureCsv('mcq', 50)) }), /MCQ/);
    const p = buildIngestPayload({ mcq: m, unseen: [u, u, u] }, undefined, true);
    assert.equal(p.unseen.length, 3);
    assert.equal(p.allowAfterDecide, true);
});

test('classifyError maps server codes', () => {
    assert.equal(classifyError('PREVIEW_REQUIRED: x').code, 'PREVIEW_REQUIRED');
    assert.equal(classifyError('INVALID_PREVIEW_TOKEN: ข้อมูลเปลี่ยนหลังพรีวิว — กดพรีวิวใหม่').code, 'INVALID_PREVIEW_TOKEN');
    assert.equal(classifyError('unauthorized: a@b ไม่อยู่ใน ONSITE_ADMINS').code, 'unauthorized');
    assert.equal(classifyError('r2_started: col M').code, 'r2_started');
    assert.equal(classifyError('พบคะแนนรอบ 1 เพียง 3 ทีม (ต้องการ ≥ 50) — ยังไม่พร้อม').code, 'NOT_READY');
    assert.equal(classifyError('boom').code, 'ERROR');
});

test('canDecide: needs token + ready + not stale', () => {
    assert.equal(canDecide({}), false);
    assert.equal(canDecide({ previewToken: 't', previewReady: true, previewStale: false }), true);
    assert.equal(canDecide({ previewToken: 't', previewReady: true, previewStale: true }), false);
    assert.equal(canDecide({ previewToken: 't', previewReady: false, previewStale: false }), false);
});

test('preflightRows: cutoff, tie, blind tie, no-show levels', () => {
    const rows = preflightRows({
        scoredCount: 98, ready: true, cutoff: { total: 30.5, teamId: 'MQ012' }, straddleTie: true,
        blindTies: ['MQ001 ↔ MQ002'], unscoredTeams: ['MQ099', 'MQ100'],
    });
    const by = Object.fromEntries(rows.map((r) => [r.key, r]));
    assert.equal(by.cutoff.value, '30.5 (MQ012)');
    assert.equal(by.ties.level, 'warn');
    assert.equal(by.blind.level, 'warn');
    assert.equal(by.noshow.value, '2 ทีม');
});

test('fixture backend: decide needs preview; stale token after re-ingest rejected', async () => {
    const call = createFixtureBackend();
    await assert.rejects(call('r1Decide', {}), /PREVIEW_REQUIRED/);
    await call('r1Ingest', { mcq: [[]] });
    const pv = await call('r1Preview');
    await call('r1Ingest', { mcq: [[]] });
    await assert.rejects(call('r1Decide', { previewToken: pv.previewToken }), /INVALID_PREVIEW_TOKEN/);
    const pv2 = await call('r1Preview');
    const d = await call('r1Decide', { previewToken: pv2.previewToken });
    assert.equal(d.groups.A, 20);
    await assert.rejects(call('r1Reset', { confirm: 'x' }), /RESET/);
});
