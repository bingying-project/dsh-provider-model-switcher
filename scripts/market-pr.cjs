/**
 * One-command submission to https://github.com/awesome-dsh-plugin/awesome-dsh-plugin
 *
 * Does what the manual recipe does, without a browser and without `gh`:
 *   1. gate  - run test/market-check.cjs, refuse to submit unless it is green
 *   2. fork  - fork the list into your account (idempotent)
 *   3. sync  - fast-forward the fork to upstream main
 *   4. branch- create a branch on the fork and put data/plugins/<file>.yml there
 *   5. pr    - open the pull request
 *
 * Transport is `curl`, not `fetch`: Node's global fetch ignores HTTP(S)_PROXY,
 * while curl honours it, so this keeps working behind a corporate proxy.
 *
 * Auth: a token with `public_repo` (classic) or Contents + Pull requests write
 * on your fork (fine-grained), passed via GH_TOKEN / GITHUB_TOKEN — or
 * `--from-git-credential`, which reuses the credential git already stores for
 * github.com (the one `git push` uses), so no separate setup is needed.
 *
 * Usage:
 *   GH_TOKEN=xxx node scripts/market-pr.cjs --dry-run   # plan only, no writes
 *   GH_TOKEN=xxx node scripts/market-pr.cjs             # do it
 *   node scripts/market-pr.cjs --from-git-credential    # reuse git's credential
 *
 * Flags:
 *   --dry-run              read-only: verify everything, change nothing
 *   --force                ignore a red local gate or a repo younger than 24h
 *   --skip-check           do not run test/market-check.cjs
 *   --no-pr                stop after the fork branch is committed; no PR
 *   --from-git-credential  take the token from `git credential fill`
 *   --help
 */
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const ENTRY_DIR = path.join(ROOT, 'market');
const UPSTREAM = 'awesome-dsh-plugin/awesome-dsh-plugin';
const ENTRY_PATH_PREFIX = 'data/plugins/';
const API = 'https://api.github.com';

/** The fork keeps upstream's repository name: <you>/awesome-dsh-plugin. */
const forkName = UPSTREAM.split('/')[1];

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const DRY = flag('dry-run');
const FORCE = flag('force');
const SKIP_CHECK = flag('skip-check');
const NO_PR = flag('no-pr');

/**
 * Token resolution, in order:
 *   1. GH_TOKEN / GITHUB_TOKEN
 *   2. --from-git-credential: reuse whatever git already uses for github.com,
 *      so a machine that can `git push` needs no extra setup. Interactive
 *      helpers are disabled, so this never pops a login window.
 */
const TOKEN = resolveToken();

function resolveToken() {
  const fromEnv = (process.env.GH_TOKEN || process.env.GITHUB_TOKEN || '').trim();
  if (fromEnv) return fromEnv;
  if (!flag('from-git-credential')) return '';
  const result = spawnSync('git', ['credential', 'fill'], {
    input: 'protocol=https\nhost=github.com\n\n',
    encoding: 'utf8',
    timeout: 20000,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' },
  });
  if (result.status !== 0) return '';
  const match = /^password=(.+)$/m.exec(result.stdout || '');
  return match ? match[1].trim() : '';
}

/* ------------------------------------------------------------------ output */

const paint = (code, text) => (process.stdout.isTTY ? `\u001b[${code}m${text}\u001b[0m` : text);
const ok = (text) => console.log(`${paint(32, 'PASS')}  ${text}`);
const bad = (text) => console.log(`${paint(31, 'FAIL')}  ${text}`);
const note = (text) => console.log(`${paint(36, 'INFO')}  ${text}`);
const step = (text) => console.log(`\n${paint(1, `== ${text}`)}`);

function die(text, code = 1) {
  console.log(`\n${paint(31, 'ABORT')}  ${text}`);
  process.exit(code);
}

/* ------------------------------------------------------------------- http  */

/**
 * curl call, so proxy env vars and system CA store are respected.
 * The token is passed through a header file on stdin, never through argv,
 * so it does not show up in process listings.
 */
