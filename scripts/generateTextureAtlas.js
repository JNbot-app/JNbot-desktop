#!/usr/bin/env node
/*
 * Generates the 2D-map texture atlas (.png) and block-id -> tile-index map (.json)
 * consumed by src/renderer/components/bot/tabs/map.
 *
 * Block ids come from `minecraft-data` (matches what the bot sends via
 * chunk.getBlockType). Textures come from the downloaded PrismarineJS
 * minecraft-assets repo. For a top-down map we prefer the "up" face of each
 * block (<name>_top.png) and fall back to the asset's representative texture.
 *
 * Requirements: ImageMagick (`magick` on PATH).
 *
 * Usage:
 *   node scripts/generateTextureAtlas.js [mcDataVersion] [assetsVersion] [outName]
 *   node scripts/generateTextureAtlas.js                 # 1.21.11 -> blocks-1.21.*
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { execFileSync } = require('child_process');

const MC_VERSION = process.argv[2] || '1.21.11';
const ASSETS_VERSION = process.argv[3] || MC_VERSION;
const OUT_NAME = process.argv[4] || MC_VERSION.split('.').slice(0, 2).join('.');

const COLS = 32; // tiles per atlas row (renderer derives this from image width)
const TILE = 16;

// Minecraft ships grass/foliage/water as grayscale and tints them per-biome at
// runtime. For a static map we bake in a sensible default tint, keyed by the
// resolved texture file name. Birch/spruce use their own fixed colors in-game.
const GRASS = '#7CBD6B';
const FOLIAGE = '#59AE30';
const WATER = '#4067C9';
const TINTS = {
  grass_block_top: GRASS,
  short_grass: GRASS,
  fern: GRASS,
  large_fern: GRASS,
  tall_grass: GRASS,
  sugar_cane: GRASS,
  oak_leaves: FOLIAGE,
  jungle_leaves: FOLIAGE,
  acacia_leaves: FOLIAGE,
  dark_oak_leaves: FOLIAGE,
  pale_oak_leaves: FOLIAGE,
  mangrove_leaves: FOLIAGE,
  cherry_leaves: FOLIAGE,
  azalea_leaves: FOLIAGE,
  flowering_azalea_leaves: FOLIAGE,
  vine: FOLIAGE,
  lily_pad: FOLIAGE,
  spruce_leaves: '#619961',
  birch_leaves: '#80A755',
  water_still: WATER,
};

const APP_ROOT = path.resolve(__dirname, '..');
const REPO_ROOT = path.resolve(APP_ROOT, '..');
const ASSETS_DIR = path.join(REPO_ROOT, 'item_mapping/minecraft-assets/data', ASSETS_VERSION);
const BLOCKS_DIR = path.join(ASSETS_DIR, 'blocks');
const BLOCK_TEXTURES_JSON = path.join(ASSETS_DIR, 'blocks_textures.json');
const MCDATA_BLOCKS = path.join(
  APP_ROOT,
  'node_modules/minecraft-data/minecraft-data/data/pc',
  MC_VERSION,
  'blocks.json.gz',
);
const OUT_DIR = path.join(APP_ROOT, 'src/renderer/assets/blockTextures');
const OUT_PNG = path.join(OUT_DIR, `blocks-${OUT_NAME}.png`);
const OUT_JSON = path.join(OUT_DIR, `texture-map-${OUT_NAME}.json`);

function fail(msg) {
  console.error(`\n[generateTextureAtlas] ${msg}\n`);
  process.exit(1);
}

function checkMagick() {
  try {
    execFileSync('magick', ['-version'], { stdio: 'ignore' });
  } catch {
    fail('ImageMagick not found. Install it (e.g. `brew install imagemagick`).');
  }
}

function loadBlocks() {
  if (!fs.existsSync(MCDATA_BLOCKS)) {
    fail(`minecraft-data blocks not found for ${MC_VERSION}: ${MCDATA_BLOCKS}`);
  }
  return JSON.parse(zlib.gunzipSync(fs.readFileSync(MCDATA_BLOCKS)));
}

// "minecraft:blocks/stone" | "blocks/dirt" | "minecraft:missingno" -> "stone" | "dirt" | null
function textureFieldToName(field) {
  if (!field) return null;
  const seg = field.replace(/^minecraft:/, '').split('/').pop();
  return seg && seg !== 'missingno' ? seg : null;
}

function texExists(name) {
  return !!name && fs.existsSync(path.join(BLOCKS_DIR, `${name}.png`));
}

function main() {
  checkMagick();
  if (!fs.existsSync(BLOCKS_DIR)) fail(`assets blocks dir missing: ${BLOCKS_DIR}`);
  if (!fs.existsSync(BLOCK_TEXTURES_JSON)) fail(`missing: ${BLOCK_TEXTURES_JSON}`);

  const blocks = loadBlocks();
  const nameToField = {};
  for (const e of JSON.parse(fs.readFileSync(BLOCK_TEXTURES_JSON, 'utf8'))) {
    nameToField[e.name] = e.texture;
  }

  const AIR = new Set(['air', 'cave_air', 'void_air']);
  const resolve = (name) => {
    if (texExists(`${name}_top`)) return `${name}_top`; // best for top-down view
    const field = textureFieldToName(nameToField[name]);
    if (texExists(field)) return field;
    if (texExists(name)) return name;
    return null;
  };

  // Tile 0 is reserved as fully transparent (used for air and unknown blocks).
  const tiles = ['__transparent__'];
  const texToIndex = new Map();
  const blockMap = {};
  const unresolved = [];

  for (const b of blocks) {
    if (AIR.has(b.name)) {
      blockMap[b.id] = 0;
      continue;
    }
    const tex = resolve(b.name);
    if (!tex) {
      unresolved.push(b.name);
      continue; // renderer defaults missing ids to tile 0
    }
    let idx = texToIndex.get(tex);
    if (idx === undefined) {
      idx = tiles.length;
      tiles.push(tex);
      texToIndex.set(tex, idx);
    }
    blockMap[b.id] = idx;
  }

  // Render each tile to a normalized 16x16 png in a temp dir.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-atlas-'));
  const tileFiles = [];
  for (let i = 0; i < tiles.length; i++) {
    const out = path.join(tmp, `${String(i).padStart(5, '0')}.png`);
    tileFiles.push(out);
    if (tiles[i] === '__transparent__') {
      execFileSync('magick', ['-size', `${TILE}x${TILE}`, 'xc:none', out]);
      continue;
    }
    const src = path.join(BLOCKS_DIR, `${tiles[i]}.png`);
    const w = parseInt(execFileSync('magick', ['identify', '-format', '%w', src]).toString(), 10);
    const tint = TINTS[tiles[i]];
    // Crop the top wxw square (frame 0 of animated strips), optionally bake in a
    // biome tint (multiply by a solid color, preserving alpha), then scale to 16x16.
    const args = [src, '-background', 'none', '-alpha', 'on', '-crop', `${w}x${w}+0+0`, '+repage'];
    if (tint) {
      // Some tintable textures (e.g. grass_block_top) ship as grayscale; force
      // sRGB so the tint color isn't collapsed to gray.
      args.push('-colorspace', 'sRGB', '-type', 'TrueColorAlpha');
      args.push('(', '+clone', '-fill', tint, '-colorize', '100', ')', '-compose', 'multiply', '-composite');
    }
    args.push('-filter', 'point', '-resize', `${TILE}x${TILE}!`, out);
    execFileSync('magick', args);
  }

  // Assemble the atlas: COLS tiles per row, no spacing, transparent background.
  execFileSync('magick', [
    'montage',
    ...tileFiles,
    '-tile', `${COLS}x`,
    '-geometry', `${TILE}x${TILE}+0+0`,
    '-background', 'none',
    '-mode', 'concatenate',
    OUT_PNG,
  ]);

  fs.writeFileSync(OUT_JSON, JSON.stringify({ version: MC_VERSION, textures: blockMap }));
  fs.rmSync(tmp, { recursive: true, force: true });

  const atlasW = parseInt(execFileSync('magick', ['identify', '-format', '%w', OUT_PNG]).toString(), 10);
  console.log(`Blocks: ${blocks.length}  mapped: ${Object.keys(blockMap).length}  unresolved: ${unresolved.length}`);
  console.log(`Unique tiles: ${tiles.length}  atlas: ${OUT_PNG} (${atlasW}px wide, ${atlasW / TILE} per row)`);
  console.log(`JSON: ${OUT_JSON}`);
  if (unresolved.length) {
    console.log(`No texture for ${unresolved.length} blocks (render as transparent), e.g.: ${unresolved.slice(0, 15).join(', ')}`);
  }
}

main();
