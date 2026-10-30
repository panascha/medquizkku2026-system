import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { generateKeyPairSync, createVerify } from 'node:crypto';
import { CLEAN_SLATE_UPDATE, cleanSlateUpdate, applyCleanSlate } from '../js/spot-clean-slate.js';
import { parseArgs, run, signJwt, CONFIRM_FLAG } from '../tools/clean_spot_rtdb.mjs';

const rules = JSON.parse(readFileSync(new URL('../spot_grading.rules.json', import.meta.url), 'utf8')).spot_grading_2026;

function seeded() {
    return {
        config: { isGradingOpen: true, pushedAt: 1, pushedBy: 'a@kku.ac.th', keep: 'x' },
        teams: { MQ001: { name: 'A' } },
        questions: { q01: { key: 'k' } },
        admins: { a_kku: true },
        scores: { q01: { MQ001: 1 } },
        scoreMeta: { q01: { MQ001: { by: 'g', at: 1 } } },
        graders: { q01: { email: 'g@kku.ac.th' } },
        tieDecision: { passed: ['MQ001'], by: 'a', at: 1 }
    };
}

test('wipe list covers every grading path and nothing of the setup data', () => {
    assert.deepEqual(Object.keys(CLEAN_SLATE_UPDATE).sort(),
        ['config/isGradingOpen', 'config/pushedAt', 'config/pushedBy', 'graders', 'scoreMeta', 'scores', 'tieDecision']);
    assert.equal(CLEAN_SLATE_UPDATE['config/isGradingOpen'], false);
    assert.notEqual(cleanSlateUpdate(), CLEAN_SLATE_UPDATE);
});

test('applyCleanSlate: grading data gone, grading closed, setup data kept', () => {
    const t = applyCleanSlate(seeded());
    assert.equal(t.scores, undefined);
    assert.equal(t.scoreMeta, undefined);
    assert.equal(t.graders, undefined);
    assert.equal(t.tieDecision, undefined);
    assert.deepEqual(t.config, { isGradingOpen: false, keep: 'x' });
    assert.deepEqual(Object.keys(t.teams), ['MQ001']);
    assert.deepEqual(Object.keys(t.questions), ['q01']);
    assert.deepEqual(t.admins, { a_kku: true });
});

test('rules: admins may write every wiped parent node, and only admins', () => {
    for (const k of ['scores', 'scoreMeta', 'graders', 'tieDecision']) {
        const w = rules[k]['.write'];
        assert.ok(w && w.includes("spot_grading_2026/admins"), `${k} needs an admin-gated .write`);
    }
    assert.ok(rules.config['.write'].includes('spot_grading_2026/admins'));
    assert.equal(rules['.write'], undefined, 'still no cascade at root');
});

test('parseArgs', () => {
    assert.equal(parseArgs([CONFIRM_FLAG, '--key', 'k.json']).confirm, true);
    assert.equal(parseArgs([], { GOOGLE_APPLICATION_CREDENTIALS: 'env.json' }).key, 'env.json');
    assert.throws(() => parseArgs(['--confirm']), /unknown argument/);
});

test('signJwt produces a signature the public key verifies', () => {
    const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const acct = { client_email: 'sa@p.iam.gserviceaccount.com', token_uri: 'https://oauth2.example/token',
        private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }) };
    const [h, c, s] = signJwt(acct, 1000).split('.');
    assert.ok(createVerify('RSA-SHA256').update(`${h}.${c}`).verify(publicKey, Buffer.from(s, 'base64url')));
    assert.equal(JSON.parse(Buffer.from(c, 'base64url')).iss, acct.client_email);
});

function fakeRtdb(tree) {
    const calls = [];
    const fetchImpl = async (url, init = {}) => {
        calls.push({ url, method: init.method || 'GET', body: init.body });
        const json = (v, ok = true) => ({ ok, status: ok ? 200 : 500, json: async () => v });
        if (url === 'https://oauth2.example/token') return json({ access_token: 't' });
        const m = /\/spot_grading_2026(?:\/([\w/]+))?\.json/.exec(url);
        if (init.method === 'PATCH') {
            for (const [p, v] of Object.entries(JSON.parse(init.body))) {
                const ks = p.split('/'); const last = ks.pop(); let o = tree;
                ks.forEach((k) => { o = o[k] = o[k] || {}; });
                if (v === null) delete o[last]; else o[last] = v;
            }
            return json(JSON.parse(init.body));
        }
        const v = (m[1] || '').split('/').filter(Boolean).reduce((o, k) => (o == null ? undefined : o[k]), tree);
        return json(v === undefined ? null : (url.includes('shallow') && v && typeof v === 'object'
            ? Object.fromEntries(Object.keys(v).map((k) => [k, true])) : v));
    };
    return { fetchImpl, calls };
}

function keyFile() {
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    return JSON.stringify({ project_id: 'p', client_email: 'sa@p.iam.gserviceaccount.com',
        token_uri: 'https://oauth2.example/token', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }) });
}

test('standalone tool: dry run writes nothing, confirmed run sends the shared update once', async () => {
    const tree = seeded();
    const { fetchImpl, calls } = fakeRtdb(tree);
    const opts = { confirm: false, key: 'k.json', dbUrl: 'https://db.example' };
    const io = { fetchImpl, readText: keyFile, log: () => {} };

    assert.equal(await run(opts, io), 2);
    assert.ok(!calls.some((c) => c.method === 'PATCH'));
    assert.ok(tree.scores);

    assert.equal(await run({ ...opts, confirm: true }, io), 0);
    const patches = calls.filter((c) => c.method === 'PATCH');
    assert.equal(patches.length, 1);
    assert.deepEqual(JSON.parse(patches[0].body), CLEAN_SLATE_UPDATE);
    assert.equal(tree.scores, undefined);
    assert.equal(tree.config.isGradingOpen, false);
    assert.ok(tree.teams.MQ001 && tree.questions.q01 && tree.admins.a_kku);
});

test('standalone tool: no key means exit 2 without any request', async () => {
    const { fetchImpl, calls } = fakeRtdb(seeded());
    assert.equal(await run({ confirm: true, key: '', dbUrl: 'https://db.example' }, { fetchImpl, log: () => {} }), 2);
    assert.equal(calls.length, 0);
});