function http(method, urlPath, body) {
  const url = urlPath.startsWith('http') ? urlPath : `${API}${urlPath}`;
  const args = [
    '-sS',
    '-X', method,
    '-H', 'Accept: application/vnd.github+json',
    '-H', 'X-GitHub-Api-Version: 2022-11-28',
    '-H', 'User-Agent: dsh-provider-model-switcher-market-pr',
    '-w', '\n%{http_code}',
    '--max-time', '60',
  ];
  if (TOKEN) args.push('-H', `Authorization: Bearer ${TOKEN}`);
  if (body !== undefined) {
    args.push('-H', 'Content-Type: application/json', '--data-binary', '@-');
  }
  args.push(url);
  // The token lives in this process's own argv, which curl cannot avoid; it is
  // never echoed back into the logs.
  const result = spawnSync('curl', args, {
    input: body === undefined ? undefined : JSON.stringify(body),
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
  if (result.error) die(`curl failed to start: ${result.error.message}`);
  if (result.status !== 0) die(`curl exited ${result.status}: ${(result.stderr || '').trim()}`);
  const raw = result.stdout || '';
  const cut = raw.lastIndexOf('\n');
  const status = Number(raw.slice(cut + 1).trim());
  const text = raw.slice(0, cut).trim();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  return { status, data };
}

function api(method, urlPath, body, { allow = [] } = {}) {
  const response = http(method, urlPath, body);
  if (response.status >= 200 && response.status < 300) return response;
  if (allow.includes(response.status)) return response;
  const message = response.data && response.data.message ? response.data.message : String(response.data);
  die(`${method} ${urlPath} -> ${response.status} ${message}`);
}

/* ------------------------------------------------------------------ entry  */

function entryFile() {
  if (!fs.existsSync(ENTRY_DIR)) die(`no market/ directory at ${ENTRY_DIR}`);
  const files = fs.readdirSync(ENTRY_DIR).filter((name) => /\.ya?ml$/.test(name));
  if (files.length === 0) die('market/ has no .yml entry to submit');
  if (files.length > 1) die(`market/ has ${files.length} entries; upstream allows 3 per PR but this script submits one at a time`);
  return files[0];
}

function readField(text, key) {
  const match = text.match(new RegExp(`^${key}:\\s*(.+)$`, 'm'));
  return match ? match[1].trim() : '';
}

/* ------------------------------------------------------------------- gate  */

function runLocalCheck() {
  step('gate: test/market-check.cjs');
  const result = spawnSync(process.execPath, [path.join(ROOT, 'test', 'market-check.cjs')], {
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
  });
  const output = `${result.stdout || ''}${result.stderr || ''}`;
  const failures = output.split('\n').filter((line) => line.startsWith('FAIL'));
  const warnings = output.split('\n').filter((line) => line.startsWith('WARN'));
  if (failures.length === 0 && result.status === 0) {
    ok(`local gate green (${warnings.length} warning(s))`);
    return true;
  }
  for (const line of failures) bad(line.replace(/^FAIL\s+/, ''));
  for (const line of warnings) note(line.replace(/^WARN\s+/, ''));
  if (FORCE) {
    note('--force given, continuing despite a red gate');
    return false;
  }
  die('local gate is red; fix it, wait for the built-in cooldown, or pass --force', 3);
}

/* ------------------------------------------------------------------ steps  */

async function main() {
  if (flag('help')) {
    console.log(fs.readFileSync(__filename, 'utf8').split('*/')[0].replace(/^\/\*\*?/, '').replace(/^ \* ?/gm, ''));
    return;
  }
  if (!TOKEN && !DRY) {
    console.log(`${paint(33, 'NO TOKEN')}  GH_TOKEN / GITHUB_TOKEN is not set.`);
    console.log('');
    console.log('Two ways forward:');
    console.log('  A. token route (fully automated, ~10s)');
    console.log('     create a classic token with the `public_repo` scope, then:');
    console.log('     GH_TOKEN=<token> node scripts/market-pr.cjs');
    console.log('     — or, if this machine can already `git push` to GitHub:');
    console.log('     node scripts/market-pr.cjs --from-git-credential');
    console.log('  B. no-token route (two clicks in the browser)');
    console.log('     1. open https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/fork');
    console.log('     2. drag the yml into data/plugins/ on the web, then Create pull request');
    console.log('');
    console.log('  Without a token you can still run --dry-run: it only reads public data.');
    process.exit(4);
  }

  const entry = entryFile();
  const entryRel = ENTRY_PATH_PREFIX + entry;
  const source = path.join(ENTRY_DIR, entry);
  const text = fs.readFileSync(source, 'utf8');
  const repoUrl = readField(text, 'url');
  if (!repoUrl) die(`${entry} has no url field`);
  const slug = repoUrl.replace(/^https:\/\/github\.com\//, '').replace(/\.git$/, '').replace(/\/$/, '');
  const [owner, name] = slug.split('/');
  if (!owner || !name) die(`cannot parse owner/repo from url: ${repoUrl}`);

  step('target');
  note(`entry  ${entry}`);
  note(`plugin ${slug}`);
  note(`fork   ${owner}/${forkName}`);
  note(`branch ${DRY ? '(would create) ' : ''}add-${name}`);

  if (!SKIP_CHECK) runLocalCheck();

  step('auth');
  let login = owner;
  if (TOKEN) {
    const me = api('GET', '/user').data;
    login = me.login;
    ok(`token belongs to ${login}${login.toLowerCase() === owner.toLowerCase() ? ' (same as the plugin owner)' : ''}`);
  } else {
    note('no token: read-only dry run, assuming the fork owner is ' + owner);
  }

  step('preflight');
  const upstream = api('GET', `/repos/${UPSTREAM}`).data;
  ok(`upstream ${UPSTREAM} (default branch ${upstream.default_branch})`);
  const already = api('GET', `/repos/${UPSTREAM}/contents/${entryRel}`, undefined, { allow: [404] });
  if (already.status === 200) die(`${entryRel} already exists upstream — this is an update, do it by hand to avoid clobbering review history`, 5);
  ok('entry is not present upstream yet');

  const repo = api('GET', `/repos/${slug}`).data;
  const ageHours = (Date.now() - new Date(repo.created_at).getTime()) / 3600000;
  if (ageHours < 24) {
    const ready = new Date(new Date(repo.created_at).getTime() + 86400000);
    bad(`repository is ${ageHours.toFixed(1)}h old, CI requires >= 24h`);
    note(`ready at ${ready.toISOString()} (Beijing ${new Date(ready.getTime() + 8 * 3600000).toISOString().slice(0, 16).replace('T', ' ')})`);
    if (!FORCE) die('repo-age gate not met; wait, or pass --force to submit anyway (CI will reject it)', 3);
  } else {
    ok(`repository is ${ageHours.toFixed(1)}h old`);
  }
  if (!repo.topics || !repo.topics.includes('dsh-plugin')) bad('repo is missing the dsh-plugin topic');
  else ok('repo has the dsh-plugin topic');

  // dsh.bundle must be visible from the repo root package.json — that is CI check #2.
  const manifest = api('GET', `/repos/${slug}/contents/package.json`, undefined, { allow: [404] });
  if (manifest.status === 200 && manifest.data.content) {
    const packageJson = JSON.parse(Buffer.from(manifest.data.content, 'base64').toString('utf8'));
    if (packageJson.dsh && packageJson.dsh.bundle) ok('package.json declares dsh.bundle');
    else die('package.json on GitHub does not declare dsh.bundle — CI check #2 would fail');
  } else {
    bad('no package.json at repo root — CI looks there, or in packages/ plugins/ apps/');
  }

  if (DRY) {
    step('dry run complete');
    note('nothing was written. drop --dry-run to fork, branch and open the PR.');
    console.log(`\ncompare link once a branch exists:\n  https://github.com/${UPSTREAM}/compare/${upstream.default_branch}...${login}:add-${name}?expand=1`);
    return;
  }

  step('fork');
  let fork = api('GET', `/repos/${login}/${forkName}`, undefined, { allow: [404] });
  if (fork.status === 404) {
    api('POST', `/repos/${UPSTREAM}/forks`, { default_branch_only: true });
    note('fork requested, waiting for it to appear...');
    const deadline = Date.now() + 90000;
    while (Date.now() < deadline) {
      fork = api('GET', `/repos/${login}/${forkName}`, undefined, { allow: [404] });
      if (fork.status === 200) break;
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
    if (fork.status !== 200) die('fork did not appear within 90s; re-run once GitHub finishes creating it');
    ok(`forked to ${login}/${forkName}`);
  } else {
    ok(`fork already exists: ${login}/${forkName}`);
  }

  step('sync fork');
  const sync = api('POST', `/repos/${login}/${forkName}/merge-upstream`, { branch: upstream.default_branch }, { allow: [409, 422] });
  if (sync.status === 200) ok('fork fast-forwarded to upstream');
  else note(`fork sync skipped (${sync.status}) — continuing with the fork's own head`);

  step('branch');
  const branch = `add-${name}`;
  const base = api('GET', `/repos/${login}/${forkName}/git/ref/heads/${upstream.default_branch}`, undefined, { allow: [404] });
  if (base.status !== 200) die(`cannot read fork head: ${base.status}`);
  const baseSha = base.data.object.sha;
  const created = api('POST', `/repos/${login}/${forkName}/git/refs`, { ref: `refs/heads/${branch}`, sha: baseSha }, { allow: [422] });
  if (created.status === 201) ok(`branch ${branch} created at ${baseSha.slice(0, 7)}`);
  else {
    api('PATCH', `/repos/${login}/${forkName}/git/refs/heads/${branch}`, { sha: baseSha, force: true });
    ok(`branch ${branch} reset to ${baseSha.slice(0, 7)}`);
  }

  step('commit entry');
  const existing = api('GET', `/repos/${login}/${forkName}/contents/${entryRel}?ref=${branch}`, undefined, { allow: [404] });
  const putBody = {
    message: `Add ${slug}`,
    content: fs.readFileSync(source).toString('base64'),
    branch,
  };
  if (existing.status === 200) putBody.sha = existing.data.sha;
  api('PUT', `/repos/${login}/${forkName}/contents/${entryRel}`, putBody);
  ok(`committed ${entryRel} (${text.length} bytes)`);

  step('pull request');
  if (NO_PR) {
    note('--no-pr: fork, branch and commit are staged; run again without --no-pr to open the PR');
    console.log(`\n  https://github.com/${UPSTREAM}/compare/${upstream.default_branch}...${login}:${branch}?expand=1`);
    return;
  }
  const title = `Add ${name}`;
  const prBody = [
    `Adds \`${name}\` — a DSH client plugin that groups the composer's model picker by provider.`,
    '',
    `- Repository: ${repoUrl}`,
    `- Category: \`${readField(text, 'category') || 'ui'}\``,
    '- One entry, no other file touched; the READMEs regenerate on your side.',
    '- `dsh.bundle.patch` is declared in `package.json` (`./cordis.patch.yml`), and the `dsh-plugin` topic is set.',
    '',
    'What it does, checked against the code: the composer keeps its native model seat; the plugin adds a provider-grouped list next to it, labels the native button with the owning provider, and each provider row jumps to Settings → Models for that provider. It never removes or replaces the built-in picker, and it is inert when the model directory is unavailable.',
    '',
    'Local pre-flight (`test/market-check.cjs`, mirrors your CI): entry name/url matching, category, single-line description, raster GitHub-hosted icon, `dsh.bundle`, repo age and topic — all green.',
  ].join('\n');

  const pr = api('POST', `/repos/${UPSTREAM}/pulls`, {
    title,
    head: `${login}:${branch}`,
    base: upstream.default_branch,
    body: prBody,
    draft: false,
  }, { allow: [422] });

  if (pr.status === 201) {
    ok(`pull request opened: ${pr.data.html_url}`);
  } else {
    const open = api('GET', `/repos/${UPSTREAM}/pulls?head=${login}:${branch}&state=open`).data;
    if (Array.isArray(open) && open.length > 0) {
      note(`a pull request for this branch is already open: ${open[0].html_url}`);
      note('CI re-runs on every push to the same branch — no new PR needed.');
    } else {
      die(`PR creation failed: ${pr.data && pr.data.message ? pr.data.message : 'unknown'}`, 6);
    }
  }
}

main().catch((error) => die(error && error.stack ? error.stack : String(error)));
