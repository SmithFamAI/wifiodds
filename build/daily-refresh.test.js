#!/usr/bin/env node
'use strict';

// Run the real orchestration and publication gates against disposable local
// repositories. Only network/data/build dependencies are fixtures; neither the
// caller's worktree nor a live tracker/remote is written by these controls.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const daily = fs.readFileSync(path.join(__dirname, 'daily-refresh.sh'), 'utf8');
const prepare = fs.readFileSync(path.join(__dirname, 'prepare-daily-data.sh'), 'utf8');
const ship = fs.readFileSync(path.join(__dirname, 'ship.sh'), 'utf8');
const oldBadge = '<svg xmlns="http://www.w3.org/2000/svg"><text>100 aircraft</text></svg>\n';
const newBadge = '<svg xmlns="http://www.w3.org/2000/svg"><text>101 aircraft</text></svg>\n';
const roots = [];
let passed = 0;

function write(root, name, bytes, mode) {
  const target = path.join(root, name);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, bytes, mode ? { mode } : undefined);
}

function files(root, prefix = '') {
  return fs.readdirSync(path.join(root, prefix), { withFileTypes: true })
    .filter(entry => entry.name !== '.git')
    .flatMap(entry => {
      const name = path.join(prefix, entry.name);
      return entry.isDirectory() ? files(root, name) : [name];
    }).sort();
}

