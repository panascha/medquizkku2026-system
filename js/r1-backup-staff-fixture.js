// js/r1-backup-staff-fixture.js
// FAKE data for pages/r1-backup-staff.html?fixture=1. Not real exam content, not a real key.
import { FIXTURE_QUESTIONS } from './r1-backup-fixture.js';

export { FIXTURE_QUESTIONS };

function allIds() {
    const sba = [];
    const stmts = [];
    Object.keys(FIXTURE_QUESTIONS.mcq.items).forEach((id) => {
        const it = FIXTURE_QUESTIONS.mcq.items[id];
        if (it.type === 'sba') sba.push(id);
        else Object.keys(it.statements).forEach((s) => stmts.push(s));
    });
    Object.keys(FIXTURE_QUESTIONS.unseen.articles).forEach((a) => {
        const secs = FIXTURE_QUESTIONS.unseen.articles[a].sections;
        Object.keys(secs).forEach((s) => Object.keys(secs[s].statements).forEach((st) => stmts.push(st)));
    });
    return { sba, stmts };
}

/** Obviously fake key: every SBA = "A", every statement = "T". */
export function buildFixtureKey() {
    const { sba, stmts } = allIds();
    const key = {};
    sba.forEach((id) => { key[id] = 'A'; });
    stmts.forEach((id) => { key[id] = 'T'; });
    return { key };
}

/** Fake RTDB tree + control. Students differ in how many answers are right, one never claimed, one not submitted. */
export function buildFixtureDb(now) {
    const { sba, stmts } = allIds();
    const startAt = now - 45 * 60000;
    const control = { mcq: { startAt, endAt: now + 5 * 60000 }, unseen: { startAt, endAt: now + 5 * 60000 } };
    const root = { _control: control };
    for (let t = 1; t <= 6; t++) {
        [1, 2, 3].forEach((m) => {
            const username = `mq2026-${String(t).padStart(3, '0')}-${m}`;
            if (t === 6 && m === 3) return; // never claimed
            const answers = {};
            sba.forEach((id, i) => { answers[id] = i % (t + 1) === 0 ? 'B' : 'A'; });
            stmts.filter((id) => id.startsWith('m')).forEach((id, i) => { answers[id] = i % (t + 2) === 0 ? 'F' : 'T'; });
            if (m === 1) stmts.filter((id) => id.startsWith('u')).forEach((id, i) => { answers[id] = i % (t + 1) === 0 ? 'F' : 'T'; });
            const submitted = {};
            if (!(t === 5 && m === 2)) submitted.mcq = startAt + (20 + t) * 60000 + 51000;
            if (m === 1 && t !== 5) submitted.unseen = startAt + (30 + t) * 60000 + 7000;
            root[username] = { uid: `fake-uid-${t}-${m}`, claimedAt: startAt, answers, submitted, blurCount: (t * m) % 4 };
        });
    }
    return root;
}
