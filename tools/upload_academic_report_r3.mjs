// Upload R3 Gameshow PDF + CSV to RTDB /academic_report_r3, base64-encoded for lazy download.
// Node 22 built-in fetch, zero dependencies. Staff-gated read on the portal.
import { readFileSync } from 'fs';
import { createSign } from 'crypto';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const SA = JSON.parse(readFileSync(join(__dirname, '../../medquiz-kku-2026-firebase-adminsdk-fbsvc-87d3e9ef40.json'), 'utf8'));
const DB = (SA.databaseURL || 'https://medquiz-kku-2026-default-rtdb.asia-southeast1.firebasedatabase.app').replace(/\/$/, '');
const DIR = 'D:/00 POND/University/MedQuiz 2026/reports/academic_report_2026-11-03';

const FILES = [
  { name: 'gameshow_academic_report_2026-11-01.pdf', mime: 'application/pdf' },
  { name: 'gameshow_team_answers_2026-11-01.csv', mime: 'text/csv;charset=utf-8' }
];

function jwt(clientEmail, privateKey, scope) {
  const header = { alg: 'RS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const claim = { iss: clientEmail, scope, aud: SA.token_uri || 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 };
  const b64 = (s) => Buffer.from(JSON.stringify(s)).toString('base64url');
  const sigInput = `${b64(header)}.${b64(claim)}`;
  const sign = createSign('RSA-SHA256');
  sign.update(sigInput); sign.end();
  return `${sigInput}.${sign.sign(privateKey, 'base64url')}`;
}

async function fetchToken() {
  const assertion = jwt(SA.client_email, SA.private_key, 'https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/firebase.database');
  const res = await fetch(SA.token_uri || 'https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${encodeURIComponent(assertion)}`
  });
  if (!res.ok) throw new Error(`Token fetch failed: ${res.status}`);
  return (await res.json()).access_token;
}

const payload = { generatedAt: new Date().toISOString(), files: {} };
for (const f of FILES) {
  const buf = readFileSync(join(DIR, f.name));
  const key = f.name.replace(/\./g, '_');
  payload.files[key] = { mime: f.mime, size: buf.length, b64: buf.toString('base64') };
}

const token = await fetchToken();
const res = await fetch(`${DB}/academic_report_2026/r3Files.json`, {
  method: 'PATCH',
  headers: { 'Authorization': `Bearer ${token}` },
  body: JSON.stringify(payload)
});
if (!res.ok) throw new Error(`PUT failed: ${res.status} ${await res.text()}`);
console.log(`Uploaded /academic_report_2026/r3Files (${Object.keys(payload.files).length} files, ${JSON.stringify(payload).length} bytes)`);
for (const f of FILES) console.log(`  ${f.name}: ${payload.files[f.name.replace(/\./g, '_')].size} bytes`);