function fixture({ dailyScript = daily, failure = '', response = 'valid' } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wifiodds-daily-controls-'));
  roots.push(root);
  const repo = path.join(root, 'site');
  const remote = path.join(root, 'origin.git');
  const events = path.join(root, 'events');
  const env = { ...process.env };
  // A caller may be running from a Git hook. Never inherit its index, hooks,
  // credentials/config, or one-shot business-gate overrides into the fixture.
  for (const key of Object.keys(env)) {
    if (key.startsWith('GIT_') || key.startsWith('WIFIODDS_REBASELINE') || key === 'SHIP_TREE_GUARD_CONTROL') delete env[key];
  }
  Object.assign(env, {
    GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_OPTIONAL_LOCKS: '0',
    WIFIODDS_DRIVER_ID: 'daily-refresh-test',
    TEST_EVENTS: events, TEST_FAILURE: failure, TEST_BADGE_RESPONSE: response,
    TMPDIR: path.join(root, 'tmp'), PATH: path.join(root, 'bin') + path.delimiter + process.env.PATH
  });
  fs.mkdirSync(repo);
  fs.mkdirSync(env.TMPDIR);
  const run = (command, args, cwd = repo) => {
    const result = spawnSync(command, args, { cwd, env, encoding: 'utf8', timeout: 30000 });
    assert.ifError(result.error);
    return result;
  };
  const git = (...args) => {
    const result = run('git', args);
    assert.strictEqual(result.status, 0, `git ${args.join(' ')}: ${result.stderr}`);
    return result.stdout;
  };
  const prelude = `const fs = require('fs');\nconst event = name => fs.appendFileSync(process.env.TEST_EVENTS, name + '\\n');\n`;
  write(repo, 'build/daily-refresh.sh', dailyScript);
  write(repo, 'build/prepare-daily-data.sh', prepare);
  write(repo, 'build/ship.sh', ship);
  // Stub every dependency invoked by ship, including this regression when it
  // is added to the aggregate gate, to avoid recursively running the harness.
  for (const match of ship.matchAll(/\bnode (build\/[\w./-]+\.(?:js|mjs))/g)) {
    const name = match[1];
    const modulePrelude = name.endsWith('.mjs') ? prelude.replace("const fs = require('fs');", "import fs from 'node:fs';") : prelude;
    write(repo, name, modulePrelude + `event(${JSON.stringify(name)});\n` +
      `if (${JSON.stringify(name)} === 'build/apitest.js') {\n` +
      `  const count = fs.readFileSync(process.env.TEST_EVENTS, 'utf8').split('\\n').filter(x => x === 'build/apitest.js').length;\n` +
      `  if (process.env.TEST_FAILURE === 'prepare-check' || (process.env.TEST_FAILURE === 'final-check' && count === 2)) process.exit(42);\n}\n`);
  }
  for (const match of ship.matchAll(/\b(?:bash|sh) ((?:build|test)\/[\w./-]+\.sh)/g)) {
    if (match[1] !== 'build/ship.sh') write(repo, match[1], '#!/bin/sh\nexit 0\n');
  }
  write(repo, 'build/driver-lock-check.sh', '#!/bin/sh\nexit 0\n');
  for (const name of ['build/refresh-airline-counts.js', 'build/make-og-card.js']) {
    write(repo, name, prelude + `event(${JSON.stringify(name)});\n`);
  }
  write(repo, 'scripts/test-plausibility-gate.js', prelude +
    `event('plausibility-proof');\nif (process.env.TEST_FAILURE === 'proof') process.exit(1);\n`);
  // Daily staging must carry the real updater's correction dependencies.
  for (const name of ['reconcile-ua-membership.js', 'ua-membership-policy.js', 'ua-membership-hold.json']) {
    write(repo, 'scripts/' + name, fs.readFileSync(path.join(__dirname, '..', 'scripts', name)));
  }
  write(repo, 'scripts/update-unitedstarlink.js', prelude + `
event('update');
if (process.env.TEST_FAILURE === 'update') process.exit(1);
const file = 'public/unitedstarlink/data.json';
const data = JSON.parse(fs.readFileSync(file, 'utf8'));
data.fleet.equipped += 1;
data.measurementAsOf = '2099-01-02';
if (process.env.TEST_FAILURE === 'plausibility') data.fleet.plausibility.flags.push('fixture implausible measurement');
fs.writeFileSync(file, JSON.stringify(data) + '\\n');
`);
  write(repo, 'united/data.json', JSON.stringify({
    measurementAsOf: '2099-01-01', history: [], leaderboard: [],
    fleet: { equipped: 100, total: 1000, plausibility: { flags: [] } }
  }) + '\n');
  write(repo, 'assets/airlines.js', 'exports.WIFI_AIRLINES = {alaska:{equipped:1,fleet:10,segments:[{as:"2099-01-01"}]},hawaiian:{equipped:1,fleet:10,segments:[{as:"2099-01-01"}]}};\n');
  write(repo, 'assets/united-starlink-badge.svg', oldBadge);
  write(repo, 'unrelated.txt', 'committed unrelated work\n');
  write(root, 'bin/curl', `#!/bin/sh
printf 'badge-fetch\\n' >> "$TEST_EVENTS"
out=''
while [ "$#" -gt 0 ]; do
  case "$1" in -o) shift; out="$1" ;; esac
  shift
done
[ -n "$out" ] || exit 97
case "$TEST_BADGE_RESPONSE" in
  valid) printf '%s\\n' '${newBadge.trim()}' > "$out" ;;
  failed) printf 'partial response' > "$out"; exit 22 ;;
  empty) : > "$out" ;;
  no-svg) printf '101 aircraft' > "$out" ;;
  no-aircraft) printf '<svg>unrelated image</svg>' > "$out" ;;
  *) exit 98 ;;
esac
`, 0o755);
  git('init', '-q', '-b', 'main');
  git('config', 'user.name', 'daily-refresh-test');
  git('config', 'user.email', 'daily-refresh-test@example.invalid');
  git('config', 'core.hooksPath', path.join(root, 'no-hooks'));
  git('add', '--', ...files(repo));
  git('commit', '-qm', 'fixture baseline');
  git('init', '-q', '--bare', '-b', 'main', remote);
  git('remote', 'add', 'origin', remote);
  git('push', '-q', '-u', 'origin', 'main');
  const initial = git('rev-parse', 'HEAD').trim();
  assert.strictEqual(git('status', '--porcelain'), '', 'fixture must start clean');
  return {
    repo, git, initial, run: () => run('bash', ['build/daily-refresh.sh']),
    events: () => fs.existsSync(events) ? fs.readFileSync(events, 'utf8').trim().split('\n') : [],
    badge: () => fs.readFileSync(path.join(repo, 'assets/united-starlink-badge.svg'), 'utf8'),
    remoteHead: () => git('--git-dir=' + remote, 'rev-parse', 'refs/heads/main').trim(),
    snapshot: () => ({
      files: files(repo).map(name => [name, fs.readFileSync(path.join(repo, name)).toString('base64')]),
      index: git('ls-files', '--stage', '-z'),
      indexBytes: fs.readFileSync(path.join(repo, '.git/index')).toString('base64')
    })
  };
}

function check(name, body) {
  body();
  passed += 1;
  console.log('PASS ' + name);
}

function assertUnpublished(f) {
  assert.strictEqual(f.remoteHead(), f.initial, 'failed refresh must not push');
  assert.strictEqual(f.git('rev-parse', 'HEAD').trim(), f.initial, 'failed refresh must not commit');
}

