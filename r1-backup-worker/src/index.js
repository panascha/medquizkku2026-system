// R1 backup exam API: Cloudflare Worker + D1. Contract: R1_BACKUP_API.md.
import {
  isValidUsername, isPart, partOfQid, partOfFlag, validateAnswer, validateFlagId,
  canWrite, canFinalSubmit, validBlur, sanitizeQuestions, isImageName, isImageMime,
  MAX_IMG, sha256Hex,
} from './rules.js';
import { buildTree } from './tree.js';

const MAX_BODY = 262144;      // student/admin JSON bodies except questions
const MAX_QUESTIONS = 1900000; // D1 row limit is 2 MB

const grace = (env) => {
  const g = parseInt(env.GRACE_MS, 10);
  return Number.isFinite(g) && g >= 0 ? g : 5000;
};

function corsHeaders(req, env) {
  const h = { Vary: 'Origin' };
  const origin = req.headers.get('Origin');
  const allowed = String(env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (origin && allowed.includes(origin)) {
    h['Access-Control-Allow-Origin'] = origin;
    h['Access-Control-Expose-Headers'] = 'Content-Disposition';
  }
  return h;
}

function respond(req, env, body, status = 200, extra = {}) {
  return new Response(body, { status, headers: { ...corsHeaders(req, env), ...extra } });
}

function json(req, env, body, status = 200, extra = {}) {
  const out = body && typeof body === 'object' && !Array.isArray(body) ? { ...body, now: Date.now() } : body;
  return respond(req, env, JSON.stringify(out), status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extra });
}

async function readJson(req, max = MAX_BODY) {
  const text = await req.text();
  if (text.length > max) return { error: 'too_large' };
  try {
    const v = JSON.parse(text);
    return v && typeof v === 'object' && !Array.isArray(v) ? { value: v } : { error: 'bad_json' };
  } catch {
    return { error: 'bad_json' };
  }
}

const rosterOk = (env, u) => {
  const r = String(env.ROSTER || '').split(',').map((s) => s.trim()).filter(Boolean);
  return r.length === 0 || r.includes(u);
};
const userOk = (env, u) => isValidUsername(u) && rosterOk(env, u);

async function getControl(env) {
  const { results } = await env.R1DB.prepare('SELECT part, start_at, end_at FROM control').all();
  const ctl = {};
  for (const r of results) ctl[r.part] = { startAt: r.start_at, endAt: r.end_at };
  return ctl;
}

// -> { seat } | { res }
async function authSeat(req, env, username) {
  if (!userOk(env, username)) return { res: json(req, env, { status: 'badusername' }, 400) };
  const token = req.headers.get('X-Seat-Token');
  if (!token) return { res: json(req, env, { status: 'badtoken' }, 401) };
  const seat = await env.R1DB.prepare('SELECT username, token_hash, blur_count FROM seats WHERE username = ?').bind(username).first();
  if (!seat) return { res: json(req, env, { status: 'noseat' }, 403) };
  if ((await sha256Hex(token)) !== seat.token_hash) return { res: json(req, env, { status: 'badtoken' }, 401) };
  return { seat };
}

async function authAdmin(req, env) {
  if (!env.ADMIN_TOKEN) return json(req, env, { error: 'admin_not_configured' }, 500);
  const m = /^Bearer (.+)$/.exec(req.headers.get('Authorization') || '');
  if (!m || (await sha256Hex(m[1])) !== (await sha256Hex(env.ADMIN_TOKEN))) return json(req, env, { error: 'unauthorized' }, 401);
  return null;
}

const newToken = () => {
  const b = crypto.getRandomValues(new Uint8Array(32));
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
};

