import test from 'node:test';
import assert from 'node:assert/strict';
import * as R from '../src/rules.js';

test('username regex', () => {
  for (const u of ['mq2026-001-1', 'mq2026-100-3', 'mq2026-099-2']) assert.ok(R.isValidUsername(u), u);
  for (const u of ['mq2026-000-1', 'mq2026-101-1', 'mq2026-001-4', 'MQ2026-001-1', '', null, 5]) {
    assert.ok(!R.isValidUsername(u), String(u));
  }
});

test('unseen seat only -1', () => {
  assert.ok(R.isUnseenSeat('mq2026-001-1'));
  assert.ok(!R.isUnseenSeat('mq2026-001-2'));
  assert.ok(!R.isUnseenSeat('mq2026-001-9'));
});

test('partOfQid / unknown qids', () => {
  assert.equal(R.partOfQid('m01'), 'mcq');
  assert.equal(R.partOfQid('m23'), 'mcq');
  assert.equal(R.partOfQid('m24s1'), 'mcq');
  assert.equal(R.partOfQid('m28s4'), 'mcq');
  assert.equal(R.partOfQid('u1a1'), 'unseen');
  assert.equal(R.partOfQid('u3b4'), 'unseen');
  for (const q of ['m24', 'm22s1', 'm29s1', 'u4a1', 'm00', 'm01s1', 'u1c1', '', null]) assert.equal(R.partOfQid(q), null, String(q));
});

test('validateAnswer', () => {
  for (const v of ['A', 'B', 'C', 'D', 'E']) assert.ok(R.validateAnswer('m01', v).ok);
  assert.ok(!R.validateAnswer('m01', 'F').ok);
  assert.ok(!R.validateAnswer('m01', 'T').ok);
  assert.ok(!R.validateAnswer('m01', 'a').ok);
  assert.ok(R.validateAnswer('m24s1', 'T').ok);
  assert.ok(R.validateAnswer('m28s4', 'F').ok);
  assert.ok(!R.validateAnswer('m24s1', 'A').ok);
  assert.ok(R.validateAnswer('u1a1', 'T').ok);
  assert.ok(!R.validateAnswer('u3b4', 'E').ok);
  assert.deepEqual(R.validateAnswer('m01', null), { ok: true, delete: true });
  assert.ok(R.validateAnswer('u1a1', null).delete);
  assert.ok(!R.validateAnswer('m24', 'A').ok);
  assert.ok(!R.validateAnswer('m24', null).ok);
  assert.ok(!R.validateAnswer('m01', 1).ok);
  assert.ok(!R.validateAnswer('m01', true).ok);
});

test('flag ids', () => {
  for (const i of ['m01', 'm23', 'm24', 'm28', 'u1a', 'u3b']) assert.ok(R.validateFlagId(i), i);
  for (const i of ['m00', 'm29', 'u4a', 'u1c', 'm22s1', 'u1a1', '']) assert.ok(!R.validateFlagId(i), i);
  assert.equal(R.partOfFlag('m28'), 'mcq');
  assert.equal(R.partOfFlag('u2b'), 'unseen');
});

const ctl = { startAt: 1000, endAt: 5000 };
const G = 100;

test('window boundaries', () => {
  const w = (now) => R.canWrite({ part: 'mcq', username: 'mq2026-001-2', ctl, now, grace: G });
  assert.ok(!w(999));
  assert.ok(w(1000));
  assert.ok(w(5000));
  assert.ok(w(5000 + G));
  assert.ok(!w(5000 + G + 1));
  assert.ok(!R.canWrite({ part: 'mcq', username: 'mq2026-001-2', ctl: undefined, now: 2000, grace: G }));
});

test('submitted part rejected', () => {
  assert.ok(!R.canWrite({ part: 'mcq', username: 'mq2026-001-1', ctl, now: 2000, grace: G, submitted: true }));
  assert.ok(R.canWrite({ part: 'mcq', username: 'mq2026-001-1', ctl, now: 2000, grace: G, submitted: false }));
});

test('unseen only for -1 seats', () => {
  const base = { part: 'unseen', ctl, now: 2000, grace: G };
  assert.ok(R.canWrite({ ...base, username: 'mq2026-001-1' }));
  assert.ok(!R.canWrite({ ...base, username: 'mq2026-001-2' }));
  assert.ok(!R.canFinalSubmit({ part: 'unseen', username: 'mq2026-001-3', ctl, now: 2000 }));
  assert.ok(R.canFinalSubmit({ part: 'unseen', username: 'mq2026-001-1', ctl, now: 2000 }));
});

test('bad part / username', () => {
  assert.ok(!R.canWrite({ part: 'x', username: 'mq2026-001-1', ctl, now: 2000, grace: G }));
  assert.ok(!R.canWrite({ part: 'mcq', username: 'bad', ctl, now: 2000, grace: G }));
});

test('final submit after endAt ok, before startAt not, twice not', () => {
  const f = (o) => R.canFinalSubmit({ part: 'mcq', username: 'mq2026-001-2', ctl, ...o });
  assert.ok(f({ now: 999999 }));
  assert.ok(f({ now: 1000 }));
  assert.ok(!f({ now: 999 }));
  assert.ok(!f({ now: 2000, submitted: true }));
  assert.ok(!R.canFinalSubmit({ part: 'mcq', username: 'mq2026-001-2', ctl: undefined, now: 2000 }));
});

test('blur monotonic and bounded', () => {
  assert.ok(R.validBlur(0, 0));
  assert.ok(R.validBlur(undefined, 3));
  assert.ok(R.validBlur(5, 5));
  assert.ok(R.validBlur(5, 6));
  assert.ok(!R.validBlur(5, 4));
  assert.ok(R.validBlur(0, 100000));
  assert.ok(!R.validBlur(0, 100001));
  assert.ok(!R.validBlur(0, 1.5));
  assert.ok(!R.validBlur(0, '3'));
  assert.ok(!R.validBlur(0, -1));
});

test('sanitizeQuestions', () => {
  assert.ok(R.sanitizeQuestions({ items: [{ id: 'm01', stem: 'dummy', options: ['a', 'b'] }] }).ok);
  assert.ok(R.sanitizeQuestions([]).ok);
  assert.ok(R.sanitizeQuestions(null).ok);
  assert.ok(!R.sanitizeQuestions({ key: 'A' }).ok);
  assert.ok(!R.sanitizeQuestions({ a: { b: [{ Answer: 'x' }] } }).ok);
  assert.ok(!R.sanitizeQuestions({ a: [[{ CORRECT: true }]] }).ok);
  assert.ok(R.sanitizeQuestions({ keyword: 'ok', answers_hint: 'ok' }).ok);
  assert.match(R.sanitizeQuestions({ a: { key: 1 } }).path, /key/);
});

test('image name / mime / size', () => {
  assert.ok(R.isImageName('a1.png'));
  assert.ok(R.isImageName('A_b-c.jpg'));
  assert.ok(!R.isImageName('../x.png'));
  assert.ok(!R.isImageName('a b.png'));
  assert.ok(!R.isImageName(''));
  assert.ok(!R.isImageName('x'.repeat(81)));
  assert.ok(R.isImageMime('image/png'));
  assert.ok(R.isImageMime('image/jpeg'));
  assert.ok(R.isImageMime('IMAGE/PNG; charset=x'));
  assert.ok(!R.isImageMime('image/gif'));
  assert.ok(!R.isImageMime(null));
  assert.equal(R.MAX_IMG, 1048576);
});

test('sha256Hex', async () => {
  assert.equal(await R.sha256Hex('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});
