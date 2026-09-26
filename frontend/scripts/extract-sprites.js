/**
 * Scans citypack.png and auto-detects sprite bounding boxes by connected
 * components of non-transparent 16x16 tiles. Prints an ASCII occupancy map +
 * a component list (tile rect, size, fill%, top-left GID), and writes each
 * component's exact 2D GID array to scripts/extracted-sprites.json.
 *
 * GID = tileRow*64 + tileCol + 1  (firstgid = 1).
 * Run: node scripts/extract-sprites.js
 */
const fs = require("fs");
const path = require("path");
const { PNG } = require("pngjs");

const TILE = 16;
const COLS = 64; // 1024 / 16
const ROWS = 64;
const ALPHA_MIN = 16; // pixel considered opaque
const OCC_MIN = 0.04; // tile considered occupied if >4% of its pixels opaque

const png = PNG.sync.read(
  fs.readFileSync(path.join(__dirname, "../public/assets/maps/citypack.png")),
);
const { width, height, data } = png; // RGBA

function tileFill(tc, tr) {
  let opaque = 0;
  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      const px = tc * TILE + x;
      const py = tr * TILE + y;
      if (px >= width || py >= height) continue;
      const a = data[(py * width + px) * 4 + 3];
      if (a > ALPHA_MIN) opaque++;
    }
  }
  return opaque / (TILE * TILE);
}

// Occupancy grid
const occ = [];
for (let tr = 0; tr < ROWS; tr++) {
  occ[tr] = [];
  for (let tc = 0; tc < COLS; tc++) occ[tr][tc] = tileFill(tc, tr) > OCC_MIN;
}

// Connected components (4-connectivity)
const comp = Array.from({ length: ROWS }, () => new Array(COLS).fill(-1));
const components = [];
for (let tr = 0; tr < ROWS; tr++) {
  for (let tc = 0; tc < COLS; tc++) {
    if (!occ[tr][tc] || comp[tr][tc] !== -1) continue;
    const id = components.length;
    const cells = [];
    const stack = [[tr, tc]];
    comp[tr][tc] = id;
    let minC = tc, maxC = tc, minR = tr, maxR = tr;
    while (stack.length) {
      const [r, c] = stack.pop();
      cells.push([r, c]);
      minC = Math.min(minC, c); maxC = Math.max(maxC, c);
      minR = Math.min(minR, r); maxR = Math.max(maxR, r);
      for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
        const nr = r + dr, nc = c + dc;
        if (nr < 0 || nc < 0 || nr >= ROWS || nc >= COLS) continue;
        if (occ[nr][nc] && comp[nr][nc] === -1) {
          comp[nr][nc] = id;
          stack.push([nr, nc]);
        }
      }
    }
    const w = maxC - minC + 1, h = maxR - minR + 1;
    components.push({ id, minC, maxC, minR, maxR, w, h, tiles: cells.length, cells });
  }
}

// ASCII occupancy map (rows with any sprite)
let lastRow = 0;
for (let tr = 0; tr < ROWS; tr++) if (occ[tr].some(Boolean)) lastRow = tr;
let header = "    ";
for (let tc = 0; tc < COLS; tc++) header += tc % 10 === 0 ? String((tc / 10) | 0) : " ";
console.log("ASCII occupancy (col tens in header):");
console.log(header);
for (let tr = 0; tr <= lastRow; tr++) {
  let line = String(tr).padStart(3, " ") + " ";
  for (let tc = 0; tc < COLS; tc++) line += occ[tr][tc] ? "#" : "·";
  console.log(line);
}

// Build 2D GID array for a component's bbox (0 for transparent tiles)
function gidGrid(cp) {
  const grid = [];
  for (let r = cp.minR; r <= cp.maxR; r++) {
    const row = [];
    for (let c = cp.minC; c <= cp.maxC; c++) {
      row.push(occ[r][c] ? r * COLS + c + 1 : 0);
    }
    grid.push(row);
  }
  return grid;
}

// Report components (largest first), tag likely type
const big = components.filter((c) => c.tiles >= 3).sort((a, b) => b.tiles - a.tiles);
console.log(`\n${components.length} components; ${big.length} with >=3 tiles:\n`);
const out = {};
for (const c of big) {
  let tag = "misc";
  if (c.w >= 8 && c.h >= 5) tag = "STADIUM/large";
  else if (c.h >= 6 && c.w <= 5 && c.h >= c.w) tag = "TOWER";
  else if (c.h >= 3 && c.w >= 2) tag = "building";
  const topLeftGid = c.minR * COLS + c.minC + 1;
  console.log(
    `#${c.id}  ${tag.padEnd(13)} cols ${c.minC}-${c.maxC} rows ${c.minR}-${c.maxR}  ` +
      `${c.w}x${c.h}  tiles=${c.tiles}  topLeftGID=${topLeftGid}`,
  );
  out[`c${c.id}`] = { tag, rect: { minC: c.minC, maxC: c.maxC, minR: c.minR, maxR: c.maxR }, w: c.w, h: c.h, grid: gidGrid(c) };
}

fs.writeFileSync(
  path.join(__dirname, "extracted-sprites.json"),
  JSON.stringify(out, null, 2),
);
console.log("\nWrote scripts/extracted-sprites.json");
