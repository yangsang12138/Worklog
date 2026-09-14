/**
 * Tests for app-level Git configurations and the token that is part of each.
 *
 * Pinned here because a configuration is *referenced by id* from a workspace
 * while living in the app config, and because it is now a portable unit that can
 * be copied, exported and imported. A normalisation mistake therefore shows up
 * as a silent dangling reference or a silently dropped credential, rather than
 * as a crash — exactly the class of bug these tests exist to catch.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
    EXPIRING_SOON_DAYS,
    normalizeIsoDate,
    tokenStatus,
} from '../src/lib/app-config/tokens.ts';
import {
    GIT_CONFIG_FILE_VERSION,
    adoptGitLibrary,
    createGitConfig,
    describeRemote,
    deserializeGitConfigs,
    duplicateGitConfig,
    findGitConfig,
    gitConfigStatus,
    isSupportedRemoteUrl,
    normalizeGitConfigs,
    serializeGitConfigs,
} from '../src/lib/app-config/git-configs.ts';

const TODAY = '2026-03-15';

// ── The token inside a configuration ──────────────────────────────────────

test('expiry status distinguishes expired, expiring, valid and unknown', () => {
    assert.equal(tokenStatus(null, TODAY), 'no-expiry');
    assert.equal(tokenStatus(undefined, TODAY), 'no-expiry');
    assert.equal(tokenStatus('2026-03-14', TODAY), 'expired');
    assert.equal(
        tokenStatus(TODAY, TODAY),
        'expiring',
        'a token expiring today still works today',
    );
    assert.equal(tokenStatus('2026-03-20', TODAY), 'expiring');
    assert.equal(tokenStatus('2027-01-01', TODAY), 'valid');

    const plus = (days) => {
        const d = new Date(`${TODAY}T00:00:00Z`);
        d.setUTCDate(d.getUTCDate() + days);
        return d.toISOString().slice(0, 10);
    };
    assert.equal(tokenStatus(plus(EXPIRING_SOON_DAYS), TODAY), 'expiring');
    assert.equal(tokenStatus(plus(EXPIRING_SOON_DAYS + 1), TODAY), 'valid');
});

test('impossible and malformed dates become "no expiry recorded"', () => {
    assert.equal(normalizeIsoDate('2026-02-31'), null);
    assert.equal(normalizeIsoDate('15/03/2026'), null);
    assert.equal(normalizeIsoDate(''), null);
    assert.equal(normalizeIsoDate(null), null);
    assert.equal(normalizeIsoDate('2026-03-15'), '2026-03-15');
    assert.equal(tokenStatus('2026-02-31', TODAY), 'no-expiry');
});

// ── The library ───────────────────────────────────────────────────────────

test('a configuration without a remote URL is not kept', () => {
    const configs = normalizeGitConfigs([
        { name: 'draft' },
        { name: 'real', remote_url: 'https://github.com/me/repo.git' },
    ]);

    assert.deepEqual(
        configs.map((c) => c.name),
        ['real'],
        'a configuration that cannot connect is a half-filled form',
    );
});

test('normalisation trims what it stores and defaults what is missing', () => {
    const config = createGitConfig({
        name: '  team  ',
        remote_url: '  https://github.com/me/repo.git  ',
        git_name: '  Ada  ',
        git_email: '  ada@example.com ',
        token: '  ghp_padded\n',
        token_expires_at: '2027-01-01',
    });

    assert.equal(config.name, 'team');
    assert.equal(config.remote_url, 'https://github.com/me/repo.git');
    assert.equal(config.git_name, 'Ada');
    assert.equal(config.git_email, 'ada@example.com');
    assert.equal(
        config.token,
        'ghp_padded',
        'a pasted trailing newline is a silent 401',
    );
    assert.equal(config.token_expires_at, '2027-01-01');
    assert.equal(
        createGitConfig({}).token_expires_at,
        null,
        'no expiry recorded is the default',
    );
});

test('duplicate ids are replaced', () => {
    const configs = normalizeGitConfigs([
        { id: 'GIT-SAME01', remote_url: 'https://github.com/a/one.git' },
        { id: 'GIT-SAME01', remote_url: 'https://github.com/a/two.git' },
    ]);

    assert.equal(configs.length, 2);
    assert.notEqual(configs[0].id, configs[1].id);
});

test('the branch is not part of a configuration', () => {
    const config = createGitConfig({
        remote_url: 'https://github.com/me/repo.git',
        branch: 'release',
    });

    // Which line of history to sync is a per-workspace decision: the same
    // connection can be synced on `main` by one workspace and a release branch
    // by another. Keeping a branch here would make one of them wrong.
    assert.equal('branch' in config, false);
});

test('the remote rule matches what the sync engine can drive', () => {
    assert.equal(isSupportedRemoteUrl('https://github.com/me/repo.git'), true);
    assert.equal(isSupportedRemoteUrl('https://github.com/me/repo'), true);

    assert.equal(
        isSupportedRemoteUrl('git@github.com:me/repo.git'),
        false,
        'SSH is not implemented — sync injects a token into an HTTPS URL',
    );
    assert.equal(isSupportedRemoteUrl('https://gitlab.com/me/repo.git'), false);
    assert.equal(isSupportedRemoteUrl('http://github.com/me/repo.git'), false);
    assert.equal(isSupportedRemoteUrl('https://github.com/me'), false);
    assert.equal(isSupportedRemoteUrl(''), false);
});

test('a remote is described recognisably in lists', () => {
    assert.equal(describeRemote('https://github.com/me/repo.git'), 'me/repo');
    assert.equal(describeRemote('https://github.com/me/repo'), 'me/repo');
    assert.equal(describeRemote('https://github.com/me'), 'github.com');
    assert.equal(describeRemote(''), '');
    assert.equal(describeRemote('not a url'), 'not a url');
});

test('a configuration reports what it is missing', () => {
    const base = {
        remote_url: 'https://github.com/me/repo.git',
        token: 'ghp_ok',
    };

    assert.equal(gitConfigStatus(createGitConfig(base)), 'ready');
    assert.equal(
        gitConfigStatus(createGitConfig({ ...base, remote_url: '' })),
        'no-remote',
    );
    assert.equal(
        gitConfigStatus(
            createGitConfig({ ...base, remote_url: 'git@github.com:me/r.git' }),
        ),
        'unsupported-remote',
    );
    assert.equal(
        gitConfigStatus(createGitConfig({ ...base, token: '' })),
        'no-token',
        'the token is part of the configuration, so an empty one is reported here',
    );
});

test('findGitConfig resolves a workspace reference', () => {
    const configs = normalizeGitConfigs([
        { id: 'GIT-ONE111', name: 'one', remote_url: 'https://github.com/a/1.git' },
        { id: 'GIT-TWO222', name: 'two', remote_url: 'https://github.com/a/2.git' },
    ]);

    assert.equal(findGitConfig(configs, 'GIT-TWO222')?.name, 'two');
    assert.equal(findGitConfig(configs, 'GIT-GONE99'), null);
    assert.equal(findGitConfig(configs, ''), null);
    assert.equal(findGitConfig(configs, null), null);
});

// ── Copy, export, import ──────────────────────────────────────────────────

test('duplicating a configuration copies the connection and changes the id', () => {
    const original = createGitConfig({
        name: 'Team',
        remote_url: 'https://github.com/me/repo.git',
        git_name: 'Ada',
        token: 'ghp_secret',
        token_expires_at: '2027-01-01',
    });

    const copy = duplicateGitConfig(original);

    assert.notEqual(copy.id, original.id);
    assert.equal(copy.name, 'Team', 'the label is copied verbatim, not invented');
    assert.equal(copy.remote_url, original.remote_url);
    assert.equal(copy.git_name, 'Ada');
    assert.equal(copy.token, 'ghp_secret');
    assert.equal(copy.token_expires_at, '2027-01-01');

    // Mutating the copy must not reach back into the original.
    copy.token = 'ghp_other';
    assert.equal(original.token, 'ghp_secret');
});

test('a full export round-trips, including the credential', () => {
    const configs = normalizeGitConfigs([
        {
            id: 'GIT-AAAAAA',
            name: 'Team',
            remote_url: 'https://github.com/me/repo.git',
            git_name: 'Ada',
            git_email: 'ada@example.com',
            token: 'ghp_secret',
            token_expires_at: '2027-01-01',
        },
    ]);

    const file = serializeGitConfigs(configs, { includeSecrets: true });
    const parsed = JSON.parse(file);
    assert.equal(parsed.version, GIT_CONFIG_FILE_VERSION);
    assert.equal(parsed.includes_secrets, true, 'the file states what it holds');

    const result = deserializeGitConfigs(file);
    assert.equal(result.ok, true);
    assert.equal(result.configs.length, 1);
    assert.equal(result.configs[0].remote_url, configs[0].remote_url);
    assert.equal(result.configs[0].token, 'ghp_secret');
    assert.equal(result.configs[0].token_expires_at, '2027-01-01');
    assert.notEqual(
        result.configs[0].id,
        'GIT-AAAAAA',
        'importing is additive: a fresh id cannot overwrite an existing entry',
    );
});

test('a shareable export carries no credential and no expiry', () => {
    const configs = normalizeGitConfigs([
        {
            name: 'Team',
            remote_url: 'https://github.com/me/repo.git',
            git_name: 'Ada',
            git_email: 'ada@example.com',
            token: 'ghp_secret',
            token_expires_at: '2027-01-01',
        },
    ]);

    const file = serializeGitConfigs(configs, { includeSecrets: false });
    assert.equal(
        file.includes('ghp_secret'),
        false,
        'the secret must not appear anywhere in a shareable file',
    );

    const result = deserializeGitConfigs(file);
    assert.equal(result.ok, true);
    assert.equal(result.includesSecrets, false);
    assert.equal(result.configs[0].token, '');
    assert.equal(
        result.configs[0].token_expires_at,
        null,
        "the exporter's expiry means nothing to the recipient",
    );
    assert.equal(
        result.configs[0].remote_url,
        'https://github.com/me/repo.git',
        'everything needed to reconnect survives',
    );
    assert.equal(
        gitConfigStatus(result.configs[0]),
        'no-token',
        'and the list immediately says what the recipient must fill in',
    );
});

test('import rejects unusable files with a reason to show', () => {
    assert.deepEqual(deserializeGitConfigs('not json'), {
        ok: false,
        reason: 'invalid-json',
    });
    assert.deepEqual(deserializeGitConfigs('{"configs":"nope"}'), {
        ok: false,
        reason: 'invalid-json',
    });
    assert.deepEqual(
        deserializeGitConfigs(JSON.stringify({ version: 99, configs: [] })),
        { ok: false, reason: 'unsupported-version' },
    );
    assert.deepEqual(
        deserializeGitConfigs(JSON.stringify({ configs: [{ name: 'no url' }] })),
        { ok: false, reason: 'no-configs' },
    );
});

test('a hand-written bare array of configurations imports too', () => {
    // The shape someone types when sharing one connection between machines.
    const result = deserializeGitConfigs(
        JSON.stringify([
            { name: 'Shared', remote_url: 'https://github.com/me/repo.git' },
        ]),
    );

    assert.equal(result.ok, true);
    assert.equal(result.configs.length, 1);
    assert.equal(result.configs[0].name, 'Shared');
});

// ── Upgrading a stored file ───────────────────────────────────────────────

test('a configuration gets its token back from the pool it referenced', () => {
    // The shape shipped one version earlier: configurations referenced a shared
    // credential pool by `token_id`, and the pool lived under `credentials` —
    // *outside* the `git` object. Reading only `git` lost the credential
    // entirely, which showed up as a configured token reading "no token".
    const stored = {
        git: {
            configs: [
                {
                    id: 'GIT-ONE111',
                    name: 'Team',
                    remote_url: 'https://github.com/me/repo.git',
                    git_name: 'Ada',
                    token_id: 'TOK-AAAAAA',
                },
                {
                    id: 'GIT-TWO222',
                    name: 'Personal',
                    remote_url: 'https://github.com/me/other.git',
                    token_id: null,
                },
            ],
        },
        credentials: {
            tokens: [
                {
                    id: 'TOK-AAAAAA',
                    name: 'work',
                    token: 'ghp_work',
                    expires_at: '2027-01-01',
                },
            ],
        },
    };

    const configs = adoptGitLibrary(stored.git, stored.credentials.tokens);

    assert.equal(configs.length, 2);

    const team = configs.find((c) => c.name === 'Team');
    assert.equal(team.token, 'ghp_work', 'the referenced token must survive');
    assert.equal(team.token_expires_at, '2027-01-01');
    assert.equal(gitConfigStatus(team), 'ready');

    const personal = configs.find((c) => c.name === 'Personal');
    assert.equal(
        personal.token,
        '',
        'a configuration that referenced nothing stays empty rather than being handed someone else\'s credential',
    );
    assert.equal(gitConfigStatus(personal), 'no-token');
});

test('a token already carried by the configuration wins over the pool', () => {
    const configs = adoptGitLibrary(
        {
            configs: [
                {
                    remote_url: 'https://github.com/me/repo.git',
                    token: 'ghp_own',
                    token_expires_at: '2026-05-05',
                    token_id: 'TOK-OLD',
                },
            ],
        },
        [{ id: 'TOK-OLD', token: 'ghp_pool', expires_at: '2026-01-01' }],
    );

    assert.equal(configs[0].token, 'ghp_own');
    assert.equal(configs[0].token_expires_at, '2026-05-05');
});
