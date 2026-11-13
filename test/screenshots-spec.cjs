/**
 * Local gate for the storefront screenshots.
 *
 * The site build reads `screenshots.json` beside package.json and silently drops
 * any image it cannot fetch, which means a typo'd path ships as "no screenshots"
 * instead of as an error. This script is the loud version: it checks the shape
 * upstream enforces, then measures the actual bytes on disk.
 *
 * A missing image is a WARN, not a FAIL, so this stays green while the shots are
 * still to be taken. A malformed file, a duplicate, an oversized image or one
 * that is too small to read is a FAIL.
 *
 * Usage: node test/screenshots-spec.cjs
 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const MANIFEST = path.join(ROOT, 'screenshots.json');
const MAX_SHOTS = 8;
const MIN_WIDTH = 900;
const MIN_HEIGHT = 360;
const MAX_BYTES = 2 * 1024 * 1024;

const results = [];
const check = (passed, name, detail) => results.push({ state: passed ? 'PASS' : 'FAIL', name, detail });
const warn = (name, detail) => results.push({ state: 'WARN', name, detail });

/* ------------------------------------------------------------- dimensions */

function pngSize(buffer) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (buffer.length < 24 || !buffer.subarray(0, 8).equals(signature)) return null;
  if (buffer.toString('ascii', 12, 16) !== 'IHDR') return null;
  return { format: 'png', width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

function jpegSize(buffer) {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 9 < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = buffer[offset + 1];
    const length = buffer.readUInt16BE(offset + 2);
    const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSof) {
      return { format: 'jpeg', height: buffer.readUInt16BE(offset + 5), width: buffer.readUInt16BE(offset + 7) };
    }
    offset += 2 + length;
  }
  return null;
}

function webpSize(buffer) {
  if (buffer.length < 30) return null;
  if (buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WEBP') return null;
  const kind = buffer.toString('ascii', 12, 16);
  if (kind === 'VP8X') {
    const width = 1 + (buffer[24] | (buffer[25] << 8) | (buffer[26] << 16));
    const height = 1 + (buffer[27] | (buffer[28] << 8) | (buffer[29] << 16));
    return { format: 'webp', width, height };
  }
  if (kind === 'VP8L') {
    const bits = buffer.readUInt32LE(21);
    return { format: 'webp', width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  }
  if (kind === 'VP8 ') {
    return { format: 'webp', width: buffer.readUInt16LE(26) & 0x3fff, height: buffer.readUInt16LE(28) & 0x3fff };
  }
  return null;
}

function imageSize(buffer) {
  return pngSize(buffer) || jpegSize(buffer) || webpSize(buffer);
}

/* ------------------------------------------------------------------ shape */

if (!fs.existsSync(MANIFEST)) {
  console.log('FAIL  screenshots.json is missing  —  expected beside package.json');
  console.log('\n1 check(s) failed.');
  process.exit(1);
}

let doc;
try {
  doc = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
} catch (error) {
  console.log(`FAIL  screenshots.json is not valid JSON  —  ${error.message}`);
  console.log('\n1 check(s) failed.');
  process.exit(1);
}

// Upstream accepts a bare array, {"screenshots": [...]}, or a single-key map.
let list = null;
if (Array.isArray(doc)) list = doc;
else if (Array.isArray(doc.screenshots)) list = doc.screenshots;
else if (doc && typeof doc === 'object' && Object.keys(doc).length === 1 && Array.isArray(Object.values(doc)[0])) {
  list = Object.values(doc)[0];
}

check(Array.isArray(list), 'manifest shape is one of the three accepted forms', Array.isArray(list) ? `${list.length} image(s)` : 'unrecognised shape');
if (!Array.isArray(list)) {
  for (const result of results) console.log(`${result.state}  ${result.name}  —  ${result.detail}`);
  console.log('\n1 check(s) failed.');
  process.exit(1);
}

check(list.length > 0, 'declares at least one image', `${list.length}`);
check(list.length <= MAX_SHOTS, `declares at most ${MAX_SHOTS} images`, `${list.length}`);

const entries = list.filter((item) => typeof item === 'string' && item.trim() !== '');
check(entries.length === list.length, 'every entry is a non-empty string', `${entries.length}/${list.length}`);
check(new Set(entries).size === entries.length, 'no duplicate paths', `${new Set(entries).size} unique`);

const badPaths = entries.filter((item) => path.isAbsolute(item) || /(^|[\\/])\.\.([\\/]|$)/.test(item) || item.startsWith('~/'));
check(badPaths.length === 0, 'every path is relative and stays inside the repository', badPaths.length === 0 ? 'clean' : badPaths[0]);

/* ------------------------------------------------------------------ files */

let missing = 0;
for (const relative of entries) {
  const absolute = path.join(ROOT, relative.replace(/^\.\//, ''));
  const label = relative.replace(/^\.\//, '');
  if (!fs.existsSync(absolute)) {
    missing += 1;
    warn(`image not committed yet: ${label}`, `see assets/screenshots/README.md`);
    continue;
  }
  const buffer = fs.readFileSync(absolute);
  const size = imageSize(buffer);
  if (!size) {
    check(false, `image format is png/jpeg/webp: ${label}`, 'unrecognised header');
    continue;
  }
  check(buffer.length <= MAX_BYTES, `under ${MAX_BYTES / 1024 / 1024} MiB: ${label}`, `${(buffer.length / 1024).toFixed(0)} KB`);
  check(size.width >= MIN_WIDTH, `${MIN_WIDTH}px+ wide: ${label}`, `${size.format} ${size.width}x${size.height}`);
  check(size.height >= MIN_HEIGHT, `${MIN_HEIGHT}px+ tall: ${label}`, `${size.format} ${size.width}x${size.height}`);
}

/* ----------------------------------------------------------------- report */

let failed = 0;
for (const result of results) {
  if (result.state === 'FAIL') failed += 1;
  console.log(`${result.state}  ${result.name}  —  ${result.detail}`);
}

if (missing === entries.length && entries.length > 0) {
  console.log('');
  console.log(`None of the ${entries.length} declared images exist yet. That is fine until you commit them:`);
  console.log('the site build drops missing images silently rather than failing, so nothing breaks meanwhile.');
  console.log('Capture them per assets/screenshots/README.md, then re-run this script.');
}

console.log('');
console.log(failed === 0 ? 'All checks pass.' : `${failed} check(s) failed.`);
process.exitCode = failed === 0 ? 0 : 1;
