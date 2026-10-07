// js/r1-backup-staff-sync.js
// Firebase side of the R1 backup STAFF page. Loaded only in live mode (never in ?fixture=1).
// The caller must have passed requireStaff(user) first; RTDB rules enforce the whitelist server-side.
import { db, ref, set, get, onValue, update } from './firebase-config.js';
import { RELEASE_SEAT_UPDATE } from './r1-backup-staff-engine.js';

const ROOT = 'r1_backup_exam';
let offset = 0;

export function startServerClock() {
    return new Promise((resolve) => {
        onValue(ref(db, '.info/serverTimeOffset'), (s) => { offset = s.val() || 0; resolve(); });
    });
}

export const getServerNow = () => Date.now() + offset;

/** cb(rootValue) on every change of the whole r1_backup_exam tree. */
export function watchRoot(cb, onError) {
    return onValue(ref(db, ROOT), (s) => cb(s.val() || {}), onError);
}

export const readControl = async (part) => (await get(ref(db, `${ROOT}/_control/${part}`))).val();
export const writeControl = (part, ctl) => set(ref(db, `${ROOT}/_control/${part}`), ctl);
export const writeQuestions = (part, clean) => set(ref(db, `${ROOT}/_questions/${part}`), clean);
export const releaseSeat = (username) => update(ref(db, `${ROOT}/${username}`), RELEASE_SEAT_UPDATE);
