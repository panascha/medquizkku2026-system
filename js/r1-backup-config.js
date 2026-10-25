// js/r1-backup-config.js
// Worker base URL for the R1 backup exam (no trailing slash). Set to the deployed worker before 1 Nov.
// Local dev only: ?api=http://127.0.0.1:8787 (loopback hosts accepted, anything else ignored).
const override = (() => {
    try {
        const v = new URLSearchParams(location.search).get('api');
        return v && /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/?$/.test(v) ? v : null;
    } catch (e) { return null; }
})();
export const API_BASE = (override || 'https://r1-backup.medquizkku2026.workers.dev').replace(/\/+$/, '');
