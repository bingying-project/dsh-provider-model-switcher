/**
 * Reproduce dsh-plugin-manager's parseInstallSpec() against candidate inputs.
 *
 * The four patterns and the branch order are copied verbatim from
 * dsh-plugin-manager/lib/index.js (extracted from the running app.asar), so a
 * verdict here matches what the Plugins page will actually do.
 */
const GIT_SHORTHAND = /^(?:github|gitlab|bitbucket|gist):/i;
const GIT_URL = /^git(?:\+[a-z]+)?:\/\/|^git@[^:]+:/i;
const HOSTED_REPOSITORY_URL = /^https?:\/\/[^/]+\/[^/]+\/[^/#]+(?:\.git)?(?:#.*)?$/i;
const TARBALL_SPEC = /\.(?:tgz|tar\.gz)(?:#.*)?$/i;
const PACKAGE_NAME = /^(?:@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/;
const PACKAGE_NAME_MAX_LENGTH = 214;
const isAbsolute = (p) => /^[a-zA-Z]:[\\/]/.test(p) || p.startsWith('/');

function parseInstallSpec(raw) {
  const spec = raw.trim();
  if (spec === '') throw new Error('the package spec must not be empty');
  const path = spec.replace(/^(?:file|link):/, '');
  if (path !== spec || isAbsolute(path)) {
    if (!isAbsolute(path)) throw new Error('a local path must be absolute');
    return TARBALL_SPEC.test(path) ? { kind: 'tarball' } : { kind: 'path' };
  }
  if (/^\.{1,2}(?:[\\/]|$)/.test(spec)) throw new Error('a local path must be absolute');
  if ((GIT_SHORTHAND.test(spec) || GIT_URL.test(spec) || HOSTED_REPOSITORY_URL.test(spec)) && !TARBALL_SPEC.test(spec)) {
    return { kind: 'git' };
  }
  if (/^https?:\/\//i.test(spec)) {
    if (TARBALL_SPEC.test(spec)) return { kind: 'tarball' };
    throw new Error('a URL must point at a git repository or a tarball');
  }
  const at = spec.indexOf('@', 1);
  const name = at === -1 ? spec : spec.slice(0, at);
  const range = at === -1 ? undefined : spec.slice(at + 1);
  if (name.length > PACKAGE_NAME_MAX_LENGTH || !PACKAGE_NAME.test(name)) {
    throw new Error('not a package name the registry accepts');
  }
  if (range === '') throw new Error('a version after @ must not be empty');
  return { kind: 'registry' };
}

const REPO = 'yangbingying/dsh-provider-model-switcher';
const cases = [
  ['github:' + REPO, 'git'],
  ['github:' + REPO + '#v1.0.0', 'git'],
  ['https://github.com/' + REPO, 'git'],
  ['https://github.com/' + REPO + '.git', 'git'],
  ['https://github.com/' + REPO + '#v1.0.0', 'git'],
  ['git+https://github.com/' + REPO + '.git', 'git'],
  ['git@github.com:' + REPO + '.git', 'git'],
  ['gitlab:' + REPO, 'git'],
  ['https://gitee.com/' + REPO, 'git'],
  // Documented as rejected: a bare repository shorthand.
  [REPO, 'ERROR'],
  ['https://github.com/yangbingying', 'ERROR'],
  // For contrast: what a plain registry package looks like.
  ['dsh-provider-model-switcher', 'registry'],
  ['dsh-provider-model-switcher@1.0.0', 'registry'],
  ['D:\\tmp\\pkg.tgz', 'tarball'],
];

let failed = 0;
for (const [input, expected] of cases) {
  let actual;
  try {
    actual = parseInstallSpec(input).kind;
  } catch (error) {
    actual = 'ERROR';
  }
  const ok = actual === expected;
  if (!ok) failed += 1;
  console.log((ok ? 'PASS  ' : 'FAIL  ') + actual.padEnd(8) + ' <- ' + input + (ok ? '' : '   (expected ' + expected + ')'));
}
console.log(failed === 0 ? '\nAll spec forms behave as documented.' : '\n' + failed + ' case(s) diverged.');
process.exit(failed === 0 ? 0 : 1);
