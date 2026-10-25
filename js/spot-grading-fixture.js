// js/spot-grading-fixture.js
// FAKE data for pages/spot-grading.html?fixture=1. Not real teams, not a real key.
import { QIDS } from './spot-grading-engine.js';

export const FIXTURE_ME = { email: 'grader.fixture@kku.ac.th', name: 'ผู้ตรวจทดสอบ' };

// 40 fake team ids, deliberately non-contiguous (real ones are the R1 qualifiers).
export const FIXTURE_TEAM_IDS = Array.from({ length: 40 }, (_, i) => 'MQ' + String(i * 2 + 3).padStart(3, '0'));

export function buildFixtureDb(now) {
    const teams = {};
    FIXTURE_TEAM_IDS.forEach((t, i) => { teams[t] = { name: 'ทีมทดสอบ ' + (i + 1), r1Rank: i + 1 }; });

    const questions = {};
    QIDS.forEach((q, i) => {
        const mcq = i % 2 === 0;
        questions[q] = {
            no: i + 1,
            subject: ['Anatomy', 'Physiology', 'Pathology', 'Pharmacology', 'Microbiology'][i % 5],
            type: mcq ? 'MCQ' : 'SAQ',
            key: mcq ? 'FIXTURE-' + 'ABCDE'[i % 5] : 'FIXTURE-KEY-' + (i + 1),
            rubric: mcq ? '' : 'FIXTURE rubric: ปลอม ใช้ทดสอบหน้าจอเท่านั้น'
        };
    });

    const scores = { q01: {}, q02: {} };
    FIXTURE_TEAM_IDS.slice(0, 12).forEach((t, i) => { scores.q01[t] = i % 3 === 0 ? 0 : 1; });
    FIXTURE_TEAM_IDS.slice(0, 5).forEach((t) => { scores.q02[t] = 1; });

    const graders = {
        q02: { email: 'other.fixture@kku.ac.th', name: 'ครูทดสอบ', lastActive: now },
        q03: { email: 'old.fixture@kku.ac.th', name: 'ครูหมดอายุ', lastActive: now - 10 * 60 * 1000 }
    };

    return { config: { isGradingOpen: true }, teams, questions, graders, scores, scoreMeta: {} };
}
