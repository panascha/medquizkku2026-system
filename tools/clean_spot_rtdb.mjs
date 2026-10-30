#!/usr/bin/env node
// Standalone Spot clean slate, for when the dashboard button cannot be used (rules not published,
// no admin login, browser trouble). Uses the Firebase service account, which bypasses RTDB rules.
//
//   node tools/clean_spot_rtdb.mjs --key <service-account.json>                          dry run
//   node tools/clean_spot_rtdb.mjs --key <service-account.json> --confirm-wipe-spot-data  wipe
//
// --key defaults to $GOOGLE_APPLICATION_CREDENTIALS. --db-url overrides the production database URL.
// No npm install needed: the service-account JWT is signed with node:crypto and the wipe is one
// atomic REST PATCH. The wipe list is js/spot-clean-slate.js, shared with the dashboard button.
// Never prints the key file's contents.

import { readFileSync } from 'node:fs';
import { createSign } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { CLEAN_SLATE_UPDATE } from '../js/spot-clean-slate.js';

const BASE = 'spot_grading_2026';
const DEFAULT_DB_URL = 'https://medquiz-kku-2026-default-rtdb.asia-southeast1.firebasedatabase.app';
const SCOPE = 'https://www.googleapis.com/auth/firebase.database https://www.googleapis.com/auth/userinfo.email';
export const CONFIRM_FLAG = '--confirm-wipe-spot-data';

export function parseArgs(argv, env = {}) {
    const opts = { confirm: false, key: env.GOOGLE_APPLICATION_CREDENTIALS || '', dbUrl: DEFAULT_DB_URL };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === CONFIRM_FLAG) opts.confirm = true;
        else if (a === '--key') opts.key = argv[++i];
        else if (a === '--db-url') opts.dbUrl = String(argv[++i]).replace(/\/+$/, '');
        else throw new Error(`unknown argument: ${a}`);
    }
    return opts;
}

const b64u = (b) => Buffer.from(b).toString('base64url');

export function signJwt(account, nowSec = Math.floor(Date.now() / 1000)) {
    const head = b64u(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
    const claims = b64u(JSON.stringify({
        iss: account.client_email, scope: SCOPE, aud: account.token_uri, iat: nowSec, exp: nowSec + 3300
    }));
    const sig = createSign('RSA-SHA256').update(`${head}.${claims}`).sign(account.private_key);
    return `${head}.${claims}.${b64u(sig)}`;
}

async function accessToken(account, fetchImpl) {
    const res = await fetchImpl(account.token_uri, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: signJwt(account) })
    });
    const json = await res.json();
    if (!res.ok || !json.access_token) throw new Error(`token request failed (${res.status})`);
    return json.access_token;
}

async function shallowKeys(dbUrl, token, path, fetchImpl) {
    const res = await fetchImpl(`${dbUrl}/${BASE}/${path}.json?shallow=true`, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(`read ${path} failed (${res.status})`);
    const v = await res.json();
    return v && typeof v === 'object' ? Object.keys(v).length : (v === null ? 0 : 1);
}

export async function run(opts, { fetchImpl = fetch, readText = (p) => readFileSync(p, 'utf8'), log = console.log } = {}) {
    if (!opts.key) { log('No service-account key: pass --key <file> or set GOOGLE_APPLICATION_CREDENTIALS.'); return 2; }
    const account = JSON.parse(readText(opts.key));
    if (!account.private_key || !account.client_email || !account.token_uri) { log('Key file is not a service account.'); return 2; }
    const token = await accessToken(account, fetchImpl);

    log(`Project ${account.project_id} - ${opts.dbUrl}/${BASE}`);
    const targets = Object.keys(CLEAN_SLATE_UPDATE);
    for (const t of ['scores', 'scoreMeta', 'graders']) log(`  ${t}: ${await shallowKeys(opts.dbUrl, token, t, fetchImpl)} children`);
    log(`Will write: ${targets.map((k) => `${k}=${JSON.stringify(CLEAN_SLATE_UPDATE[k])}`).join(', ')}`);
    log('Kept: teams, questions, admins.');

    if (!opts.confirm) { log(`DRY RUN. Re-run with ${CONFIRM_FLAG} to wipe.`); return 2; }

    const res = await fetchImpl(`${opts.dbUrl}/${BASE}.json`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(CLEAN_SLATE_UPDATE)
    });
    if (!res.ok) { log(`FAILED: PATCH returned ${res.status}.`); return 4; }

    const left = {};
    for (const t of ['scores', 'scoreMeta', 'graders', 'tieDecision']) left[t] = await shallowKeys(opts.dbUrl, token, t, fetchImpl);
    const open = await (await fetchImpl(`${opts.dbUrl}/${BASE}/config/isGradingOpen.json`, { headers: { Authorization: `Bearer ${token}` } })).json();
    const pushed = await (await fetchImpl(`${opts.dbUrl}/${BASE}/config/pushedAt.json`, { headers: { Authorization: `Bearer ${token}` } })).json();
    const clean = Object.values(left).every((n) => n === 0) && open === false && pushed === null;
    log(`After: ${JSON.stringify(left)} isGradingOpen=${open} pushedAt=${pushed}`);
    log(clean ? 'DONE. Spot is clean; grading is closed.' : 'FAILED post-wipe check.');
    return clean ? 0 : 4;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
    let opts;
    try { opts = parseArgs(process.argv.slice(2), process.env); } catch (e) { console.error(e.message); process.exit(2); }
    run(opts).then((code) => process.exit(code), (e) => { console.error('ERROR:', e.message); process.exit(1); });
}