try {
  check('changed valid badge from clean tree publishes refreshed data and badge', () => {
    const f = fixture();
    const result = f.run();
    assert.strictEqual(result.status, 0, result.stdout + result.stderr);
    assert.strictEqual(f.badge(), newBadge);
    assert.notStrictEqual(f.remoteHead(), f.initial);
    assert.strictEqual(f.git('show', 'origin/main:assets/united-starlink-badge.svg'), newBadge);
    assert.strictEqual(JSON.parse(f.git('show', 'origin/main:united/data.json')).fleet.equipped, 101);
    assert.strictEqual(f.git('status', '--porcelain'), '');
    const events = f.events();
    const badge = events.indexOf('badge-fetch');
    assert.ok(badge > events.indexOf('update'), 'data update must precede badge fetch');
    assert.ok(badge > events.indexOf('build/apitest.js'), 'prepare checks must precede badge fetch');
    assert.ok(events.lastIndexOf('build/apitest.js') > badge, 'final ship checks must run after badge change');
  });

  for (const dirty of ['badge', 'unrelated', 'untracked', 'staged', 'staged-and-unstaged']) {
    check('rejects pre-existing ' + dirty + ' work without overwriting bytes or index', () => {
      const f = fixture();
      const name = dirty === 'badge' ? 'assets/united-starlink-badge.svg' : dirty === 'untracked' ? 'draft.txt' : 'unrelated.txt';
      write(f.repo, name, 'owner work must survive\n');
      if (dirty.startsWith('staged')) f.git('add', '--', name);
      if (dirty === 'staged-and-unstaged') write(f.repo, name, 'additional unstaged owner work\n');
      const before = f.snapshot();
      const result = f.run();
      assert.strictEqual(result.status, 3, result.stdout + result.stderr);
      assert.match(result.stderr, /site worktree must start clean/);
      assert.deepStrictEqual(f.snapshot(), before, 'rejection must preserve every file and the index');
      assert.deepStrictEqual(f.events(), [], 'dirty input must be rejected before fetching or updating');
      assertUnpublished(f);
    });
  }

  for (const response of ['failed', 'empty', 'no-svg', 'no-aircraft']) {
    check(response + ' badge response retains committed badge while data refresh publishes', () => {
      const f = fixture({ response });
      const result = f.run();
      assert.strictEqual(result.status, 0, result.stdout + result.stderr);
      assert.match(result.stderr, /fetch failed or malformed; keeping the committed copy/);
      assert.strictEqual(f.badge(), oldBadge);
      assert.strictEqual(f.git('show', 'origin/main:assets/united-starlink-badge.svg'), oldBadge);
      assert.strictEqual(JSON.parse(f.git('show', 'origin/main:united/data.json')).fleet.equipped, 101);
      assert.notStrictEqual(f.remoteHead(), f.initial);
    });
  }

  for (const [failure, status] of [['proof', 11], ['update', 12], ['plausibility', 13], ['prepare-check', 18], ['final-check', 92]]) {
    check(failure + ' failure prevents publication', () => {
      const f = fixture({ failure });
      const result = f.run();
      assert.strictEqual(result.status, status, result.stdout + result.stderr);
      assertUnpublished(f);
      if (failure === 'final-check') {
        assert.strictEqual(f.badge(), newBadge, 'final checks must reject an already assembled candidate');
        assert.strictEqual(f.events().filter(x => x === 'build/apitest.js').length, 2);
      } else {
        assert.strictEqual(f.badge(), oldBadge, 'prepare failure must leave committed badge untouched');
        assert.ok(!f.events().includes('badge-fetch'));
      }
      if (failure === 'plausibility') assert.match(result.stderr, /United plausibility flags require review/);
    });
  }

  check('planted badge-before-prepare regression is rejected by the real clean-tree gate', () => {
    const badgeStart = daily.indexOf('# His live badge');
    const badgeEnd = daily.indexOf('\nbash build/ship.sh', badgeStart);
    const prepareStart = daily.indexOf('bash build/prepare-daily-data.sh');
    assert.ok(prepareStart >= 0 && badgeStart > prepareStart && badgeEnd > badgeStart,
      'negative control requires the fixed prepare-before-badge sequence');
    const badgeBlock = daily.slice(badgeStart, badgeEnd);
    const mutation = daily.slice(0, badgeStart) + daily.slice(badgeEnd);
    const oldOrder = mutation.slice(0, prepareStart) + badgeBlock + '\n\n' + mutation.slice(prepareStart);
    assert.ok(oldOrder.indexOf('# His live badge') < oldOrder.indexOf('bash build/prepare-daily-data.sh'),
      'old-order mutation must actually land');
    const f = fixture({ dailyScript: oldOrder });
    const result = f.run();
    assert.strictEqual(result.status, 3, result.stdout + result.stderr);
    assert.match(result.stderr, /site worktree must start clean/);
    assert.strictEqual(f.badge(), newBadge, 'control must really modify the badge');
    assert.deepStrictEqual(f.events(), ['badge-fetch']);
    assertUnpublished(f);
  });

  console.log(`daily-refresh controls: ${passed} passed (isolated local repositories, no live fetch or push)`);
} finally {
  for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
}
