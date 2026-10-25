import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
    parseUsername, canAnswerUnseen, ID_RE, normalizeQuestions, itemStatus, buildNavigator,
    mergeAnswers, makeClock, remainingMs, formatClock, answerFromKey, storageKeys, STORAGE_PREFIX,
    RICH_TAGS, IMG_SRC_RE, checkRichHtml
} from '../js/r1-backup-engine.js';
import { FIXTURE_QUESTIONS } from '../js/r1-backup-fixture.js';

test('parseUsername valid / legacy / bounds', () => {
    assert.deepEqual(parseUsername('mq2026-007-2'), { teamNo: 7, teamId: 'MQ007', member: 2, username: 'mq2026-007-2' });
    assert.equal(parseUsername(' MQ007-2 ').username, 'mq2026-007-2');
    assert.equal(parseUsername('mq2026-100-3').teamId, 'MQ100');
    assert.equal(parseUsername('mq2026-000-1'), null);
    assert.equal(parseUsername('mq2026-101-1'), null);
    assert.equal(parseUsername('mq2026-007-4'), null);
    assert.equal(parseUsername(''), null);
    assert.equal(parseUsername(null), null);
});

test('canAnswerUnseen only member 1', () => {
    assert.equal(canAnswerUnseen(1), true);
    assert.equal(canAnswerUnseen(2), false);
    assert.equal(canAnswerUnseen(3), false);
});

test('storageKeys use prefix', () => {
    const k = storageKeys('mq2026-001-1');
    assert.equal(k.answers, STORAGE_PREFIX + 'mq2026-001-1:answers');
    assert.equal(k.session, 'r1bk:v1:session');
});

test('remainingMs monotonic: ignores wall clock, follows mono', () => {
    const clock = makeClock({ serverNowAtSync: 1_000_000, monoAtSync: 500 });
    assert.equal(remainingMs(1_060_000, clock, 500), 60_000);
    assert.equal(remainingMs(1_060_000, clock, 10_500), 50_000);
    assert.equal(remainingMs(1_060_000, clock, 70_500), -10_000);
});

test('formatClock', () => {
    assert.equal(formatClock(0), '00:00');
    assert.equal(formatClock(-5000), '00:00');
    assert.equal(formatClock(61_000), '01:01');
    assert.equal(formatClock(60_001), '01:01');
    assert.equal(formatClock(125 * 60_000), '125:00');
});

test('mergeAnswers local wins, reports local-only/different', () => {
    const { merged, pushLocalOnly } = mergeAnswers({ m01: 'A', m02: 'B' }, { m02: 'C', m03: 'D' });
    assert.deepEqual(merged, { m01: 'A', m02: 'B', m03: 'D' });
    assert.deepEqual(pushLocalOnly.sort(), ['m01', 'm02']);
    assert.deepEqual(mergeAnswers(null, null), { merged: {}, pushLocalOnly: [] });
});

test('normalizeQuestions on fixture', () => {
    const mcq = normalizeQuestions('mcq', FIXTURE_QUESTIONS.mcq);
    assert.equal(mcq.items.length, 28);
    assert.equal(mcq.items.filter((i) => i.type === 'sba').length, 23);
    const mtf = mcq.items.filter((i) => i.type === 'mtf');
    assert.equal(mtf.length, 5);
    mtf.forEach((i) => assert.equal(i.statements.length, 4));
    assert.deepEqual(mcq.items.map((i) => i.no), Array.from({ length: 28 }, (_, i) => i + 1));
    assert.equal(mcq.items[0].options.length, 5);
    const un = normalizeQuestions('unseen', FIXTURE_QUESTIONS.unseen);
    assert.equal(un.items.length, 6);
    un.items.forEach((s) => assert.equal(s.statements.length, 4));
    assert.equal(un.items[0].articleId, 'u1');
    assert.equal(un.items[5].id, 'u3b');
});

test('normalizeQuestions drops answer-key fields', () => {
    const raw = { items: { m01: { no: 1, type: 'sba', stem: 's', options: { A: 'x' }, answer: 'A', key: 'A' } } };
    const it = normalizeQuestions('mcq', raw).items[0];
    assert.equal('answer' in it, false);
    assert.equal('key' in it, false);
});

test('itemStatus + buildNavigator', () => {
    const mcq = normalizeQuestions('mcq', FIXTURE_QUESTIONS.mcq);
    const sba = mcq.items[0];
    const mtf = mcq.items[23];
    assert.equal(itemStatus(sba, {}), 'unanswered');
    assert.equal(itemStatus(sba, { m01: 'A' }), 'answered');
    assert.equal(itemStatus(mtf, { m24s1: 'T' }), 'partial');
    assert.equal(itemStatus(mtf, { m24s1: 'T', m24s2: 'F', m24s3: 'T', m24s4: 'F' }), 'answered');
    const nav = buildNavigator('mcq', mcq, { m01: 'A' }, { m03: true });
    assert.equal(nav.length, 28);
    assert.equal(nav[0].status, 'answered');
    assert.equal(nav[2].flagged, true);
    const un = buildNavigator('unseen', normalizeQuestions('unseen', FIXTURE_QUESTIONS.unseen), {}, {});
    assert.equal(un[0].label, '1.1');
});

