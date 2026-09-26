/**
 * Stamps real landmark sprites (skyscrapers, mid-rises, a stadium) ONTO the
 * existing dense city map, preserving its full density. Operates on
 * public/assets/maps/citypack-city.json in place.
 *
 * Sprite GIDs were extracted exactly from citypack.png (scripts/extract-sprites.js),
 * so they render correctly. Run AFTER restoring the original map:
 *   git checkout <orig> -- public/assets/maps/citypack-city.json
 *   node scripts/stamp-landmarks.js
 */
const fs = require("fs");
const path = require("path");

const W = 100;
const H = 80;
const ROAD_GIDS = new Set([2436, 2438, 2440]);

// ─── Real sprites (exact GIDs) ───────────────────────────────────────────────
const SKYSCRAPER = [
  [0, 147, 148, 149, 0],
  [0, 211, 212, 213, 0],
  [0, 275, 276, 277, 0],
  [338, 339, 340, 341, 342],
  [402, 403, 404, 405, 406],
  [466, 467, 468, 469, 470],
];
const MIDRISE1 = [[984, 985, 0], [1048, 1049, 1050], [1112, 1113, 1114], [0, 1177, 0], [0, 1241, 0]];
const MIDRISE2 = [[988, 989, 0], [1052, 1053, 1054], [1116, 1117, 1118], [0, 1181, 0], [0, 1245, 0]];
const MIDRISE3 = [[992, 993, 0], [1056, 1057, 1058], [1120, 1121, 1122], [0, 1185, 0], [0, 1249, 0]];
const BLOCKBLD = [[653, 654, 655, 656], [717, 718, 719, 720], [781, 782, 783, 784], [845, 846, 847, 848]];
const STADIUM = [
  [173, 174, 175, 176, 177, 178, 179, 180, 181, 182, 183, 184],
  [237, 238, 239, 240, 241, 242, 243, 244, 245, 246, 247, 248],
  [301, 302, 303, 304, 305, 306, 307, 308, 309, 310, 311, 312],
  [365, 366, 367, 368, 369, 370, 371, 372, 373, 374, 375, 376],
  [429, 430, 431, 432, 433, 434, 435, 436, 437, 438, 439, 440],
  [493, 494, 495, 496, 497, 498, 499, 500, 501, 502, 503, 504],
  [557, 558, 559, 560, 561, 562, 563, 564, 565, 566, 567, 568],
];

const mapPath = path.join(__dirname, "../public/assets/maps/citypack-city.json");
const map = JSON.parse(fs.readFileSync(mapPath, "utf8"));
const terrain = map.layers.find((l) => l.name === "Terrain").data;
const objects = map.layers.find((l) => l.name === "Objects").data;

const TREES = new Set([2073, 2137, 2075, 2139]);
const countBuildings = () =>
  objects.filter((x) => x !== 0 && !TREES.has(x)).length;
const before = countBuildings();

const isRoad = (c, r) => ROAD_GIDS.has(terrain[r * W + c]);

// Overwrite the sprite's bbox (non-road cells); 0 cells clear to grass so the
// sprite's transparent edges look clean.
function stamp(grid, col, row, label) {
  let painted = 0;
  for (let dr = 0; dr < grid.length; dr++) {
    for (let dc = 0; dc < grid[dr].length; dc++) {
      const c = col + dc;
      const r = row + dr;
      if (c < 0 || r < 0 || c >= W || r >= H || isRoad(c, r)) continue;
      objects[r * W + c] = grid[dr][dc] || 0;
      if (grid[dr][dc]) painted++;
    }
  }
  console.log(`  stamped ${label} at (${col},${row}) — ${painted} tiles`);
}

// ─── Downtown skyline (GOVT zone ≈ cols 28-53, rows 12-37) ───────────────────
console.log("Stamping landmarks:");
stamp(SKYSCRAPER, 29, 13, "skyscraper");
stamp(MIDRISE1, 35, 14, "mid-rise");
stamp(SKYSCRAPER, 43, 13, "skyscraper");
stamp(BLOCKBLD, 49, 14, "block tower");
stamp(MIDRISE2, 29, 28, "mid-rise");
stamp(SKYSCRAPER, 35, 27, "skyscraper");
stamp(MIDRISE3, 43, 28, "mid-rise");
stamp(BLOCKBLD, 49, 28, "block tower");
// ─── Stadium landmark (large right-side block) ───────────────────────────────
stamp(STADIUM, 74, 42, "STADIUM");

fs.writeFileSync(mapPath, JSON.stringify(map));
const after = countBuildings();
console.log(`\nBuilding tiles: ${before} → ${after} (${after - before >= 0 ? "+" : ""}${after - before})`);
console.log("Wrote", path.relative(process.cwd(), mapPath));
