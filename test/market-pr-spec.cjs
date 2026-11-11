/**
 * Guards the submission script's contract, offline.
 *
 * The bug this exists for: the fork of the list repository is
 * <you>/awesome-dsh-plugin, not <you>/<your-plugin>. Using the plugin's own
 * repository name opened the branch and the commit in the wrong repository,
 * which is invisible in the happy path and expensive to notice later.
 *
 * Usage: node test/market-pr-spec.cjs
 */
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const SCRIPT = path.join(ROOT, 'scripts', 'market-pr.cjs');
const source = fs.readFileSync(SCRIPT, 'utf8');

const results = [];
const check = (name, passed, detail) => results.push({ name, passed, detail });

/* 1. the fork must be named after the upstream repository */
check(
  'fork name comes from the upstream repository, not the plugin',
  /const forkName = UPSTREAM\.split\('\/'\)\[1\]/.test(source),
  'const forkName = UPSTREAM.split(\'/\')[1]',
);

/* 2. no fork operation may be addressed with the plugin's own name */
const wrongTargets = source
  .split('\n')
  .filter((line) => line.includes('/repos/${login}/${name}'))
  .map((line) => line.trim());
check(
  'no fork operation targets ${login}/${name}',
  wrongTargets.length === 0,
  wrongTargets.length === 0 ? 'clean' : wrongTargets[0],
);

/* 3. every fork operation goes through ${login}/${forkName} */
const forkCalls = source
  .split('\n')
  .filter((line) => /(GET|POST|PATCH|PUT)['"]?,?\s*`\/repos\/\$\{login\}/.test(line) || line.includes('/repos/${login}/${forkName}'));
check(
  'fork operations all use ${login}/${forkName}',
  forkCalls.length >= 6,
  `${forkCalls.length} call(s)`,
);

/* 4. the gate is enforced unless explicitly bypassed */
check(
  'refuses to continue on a red gate without --force',
  /if \(FORCE\) \{[\s\S]{0,120}die\('local gate is red/.test(source),
  'FORCE guard present',
);

/* 5. runtime: no token and no --dry-run exits 4 with both routes spelled out */
const noToken = spawnSync(process.execPath, [SCRIPT], {
  encoding: 'utf8',
  env: { ...process.env, GH_TOKEN: '', GITHUB_TOKEN: '' },
});
const output = `${noToken.stdout || ''}${noToken.stderr || ''}`;
check('exits 4 when no token is available', noToken.status === 4, `exit ${noToken.status}`);
check(
  'prints the token route and the no-token route',
  output.includes('GH_TOKEN=<token>') && output.includes('/fork') && output.includes('--from-git-credential'),
  'both routes shown',
);

/* 6. runtime: --help exits 0 and documents --dry-run */
const help = spawnSync(process.execPath, [SCRIPT, '--help'], { encoding: 'utf8' });
check('--help exits 0', help.status === 0, `exit ${help.status}`);
check('--help documents --dry-run', `${help.stdout}`.includes('--dry-run'), 'documented');

/* report */
let failed = 0;
for (const result of results) {
  const tag = result.passed ? 'PASS' : 'FAIL';
  if (!result.passed) failed += 1;
  console.log(`${tag}  ${result.name}  —  ${result.detail}`);
}
console.log('');
console.log(failed === 0 ? 'All checks pass.' : `${failed} check(s) failed.`);
process.exitCode = failed === 0 ? 0 : 1;
