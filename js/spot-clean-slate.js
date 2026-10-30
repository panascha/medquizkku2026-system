// js/spot-clean-slate.js
// One definition of "Spot is back to factory" for the dashboard button and tools/clean_spot_rtdb.mjs.
// Paths are relative to spot_grading_2026/. Setup data (teams, questions, admins) is deliberately kept.
export const CLEAN_SLATE_PHRASE = 'CLEAN SLATE';

export const CLEAN_SLATE_UPDATE = Object.freeze({
    scores: null,
    scoreMeta: null,
    graders: null,
    tieDecision: null,
    'config/isGradingOpen': false,
    // doPush blocks on config.pushedAt, so a rehearsal push would otherwise lock out the real one
    'config/pushedAt': null,
    'config/pushedBy': null
});

/** Fresh mutable copy for an update() call. */
export function cleanSlateUpdate() {
    return { ...CLEAN_SLATE_UPDATE };
}

/** Same wipe against a plain object tree (fixture backend, tests). */
export function applyCleanSlate(tree) {
    for (const [path, value] of Object.entries(CLEAN_SLATE_UPDATE)) {
        const ks = path.split('/');
        const last = ks.pop();
        let o = tree;
        for (const k of ks) o = o[k] = o[k] || {};
        if (value === null) delete o[last]; else o[last] = value;
    }
    return tree;
}
