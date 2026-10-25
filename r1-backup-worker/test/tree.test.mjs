import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTree } from '../src/tree.js';

const U1 = 'mq2026-001-1';
const U2 = 'mq2026-002-2';

test('empty input -> {} with no _control', () => {
  assert.deepEqual(buildTree({}), {});
  assert.deepEqual(buildTree(), {});
  assert.ok(!('_control' in buildTree({ seats: [], control: [] })));
});

test('full rows -> RTDB shape', () => {
  const t = buildTree({
    seats: [{ username: U1, token_hash: 'deadbeef', claimed_at: 10, blur_count: 2 }],
    answers: [
      { username: U1, qid: 'm01', value: 'A', updated_at: 11 },
      { username: U1, qid: 'u1a1', value: 'T', updated_at: 12 },
    ],
    flags: [{ username: U1, item_id: 'm01' }],
    submitted: [{ username: U1, part: 'mcq', at: 99, client_completed_at: 1, client_time_taken: 2 }],
    control: [{ part: 'mcq', start_at: 1, end_at: 2 }],
  });
  assert.deepEqual(t, {
    _control: { mcq: { startAt: 1, endAt: 2 } },
    [U1]: {
      claimed: true,
      claimedAt: 10,
      blurCount: 2,
      answers: { m01: 'A', u1a1: 'T' },
      flags: { m01: true },
      submitted: { mcq: 99 },
    },
  });
});

test('no token_hash / uid anywhere', () => {
  const t = buildTree({ seats: [{ username: U1, token_hash: 'deadbeef', claimed_at: 1, blur_count: 0 }] });
  const s = JSON.stringify(t);
  assert.ok(!s.includes('deadbeef'));
  assert.ok(!/token|uid/i.test(s));
});

test('_control only for existing parts', () => {
  const t = buildTree({ control: [{ part: 'unseen', start_at: 5, end_at: 9 }] });
  assert.deepEqual(t._control, { unseen: { startAt: 5, endAt: 9 } });
  assert.ok(!('mcq' in t._control));
});

test('released seat: answers remain, claimed absent', () => {
  const t = buildTree({ answers: [{ username: U2, qid: 'm02', value: 'B' }] });
  assert.deepEqual(t[U2], { answers: { m02: 'B' } });
  assert.ok(!('claimed' in t[U2]));
});

test('empty maps omitted for seat-only user', () => {
  const t = buildTree({ seats: [{ username: U1, claimed_at: 3, blur_count: 0 }] });
  assert.deepEqual(t[U1], { claimed: true, claimedAt: 3, blurCount: 0 });
});