test('answerFromKey', () => {
    const mcq = normalizeQuestions('mcq', FIXTURE_QUESTIONS.mcq);
    const sba = mcq.items[0];
    const mtf = mcq.items[23];
    assert.deepEqual(answerFromKey(sba, '2'), { type: 'answer', qid: 'm01', value: 'B' });
    assert.deepEqual(answerFromKey(sba, 'e'), { type: 'answer', qid: 'm01', value: 'E' });
    assert.equal(answerFromKey(sba, 'Enter'), null);
    assert.equal(answerFromKey(sba, 't'), null);
    assert.deepEqual(answerFromKey(sba, 'm'), { type: 'flag' });
    assert.deepEqual(answerFromKey(sba, 'ArrowRight'), { type: 'nav', dir: 1 });
    assert.deepEqual(answerFromKey(mtf, '3'), { type: 'focus', index: 2 });
    assert.deepEqual(answerFromKey(mtf, 'T', 1), { type: 'answer', qid: 'm24s2', value: 'T' });
    assert.deepEqual(answerFromKey(mtf, 'f', 3), { type: 'answer', qid: 'm24s4', value: 'F' });
    assert.equal(answerFromKey(mtf, 'a', 0), null);
    assert.equal(answerFromKey(mtf, 'Enter', 0), null);
});

test('every fixture id matches ID_RE', () => {
    const mcq = normalizeQuestions('mcq', FIXTURE_QUESTIONS.mcq);
    mcq.items.forEach((i) => {
        if (i.type === 'sba') assert.match(i.id, ID_RE.SBA);
        else i.statements.forEach((s) => assert.match(s.id, ID_RE.MTF_STMT));
        assert.match(i.id, ID_RE.FLAG);
    });
    const un = normalizeQuestions('unseen', FIXTURE_QUESTIONS.unseen);
    un.items.forEach((s) => {
        assert.match(s.id, ID_RE.FLAG);
        s.statements.forEach((st) => assert.match(st.id, ID_RE.UNSEEN_STMT));
    });
});

test('ID_RE sources appear in rules json', () => {
    const rules = readFileSync(new URL('../r1_backup_exam.rules.json', import.meta.url), 'utf8');
    const flagParts = ['^m(0[1-9]|1[0-9]|2[0-8])$', '^u[1-3][ab]$'];
    assert.equal(ID_RE.FLAG.source, flagParts.join('|'));
    [ID_RE.SBA.source, ID_RE.MTF_STMT.source, ID_RE.UNSEEN_STMT.source, ...flagParts].forEach((s) => {
        assert.ok(rules.includes('/' + s + '/'), 'rules missing /' + s + '/');
    });
    JSON.parse(rules);
});

test('checkRichHtml accepts allowlisted markup and valid img', () => {
    const img = '<img src="https://r1.example.workers.dev/api/img/u1a_1.png" alt="">';
    assert.ok(RICH_TAGS.includes('img') && IMG_SRC_RE.test('https://x.dev/api/img/a.png'));
    assert.equal(checkRichHtml('plain a &lt; b <b>x</b><sub>2</sub><br/><br>'), null);
    assert.equal(checkRichHtml(`<p>t</p><ul><li>a</li></ul><hr>${img}<img src="https://x.dev/api/img/a.jpg">`), null);
    assert.equal(checkRichHtml('<table><thead><tr><th colspan="2">h</th></tr></thead><tbody><tr><td rowspan="2">a</td><td>b</td></tr></tbody></table>'), null);
    assert.equal(checkRichHtml(''), null);
});

test('checkRichHtml rejects unsafe markup', () => {
    const bad = [
        '<script>x</script>', '<iframe src="x"></iframe>', '<b onclick="x">t</b>',
        '<img src="https://x.dev/api/img/a.png" onerror="x">', '<img src="https://x.dev/api/img/a.png" width="5">',
        '<img src="javascript:alert(1)">', '<img src="http://x.dev/api/img/a.png">', '<img src="https://x.dev/other/a.png">',
        '<img>', 'a < b', 'a <3 b', '<td style="x">c</td>', '<td colspan="x">c</td>', '<a href="https://x">l</a>', '</b x>'
    ];
    bad.forEach((h) => assert.equal(typeof checkRichHtml(h), 'string', h));
});
