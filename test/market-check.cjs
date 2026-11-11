/**
 * Pre-flight check for the awesome-dsh-plugin submission.
 *
 * Mirrors what the upstream CI verifies, so a failing check is caught here
 * instead of in review: bundle manifest, repository age, the `dsh-plugin`
 * topic, the entry file itself, and the optional storefront icon.
 *
 * Usage: node test/market-check.cjs
 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const ENTRY_DIR = path.join(ROOT, 'market');

const CATEGORIES = new Set([
  'agi', 'ui', 'usage', 'theme', 'model', 'identity', 'session', 'memory', 'tools',
  'wsl', 'browser', 'vision', 'voice', 'docs', 'skill', 'workflow', 'git', 'notify',
  'dev', 'security', 'remote', 'market', 'fun',
]);

const RASTER = /\.(?:png|jpe?g|webp)$/i;
const results = [];

function record(ok, name, detail) {
  results.push({ ok, name, detail });
}

function warn(name, detail) {
  results.push({ ok: null, name, detail });
}

/** Files under market/ that look like entries rather than notes. */
function entryFiles() {
  if (!fs.existsSync(ENTRY_DIR)) return [];
  return fs.readdirSync(ENTRY_DIR).filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'));
}

/** Minimal front-matter reader: these entries are flat key/value YAML. */
function parseEntry(text) {
  const entry = { description: {} };
  let section = null;
  for (const line of text.split(/\r?\n/)) {
    if (/^\s*#/.test(line) || line.trim() === '') continue;
    const nested = line.match(/^\s{2}(\w+):\s*(.*)$/);
    if (nested && section === 'description') {
      entry.description[nested[1]] = strip(nested[2]);
      continue;
    }
    const top = line.match(/^(\w+):\s*(.*)$/);
    if (!top) continue;
    const [, key, value] = top;
    if (value === '') {
      section = key;
      continue;
    }
    section = null;
    entry[key] = strip(value);
  }
  return entry;
}

/** Removes surrounding quotes and inline comments from a scalar. */
function strip(raw) {
  let value = raw.trim();
  if (/^'.*'$/.test(value) || /^".*"$/.test(value)) {
    value = value.slice(1, -1);
  } else {
    const hash = value.search(/\s#/);
    if (hash !== -1) value = value.slice(0, hash).trim();
  }
  return value;
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: { 'user-agent': 'dsh-provider-model-switcher-market-check' },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

async function main() {
  const localPackage = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

  /* ---------------------------------------------------------------- *
   * Local: the manifest the CI reads from the repository
   * ---------------------------------------------------------------- */
  const bundle = localPackage.dsh && localPackage.dsh.bundle;
  record(
    Boolean(bundle && bundle.patch),
    'package.json declares dsh.bundle.patch',
    bundle ? `patch = ${bundle.patch}` : 'missing — a client-only manifest is not installable',
  );

  const patchPath = bundle && bundle.patch ? path.join(ROOT, bundle.patch) : null;
  record(
    Boolean(patchPath && fs.existsSync(patchPath)),
    'cordis.patch.yml exists next to package.json',
    patchPath ? path.relative(ROOT, patchPath) : 'no patch declared',
  );

  if (patchPath && fs.existsSync(patchPath)) {
    const patch = fs.readFileSync(patchPath, 'utf8');
    record(
      patch.includes(localPackage.name),
      'cordis.patch.yml inserts the real package name',
      patch.includes(localPackage.name) ? localPackage.name : 'name mismatch — auto-enable would fail',
    );
  }

  /* ---------------------------------------------------------------- *
   * Local: the entry file
   * ---------------------------------------------------------------- */
  const files = entryFiles();
  record(files.length >= 1 && files.length <= 3, 'at most 3 entries per PR', `${files.length} file(s) in market/`);

  for (const file of files) {
    const label = `entry ${file}`;
    const base = path.basename(file).replace(/\.ya?ml$/, '');

    record(/^[^_]+__.+$/.test(base), `${label}: filename is <owner>__<repo>`, base);

    const entry = parseEntry(fs.readFileSync(path.join(ENTRY_DIR, file), 'utf8'));

    record(Boolean(entry.url), `${label}: url present`, entry.url || 'missing');
    record(
      entry.url === `https://github.com/${entry.name}`,
      `${label}: url matches name`,
      `${entry.url} vs ${entry.name}`,
    );

    const expectedBase = `${entry.name || ''}`.replace('/', '__');
    record(base === expectedBase, `${label}: filename matches name`, `expected ${expectedBase}.yml`);

    record(CATEGORIES.has(entry.category), `${label}: category is valid`, entry.category || 'missing');

    const en = entry.description && entry.description.en;
    record(Boolean(en), `${label}: description.en present`, en ? `${en.length} chars` : 'missing');
    if (en) {
      record(/[.!?]$/.test(en.trim()), `${label}: description.en ends with a period`, en.slice(-12));
      record(en.length <= 200, `${label}: description.en is one line`, `${en.length} chars`);
      const marketing = /\b(?:powerful|amazing|best|ultimate|revolutionary|seamless|blazing)\b/i;
      record(!marketing.test(en), `${label}: description.en avoids marketing words`, marketing.test(en) ? 'found one' : 'clean');
    }
    if (entry.description && entry.description.zh) {
      record(/[。！？]$/.test(entry.description.zh.trim()), `${label}: description.zh ends with a period`, 'ok');
    }

    if (entry.icon) {
      record(RASTER.test(entry.icon), `${label}: icon is a raster image`, entry.icon.split('.').pop());
      record(
        entry.icon.startsWith('https://raw.githubusercontent.com/') || entry.icon.startsWith('https://github.com/'),
        `${label}: icon is GitHub-hosted`,
        new URL(entry.icon).host,
      );
    } else {
      warn(`${label}: icon omitted`, 'storefront falls back to the owner avatar');
    }

    /* -------------------------------------------------------------- *
     * Remote: what CI fetches
     * -------------------------------------------------------------- */
    const repoPath = entry.name || '';
    if (!/^[^/]+\/[^/]+$/.test(repoPath)) continue;

    try {
      const repo = await fetchJson(`https://api.github.com/repos/${repoPath}`);

      const hours = (Date.now() - new Date(repo.created_at).getTime()) / 3600000;
      record(hours >= 24, `${label}: repository is at least 1 day old`, `${hours.toFixed(1)} h`);
      if (hours < 24) {
        warn(`${label}: resubmit after`, new Date(new Date(repo.created_at).getTime() + 86400000).toISOString());
      }

      record(!repo.archived, `${label}: repository is not archived`, repo.archived ? 'archived' : 'active');
      record(
        Array.isArray(repo.topics) && repo.topics.includes('dsh-plugin'),
        `${label}: repo has the dsh-plugin topic`,
        JSON.stringify(repo.topics || []),
      );

      // The manifest CI reads from the default branch, not from this checkout.
      const raw = `https://raw.githubusercontent.com/${repoPath}/${repo.default_branch}/package.json`;
      const remotePackage = await fetchJson(raw);
      record(
        Boolean(remotePackage.dsh && remotePackage.dsh.bundle && remotePackage.dsh.bundle.patch),
        `${label}: remote package.json declares dsh.bundle.patch`,
        remotePackage.dsh && remotePackage.dsh.bundle ? remotePackage.dsh.bundle.patch : 'missing',
      );
      record(
        remotePackage.name === localPackage.name && remotePackage.version === localPackage.version,
        `${label}: remote package matches this checkout`,
        `${remotePackage.name}@${remotePackage.version} vs ${localPackage.name}@${localPackage.version}`,
      );
    } catch (error) {
      warn(`${label}: remote checks skipped`, error.message);
    }
  }

  /* ---------------------------------------------------------------- *
   * Report
   * ---------------------------------------------------------------- */
  let failed = 0;
  for (const { ok, name, detail } of results) {
    const tag = ok === null ? 'WARN' : ok ? 'PASS' : 'FAIL';
    if (ok === false) failed += 1;
    console.log(`${tag}  ${name}  —  ${detail}`);
  }
  console.log();
  console.log(failed === 0 ? 'All blocking checks pass.' : `${failed} blocking check(s) failed.`);
  process.exitCode = failed === 0 ? 0 : 1;
}

main().catch((error) => {
  console.error('check crashed:', error);
  process.exitCode = 1;
});
