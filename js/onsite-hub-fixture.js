// js/onsite-hub-fixture.js
// Offline fake backend for pages/onsite-hub.html?fixture=1. Mimics the OnSite hub action shapes
// (hubStatus / r1Ingest / r1Preview / r1Decide / r1Reset / rotationStart / rotationClear).
// Fake data only; never touches Firebase or the live GAS URL.

export const FIXTURE_ME = { email: 'fixture.admin@kkumail.com', name: 'Fixture Admin' };

const ids = Array.from({ length: 100 }, (_, i) => 'MQ' + String(i + 1).padStart(3, '0'));

/** Fake Moodle CSV text for tests / manual paste. kind: 'mcq' | 'unseen'. */
export function fixtureCsv(kind, rawMax) {
    const max = rawMax || (kind === 'mcq' ? 112 : 24);
    const lines = ['Surname,First name,Username,State,Completed,Time taken,Grade/' + max.toFixed(2)];
    for (let t = 1; t <= 100; t++) for (let m = 1; m <= 3; m++) {
        const g = ((t * 7 + m * 3) % (max + 1));
        lines.push(`S${t},F${m},mq2026-${String(t).padStart(3, '0')}-${m},Finished,"9 November 2025  9:${String(10 + (t % 50))} AM",12 mins 3 secs,${g}.00`);
    }
    lines.push(',,Overall average,,,,10.00');
    return lines.join('\n');
}

export function createFixtureBackend() {
    let ingestVersion = 0, previewVersion = -1, decided = false, rotationStartMs = null, ingested = false;
    let lastMcq = null, lastUnseen = null;
    const tokenOf = () => 'fx-' + ingestVersion + '-' + (decided ? 'd' : 'u');
    return async function call(action, p = {}) {
        switch (action) {
            case 'hubStatus':
                return {
                    status: 'success', tabs: {}, pasteRows: {}, lsRows: 100, rosterUsernames: 300,
                    kDecided: decided ? 100 : 0, mFilled: 0, rotationStartMs,
                    allowedRawMax: { mcq: [28, 112], unseen: [6, 8, 24] }, lastMcq, lastUnseen,
                };
            case 'r1Ingest': {
                if (decided && !p.allowAfterDecide) throw new Error('ยกเลิก: ตัดสินรอบ 1 แล้ว — ส่ง allowAfterDecide เพื่อเขียนทับ');
                ingestVersion++; ingested = true;
                const out = { status: 'success' };
                const sum = { factor: 1, teamsScored: 100, noShow: [], duplicates: [], problems: [] };
                if (p.mcq) { out.mcq = sum; lastMcq = Object.assign({ at: Date.now() }, sum); }
                if (p.unseen) { out.unseen = Object.assign({ factors: [0.25, 0.25, 0.25] }, sum); lastUnseen = Object.assign({ at: Date.now() }, out.unseen); }
                return out;
            }
            case 'r1Preview': {
                previewVersion = ingestVersion;
                const top = ids.slice(0, 45).map((id, i) => ({ rank: i + 1, teamId: id, total: 40 - i * 0.5, unseen: 14 - i * 0.2, submit: 1000 + i }));
                return {
                    status: 'success', top45: top, cutoff: { total: top[39].total, teamId: top[39].teamId },
                    straddleTie: false, blindTies: [], unscoredTeams: ingested ? [] : ids, scoredCount: ingested ? 100 : 0,
                    ready: ingested, previewToken: tokenOf(),
                };
            }
            case 'r1Decide':
                if (!p.previewToken) throw new Error('PREVIEW_REQUIRED: ต้องกดพรีวิวก่อน แล้วส่ง previewToken');
                if (p.previewToken !== tokenOf() || previewVersion !== ingestVersion) throw new Error('INVALID_PREVIEW_TOKEN: ข้อมูลเปลี่ยนหลังพรีวิว — กดพรีวิวใหม่');
                decided = true;
                return { status: 'success', cutoff: { total: 20.5, teamId: 'MQ040' }, blindTies: [], groups: { A: 20, B: 20, C: 20 }, passed: 40 };
            case 'r1Reset':
                if (p.confirm !== 'RESET') throw new Error('invalid: ต้องส่ง confirm:"RESET"');
                decided = false; ingestVersion++;
                return { status: 'success', cleared: 100 };
            case 'rotationStart':
                if (rotationStartMs && !p.overwrite) throw new Error('exists: มีเวลาเริ่มหมุนฐานแล้ว — ส่ง overwrite:true เพื่อเริ่มใหม่');
                rotationStartMs = Date.now();
                return { status: 'success', startMs: rotationStartMs, startedAt: new Date(rotationStartMs).toISOString(), overwrote: false };
            case 'rotationClear':
                rotationStartMs = null;
                return { status: 'success' };
            default:
                throw new Error('Unknown or missing action (POST)');
        }
    };
}