async function claim(req, env) {
  const { value: body, error } = await readJson(req);
  if (error) return json(req, env, { error }, 400);
  const username = body.username;
  if (!userOk(env, username)) return json(req, env, { status: 'badusername' }, 400);
  const row = await env.R1DB.prepare('SELECT token_hash FROM seats WHERE username = ?').bind(username).first();
  if (row) {
    const t = req.headers.get('X-Seat-Token');
    if (t && (await sha256Hex(t)) === row.token_hash) return json(req, env, { status: 'resumed' });
    return json(req, env, { status: 'taken' }, 409);
  }
  const token = newToken();
  const r = await env.R1DB.prepare('INSERT OR IGNORE INTO seats (username, token_hash, claimed_at) VALUES (?, ?, ?)')
    .bind(username, await sha256Hex(token), Date.now()).run();
  if (!r.meta.changes) return json(req, env, { status: 'taken' }, 409);
  return json(req, env, { status: 'claimed', token });
}

async function control(req, env) {
  return json(req, env, await getControl(env));
}

async function questions(req, env, part) {
  if (!isPart(part)) return json(req, env, { error: 'bad_part' }, 404);
  const ctl = (await getControl(env))[part];
  if (!ctl || Date.now() < ctl.startAt) return json(req, env, { error: 'not_open' }, 403);
  const row = await env.R1DB.prepare('SELECT json FROM questions WHERE part = ?').bind(part).first();
  if (!row) return json(req, env, { error: 'not_found' }, 404);
  return respond(req, env, row.json, 200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
}

async function image(req, env, name) {
  if (!isImageName(name)) return json(req, env, { error: 'bad_name' }, 400);
  const row = await env.R1DB.prepare('SELECT part, mime, data FROM images WHERE name = ?').bind(name).first();
  if (!row) return json(req, env, { error: 'not_found' }, 404);
  const ctl = (await getControl(env))[row.part];
  if (!ctl || Date.now() < ctl.startAt) return json(req, env, { error: 'not_open' }, 403);
  const data = Array.isArray(row.data) ? Uint8Array.from(row.data) : row.data;
  return respond(req, env, data, 200, { 'Content-Type': row.mime, 'Cache-Control': 'private, max-age=300' });
}

async function seatState(req, env, url) {
  const username = url.searchParams.get('username');
  const a = await authSeat(req, env, username);
  if (a.res) return a.res;
  const db = env.R1DB;
  const [ans, fl, sub] = await Promise.all([
    db.prepare('SELECT qid, value FROM answers WHERE username = ?').bind(username).all(),
    db.prepare('SELECT item_id FROM flags WHERE username = ?').bind(username).all(),
    db.prepare('SELECT part, at FROM submitted WHERE username = ?').bind(username).all(),
  ]);
  const answers = {}; for (const r of ans.results) answers[r.qid] = r.value;
  const flags = {}; for (const r of fl.results) flags[r.item_id] = true;
  const submitted = {}; for (const r of sub.results) submitted[r.part] = r.at;
  return json(req, env, { answers, flags, submitted, blurCount: a.seat.blur_count });
}

async function submit(req, env) {
  const { value: body, error } = await readJson(req);
  if (error) return json(req, env, { error }, error === 'too_large' ? 413 : 400);
  const { username, part } = body;
  const a = await authSeat(req, env, username);
  if (a.res) return a.res;
  if (!isPart(part)) return json(req, env, { error: 'bad_part' }, 400);

  const db = env.R1DB;
  const now = Date.now();
  const ctl = (await getControl(env))[part];
  const subRow = await db.prepare('SELECT 1 AS x FROM submitted WHERE username = ? AND part = ?').bind(username, part).first();
  const submitted = !!subRow;
  const g = grace(env);
  const writeOk = canWrite({ part, username, ctl, now, grace: g, submitted });

  const rejected = [];
  const stmts = [];
  const answers = body.answers && typeof body.answers === 'object' && !Array.isArray(body.answers) ? body.answers : {};
  const flags = body.flags && typeof body.flags === 'object' && !Array.isArray(body.flags) ? body.flags : {};

  for (const [qid, val] of Object.entries(answers)) {
    const v = validateAnswer(qid, val);
    if (!v.ok || partOfQid(qid) !== part || !writeOk) { rejected.push(qid); continue; }
    stmts.push(v.delete
      ? db.prepare('DELETE FROM answers WHERE username = ? AND qid = ?').bind(username, qid)
      : db.prepare('INSERT INTO answers (username, qid, value, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(username, qid) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at')
        .bind(username, qid, v.value, now));
  }
  for (const [id, on] of Object.entries(flags)) {
    if (!validateFlagId(id) || partOfFlag(id) !== part || typeof on !== 'boolean' || !writeOk) { rejected.push(id); continue; }
    stmts.push(on
      ? db.prepare('INSERT OR IGNORE INTO flags (username, item_id) VALUES (?, ?)').bind(username, id)
      : db.prepare('DELETE FROM flags WHERE username = ? AND item_id = ?').bind(username, id));
  }
  if (body.blurCount !== undefined && validBlur(a.seat.blur_count, body.blurCount)) {
    stmts.push(db.prepare('UPDATE seats SET blur_count = MAX(blur_count, ?) WHERE username = ?').bind(body.blurCount, username));
  }

  let alreadySubmitted;
  if (body.final === true) {
    if (submitted) {
      alreadySubmitted = true;
    } else if (canFinalSubmit({ part, username, ctl, now, submitted })) {
      const int = (x) => (Number.isInteger(x) ? x : null);
      stmts.push(db.prepare('INSERT OR IGNORE INTO submitted (username, part, at, client_completed_at, client_time_taken) VALUES (?, ?, ?, ?, ?)')
        .bind(username, part, now, int(body.completedAt), int(body.timeTaken)));
    } else {
      return json(req, env, { ok: false, status: 'not_open', rejected }, 403);
    }
  }
  if (stmts.length) await db.batch(stmts);
  const out = { ok: true, rejected };
  if (alreadySubmitted) out.alreadySubmitted = true;
  return json(req, env, out);
}

async function status(req, env, url) {
  const db = env.R1DB;
  const [c, m, u] = await Promise.all([
    db.prepare('SELECT COUNT(*) AS n FROM seats').first(),
    db.prepare("SELECT COUNT(*) AS n FROM submitted WHERE part = 'mcq'").first(),
    db.prepare("SELECT COUNT(*) AS n FROM submitted WHERE part = 'unseen'").first(),
  ]);
  const out = { claimed: c.n, submittedMcq: m.n, submittedUnseen: u.n };
  const username = url.searchParams.get('username');
  if (username && req.headers.get('X-Seat-Token')) {
    const a = await authSeat(req, env, username);
    if (a.res) return a.res;
    const { results } = await db.prepare('SELECT part, at FROM submitted WHERE username = ?').bind(username).all();
    out.submitted = {}; for (const r of results) out.submitted[r.part] = r.at;
  }
  return json(req, env, out);
}

async function tree(env) {
  const db = env.R1DB;
  const [seats, answers, flags, submitted, control] = await Promise.all([
    db.prepare('SELECT username, claimed_at, blur_count FROM seats').all(),
    db.prepare('SELECT username, qid, value FROM answers').all(),
    db.prepare('SELECT username, item_id FROM flags').all(),
    db.prepare('SELECT username, part, at FROM submitted').all(),
    db.prepare('SELECT part, start_at, end_at FROM control').all(),
  ]);
  return buildTree({
    seats: seats.results, answers: answers.results, flags: flags.results,
    submitted: submitted.results, control: control.results,
  });
}

async function adminControl(req, env, part) {
  if (!isPart(part)) return json(req, env, { error: 'bad_part' }, 404);
  const { value: b, error } = await readJson(req);
  if (error) return json(req, env, { error }, 400);
  if (!Number.isInteger(b.startAt) || !Number.isInteger(b.endAt) || b.endAt <= b.startAt) return json(req, env, { error: 'bad_window' }, 400);
  await env.R1DB.prepare('INSERT OR REPLACE INTO control (part, start_at, end_at) VALUES (?, ?, ?)').bind(part, b.startAt, b.endAt).run();
  return json(req, env, { ok: true });
}

async function adminQuestions(req, env, part) {
  if (!isPart(part)) return json(req, env, { error: 'bad_part' }, 404);
  const { value: q, error } = await readJson(req, MAX_QUESTIONS);
  if (error) return json(req, env, { error }, error === 'too_large' ? 413 : 400);
  const s = sanitizeQuestions(q);
  if (!s.ok) return json(req, env, { error: 'forbidden_key', path: s.path }, 400);
  await env.R1DB.prepare('INSERT OR REPLACE INTO questions (part, json) VALUES (?, ?)').bind(part, JSON.stringify(q)).run();
  return json(req, env, { ok: true });
}

async function adminImage(req, env, name, url) {
  const part = url.searchParams.get('part');
  if (!isImageName(name) || !isPart(part)) return json(req, env, { error: 'bad_request' }, 400);
  const mime = req.headers.get('Content-Type');
  if (!isImageMime(mime)) return json(req, env, { error: 'bad_mime' }, 415);
  const buf = await req.arrayBuffer();
  if (buf.byteLength === 0 || buf.byteLength > MAX_IMG) return json(req, env, { error: 'bad_size' }, 413);
  await env.R1DB.prepare('INSERT OR REPLACE INTO images (name, part, mime, data) VALUES (?, ?, ?, ?)')
    .bind(name, part, mime.split(';')[0].trim().toLowerCase(), buf).run();
  return json(req, env, { ok: true });
}

async function route(req, env) {
  const url = new URL(req.url);
  const p = url.pathname;
  const m = req.method;
  let r;

  if (m === 'POST' && p === '/api/claim') return claim(req, env);
  if (m === 'GET' && p === '/api/control') return control(req, env);
  if (m === 'GET' && (r = /^\/api\/questions\/([^/]+)$/.exec(p))) return questions(req, env, r[1]);
  if (m === 'GET' && (r = /^\/api\/img\/([^/]+)$/.exec(p))) return image(req, env, decodeURIComponent(r[1]));
  if (m === 'GET' && p === '/api/seat') return seatState(req, env, url);
  if (m === 'POST' && p === '/api/submit') return submit(req, env);
  if (m === 'GET' && p === '/api/status') return status(req, env, url);

  if (p === '/api/admin/tree' || p === '/api/export' || p.startsWith('/api/admin/')) {
    const denied = await authAdmin(req, env);
    if (denied) return denied;
    if (m === 'GET' && p === '/api/admin/tree') return json(req, env, await tree(env));
    if (m === 'GET' && p === '/api/export') {
      return respond(req, env, JSON.stringify(await tree(env)), 200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'Content-Disposition': 'attachment; filename="r1-backup-export.json"',
      });
    }
    if (m === 'PUT' && (r = /^\/api\/admin\/control\/([^/]+)$/.exec(p))) return adminControl(req, env, r[1]);
    if (m === 'PUT' && (r = /^\/api\/admin\/questions\/([^/]+)$/.exec(p))) return adminQuestions(req, env, r[1]);
    if (m === 'PUT' && (r = /^\/api\/admin\/img\/([^/]+)$/.exec(p))) return adminImage(req, env, decodeURIComponent(r[1]), url);
    if (m === 'POST' && (r = /^\/api\/admin\/release\/([^/]+)$/.exec(p))) {
      const u = decodeURIComponent(r[1]);
      if (!isValidUsername(u)) return json(req, env, { error: 'badusername' }, 400);
      await env.R1DB.prepare('DELETE FROM seats WHERE username = ?').bind(u).run();
      return json(req, env, { ok: true });
    }
  }
  return json(req, env, { error: 'not_found' }, 404);
}

export default {
  async fetch(req, env) {
    if (req.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          ...corsHeaders(req, env),
          'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, X-Seat-Token, Authorization',
          'Access-Control-Max-Age': '86400',
        },
      });
    }
    try {
      return await route(req, env);
    } catch (e) {
      console.error('r1-backup error', e && e.message);
      return json(req, env, { error: 'internal' }, 500);
    }
  },
};
