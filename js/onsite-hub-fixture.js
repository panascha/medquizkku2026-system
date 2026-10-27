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

const FX_FINALISTS = [38, 3, 27, 9, 12, 31, 18, 22];   // deliberately unsorted

/** Fake getAllOnSiteTeams rows (no school: GAS adds it in #35; first 3 get one to exercise rendering). */
export function fixtureTeams(decided, r2) {
    return ids.map((id, i) => {
        const n = i + 1, pass = decided ? n <= 40 : null;
        const t = {
            teamId: id, teamName: 'ทีมทดสอบ ' + n, members: [`สมาชิก ${n}-1`, `สมาชิก ${n}-2`, `สมาชิก ${n}-3`],
            r1Passed: pass, activityGroup: pass === false ? 'ABC'[n % 3] : null,
            r2Passed: r2 && pass === true ? FX_FINALISTS.includes(n) : null,
        };
        if (n <= 3) { t.school = 'โรงเรียนทดสอบ ' + n; t.category = 'โรงเรียน'; }
        return t;
    });
}

/** Fake RTDB scores/{qNN}/{MQxxx}: first `qCount` questions fully graded for 40 teams. */
export function fixtureSpotScores(qCount) {
    const out = {};
    for (let q = 1; q <= qCount; q++) {
        const row = {};
        for (let t = 1; t <= 40; t++) row['MQ' + String(t).padStart(3, '0')] = (q + t) % 2;
        out['q' + String(q).padStart(2, '0')] = row;
    }
    return out;
}

/** opts.r2: simulate R2 pushed (8 finalists, mFilled 40). */
export function createFixtureBackend(opts = {}) {
    let ingestVersion = 0, previewVersion = -1, decided = false, rotationStartMs = null, ingested = false;
    let lastMcq = null, lastUnseen = null, r3Ranks = null;
    const tokenOf = () => 'fx-' + ingestVersion + '-' + (decided ? 'd' : 'u');
    return async function call(action, p = {}) {
        switch (action) {
            case 'getAllOnSiteTeams':
                return { status: 'success', teams: fixtureTeams(decided || !!opts.r2, !!opts.r2), rotationStartMs };
            case 'hubStatus':
                return {
                    status: 'success', tabs: {}, pasteRows: {}, lsRows: 100, rosterUsernames: 300,
                    kDecided: decided || opts.r2 ? 100 : 0, mFilled: opts.r2 ? 40 : 0, rotationStartMs,
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
            case 'r3SetRanks': {
                const fin = fixtureTeams(true, !!opts.r2).filter((t) => t.r2Passed === true).map((t) => t.teamId);
                const r = Array.isArray(p.ranks) ? p.ranks : [];
                if (fin.length !== 8) throw new Error('invalid: ผู้เข้ารอบ ' + fin.length + ' ทีม (ต้องมี 8)');
                if (r.length !== 8 || new Set(r.map((x) => x.teamId)).size !== 8 || new Set(r.map((x) => x.rank)).size !== 8 ||
                    r.some((x) => !fin.includes(x.teamId) || !Number.isInteger(x.rank) || x.rank < 1 || x.rank > 8)) throw new Error('invalid: ranks ไม่ถูกต้อง');
                r3Ranks = {}; r.forEach((x) => { r3Ranks[x.teamId] = x.rank; });
                return { status: 'success', written: 8, ranks: r3Ranks };
            }
            case 'awardExport':
                return { status: 'success', ok: true, message: 'สร้างชีตเกียรติบัตรแล้ว (fixture)', sheet: 'Award_Certificates', recipients: 300, individuals: 0, top40Teams: 40, gameshowTeams: r3Ranks ? 8 : 0, missingSchool: 0, warnings: r3Ranks ? [] : ['ยังไม่ได้บันทึกอันดับ Game Show'] };
            default:
                throw new Error('Unknown or missing action (POST)');
        }
    };
}
