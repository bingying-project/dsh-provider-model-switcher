/**
 * Renders assets/icon-180.png from the same visual language as icon.svg.
 *
 * The plugin market refuses SVG tiles and wants a GitHub-hosted raster image
 * (png/jpg/webp, ~96px display). Nothing in this repo can rely on native image
 * tooling, so this script draws with signed-distance functions at 4x and
 * downsamples — giving clean antialiased edges with zero dependencies.
 *
 * Usage: node scripts/make-icon.cjs [outputPath] [size]
 */
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

/* ---------------------------------------------------------------- *
 * Geometry helpers (signed distance functions, negative = inside)
 * ---------------------------------------------------------------- */

/** Rounded rectangle centred at (cx, cy) with half-extents (hw, hh). */
function sdRoundRect(x, y, cx, cy, hw, hh, r) {
  const qx = Math.abs(x - cx) - (hw - r);
  const qy = Math.abs(y - cy) - (hh - r);
  const ax = Math.max(qx, 0);
  const ay = Math.max(qy, 0);
  return Math.hypot(ax, ay) + Math.min(Math.max(qx, qy), 0) - r;
}

/** Capsule (round-capped line) from (ax, ay) to (bx, by) of radius r. */
function sdCapsule(x, y, ax, ay, bx, by, r) {
  const vx = bx - ax;
  const vy = by - ay;
  const wx = x - ax;
  const wy = y - ay;
  const len2 = vx * vx + vy * vy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, (wx * vx + wy * vy) / len2));
  return Math.hypot(wx - t * vx, wy - t * vy) - r;
}

/* ---------------------------------------------------------------- *
 * PNG encoding (RGBA8, no interlace)
 * ---------------------------------------------------------------- */

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
}

/** Encode raw RGBA bytes into a PNG buffer. */
function encodePng(width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: truecolour + alpha
  ihdr[10] = 0; // deflate
  ihdr[11] = 0; // adaptive filtering
  ihdr[12] = 0; // no interlace

  // Each scanline is prefixed with filter type 0 (None).
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ---------------------------------------------------------------- *
 * Artwork
 * ---------------------------------------------------------------- */

const PALETTE = {
  backdrop: [24, 22, 41], // deep indigo, reads well on light and dark storefronts
  accent: [124, 108, 247], // provider group bar
  glyph: [241, 245, 249], // model rows
  hint: [167, 139, 250], // expand chevron
};

/**
 * Paints one point of the 180x180 design space into `out`.
 * Layers are composited by coverage, not by alpha, because the shapes are
 * opaque — antialiasing comes from supersampling in the caller.
 */
function sample(x, y, out) {
  let colour = null;

  // Backdrop: full-bleed square with soft corners.
  if (sdRoundRect(x, y, 90, 90, 90, 90, 40) <= 0) {
    colour = PALETTE.backdrop;
  }

  // Provider group bar on the left.
  if (sdRoundRect(x, y, 44, 90, 5, 34, 5) <= 0) {
    colour = PALETTE.accent;
  }

  // Three model rows, left-aligned after the bar, decreasing in length.
  const rows = [
    [64, 62, 132],
    [64, 90, 114],
    [64, 118, 96],
  ];
  for (const [x1, yy, x2] of rows) {
    if (sdCapsule(x, y, x1, yy, x2, yy, 7) <= 0) {
      colour = PALETTE.glyph;
    }
  }

  // Expand chevron at the lower right: "this row opens".
  if (sdCapsule(x, y, 116, 112, 128, 124, 4.5) <= 0) {
    colour = PALETTE.hint;
  }
  if (sdCapsule(x, y, 128, 124, 140, 112, 4.5) <= 0) {
    colour = PALETTE.hint;
  }

  if (colour === null) {
    out[0] = 0;
    out[1] = 0;
    out[2] = 0;
    out[3] = 0;
    return;
  }
  out[0] = colour[0];
  out[1] = colour[1];
  out[2] = colour[2];
  out[3] = 255;
}

/** Renders the icon at `size` px using `scale` x supersampling. */
function render(size, scale) {
  const dim = size * scale;
  const rgba = Buffer.alloc(size * size * 4);
  const point = [0, 0, 0, 0];
  const unit = 180 / dim; // design units per subpixel

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;

      for (let sy = 0; sy < scale; sy += 1) {
        for (let sx = 0; sx < scale; sx += 1) {
          sample((x * scale + sx + 0.5) * unit, (y * scale + sy + 0.5) * unit, point);
          const coverage = point[3] / 255;
          // Premultiply so partially covered edge pixels blend correctly.
          r += point[0] * coverage;
          g += point[1] * coverage;
          b += point[2] * coverage;
          a += coverage;
        }
      }

      const total = scale * scale;
      const alpha = a / total;
      const offset = (y * size + x) * 4;
      if (alpha === 0) {
        rgba[offset] = 0;
        rgba[offset + 1] = 0;
        rgba[offset + 2] = 0;
        rgba[offset + 3] = 0;
      } else {
        // Un-premultiply back into straight alpha.
        rgba[offset] = Math.round(r / a);
        rgba[offset + 1] = Math.round(g / a);
        rgba[offset + 2] = Math.round(b / a);
        rgba[offset + 3] = Math.round(alpha * 255);
      }
    }
  }

  return rgba;
}

const size = Number(process.argv[3] || 180);
const output = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(__dirname, '..', 'assets', 'icon-180.png');

fs.mkdirSync(path.dirname(output), { recursive: true });
const png = encodePng(size, size, render(size, 4));
fs.writeFileSync(output, png);

console.log(`wrote ${output} (${size}x${size}, ${png.length} bytes)`);
