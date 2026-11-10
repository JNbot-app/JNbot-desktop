/**
 * Outline shapes (what the crosshair hits) of blocks whose outline differs
 * from their collision shape, the only shape minecraft-data has: plants,
 * crops, torches (no collision at all) and fences/walls (collision 1.5 high).
 *
 * Since 1.13 flowers and tall plants are moved by a random offset that
 * depends on their position (BlockBehaviour.OffsetType.XZ), which also moves
 * their outline. Shapes are vanilla's; pre-1.13 ones are from memory.
 */
const box = (x1, y1, z1, x2, y2, z2) => [x1 / 16, y1 / 16, z1 / 16, x2 / 16, y2 / 16, z2 / 16];
const FULL = [[0, 0, 0, 1, 1, 1]];
const MAX_HORIZONTAL_OFFSET = 0.25;

const age = (block) => Number(block.getProperties().age ?? block.metadata ?? 0);
const crop = (heights) => (block) => [box(0, 0, 0, 16, heights[age(block)] ?? 16, 16)];
const LEGACY_TORCH_FACING = { 1: 'east', 2: 'west', 3: 'south', 4: 'north' };
const torch = (shapes) => (block) => [shapes[block.getProperties().facing ?? LEGACY_TORCH_FACING[block.metadata]] ?? shapes.up];

/** [name pattern, shape(block), offset by position] */
const MODERN = [
  // Grass is drawn offset, but its outline isn't (checked against a 1.21.11 client; flowers are).
  [/^(short_grass|grass|fern)$/, () => [box(2, 0, 2, 14, 13, 14)]],
  [/^(tall_grass|large_fern|sunflower|lilac|rose_bush|peony)$/, () => FULL, true],
  [/^(dandelion|poppy|blue_orchid|allium|azure_bluet|\w+_tulip|oxeye_daisy|cornflower|lily_of_the_valley|wither_rose|torchflower)$/, () => [box(5, 0, 5, 11, 10, 11)], true],
  [/_sapling$/, () => [box(2, 0, 2, 14, 12, 14)]],
  [/^dead_bush$/, () => [box(2, 0, 2, 14, 13, 14)]],
  [/^sugar_cane$/, () => [box(2, 0, 2, 14, 16, 14)]],
  [/^wheat$/, crop([2, 4, 6, 8, 10, 12, 14, 16])],
  [/^(carrots|potatoes)$/, crop([2, 3, 4, 5, 6, 7, 8, 9])],
  [/^beetroots$/, crop([2, 4, 6, 8])],
  [/^nether_wart$/, crop([5, 8, 11, 14])],
  [/^(brown|red)_mushroom$/, () => [box(5, 0, 5, 11, 6, 11)]],
  [/^(soul_|redstone_)?torch$/, () => [box(6, 0, 6, 10, 10, 10)]],
  [/^(soul_|redstone_)?wall_torch$/, torch({
    north: box(5.5, 3, 11, 10.5, 13, 16),
    south: box(5.5, 3, 0, 10.5, 13, 5),
    west: box(11, 3, 5.5, 16, 13, 10.5),
    east: box(0, 3, 5.5, 5, 13, 10.5),
  })],
];

const LEGACY = [
  [/^(tallgrass|sapling|deadbush)$/, () => [[0.1, 0, 0.1, 0.9, 0.8, 0.9]]],
  [/^(yellow_flower|red_flower)$/, () => [[0.3, 0, 0.3, 0.7, 0.6, 0.7]]],
  [/^double_plant$/, () => FULL],
  [/^reeds$/, () => [[0.125, 0, 0.125, 0.875, 1, 0.875]]],
  [/^(wheat|carrots|potatoes)$/, crop([2, 4, 6, 8, 10, 12, 14, 16])],
  [/^beetroots$/, crop([2, 4, 6, 8])],
  [/^nether_wart$/, crop([5, 8, 11, 14])],
  [/^(brown|red)_mushroom$/, () => [[0.3, 0, 0.3, 0.7, 0.4, 0.7]]],
  [/^(torch|redstone_torch|unlit_redstone_torch)$/, torch({
    up: [0.4, 0, 0.4, 0.6, 0.6, 0.6],
    north: [0.35, 0.2, 0.7, 0.65, 0.8, 1],
    south: [0.35, 0.2, 0, 0.65, 0.8, 0.3],
    west: [0.7, 0.2, 0.35, 1, 0.8, 0.65],
    east: [0, 0.2, 0.35, 0.3, 0.8, 0.65],
  })],
];
// 1.8 crops and nether wart are a quarter block high at every age.
const QUARTER = () => [[0, 0, 0, 1, 0.25, 1]];
const V1_8 = [[/^(wheat|carrots|potatoes|nether_wart)$/, QUARTER]];

/** Mth.getSeed: the position's seed for random block offsets. */
function seed(x, y, z) {
  let i = BigInt(Math.imul(x, 3129871)) ^ (BigInt(z) * 116129781n) ^ BigInt(y);
  i = BigInt.asIntN(64, i * i * 42317861n + i * 11n);
  return i >> 16n;
}

/** BlockBehaviour.BlockStateBase.getOffset for OffsetType.XZ */
function offsetOf({ x, z }) {
  const s = seed(x, 0, z);
  const horizontal = (shift) => {
    const part = Math.fround(Number((s >> BigInt(shift)) & 15n) / 15);
    return Math.min(MAX_HORIZONTAL_OFFSET, Math.max(-MAX_HORIZONTAL_OFFSET, (part - 0.5) * 0.5));
  };
  return [horizontal(0), horizontal(8)];
}

function createOutlines(registry) {
  const modern = registry.version['>=']('1.13');
  const table = modern ? MODERN : registry.version['<']('1.9') ? [...V1_8, ...LEGACY] : LEGACY;
  const cache = new Map(); // block name → table row or null

  /** The block's outline when it differs from its collision shape, else undefined. */
  return function outlineOf(block) {
    if (!cache.has(block.name)) cache.set(block.name, table.find(([pattern]) => pattern.test(block.name)) ?? null);
    const row = cache.get(block.name);
    if (row) {
      const [, shape, offset] = row;
      const shapes = shape(block);
      if (!offset) return shapes;
      const [dx, dz] = offsetOf(block.position);
      return shapes.map(([x1, y1, z1, x2, y2, z2]) => [x1 + dx, y1, z1 + dz, x2 + dx, y2, z2 + dz]);
    }
    // Fences, walls and fence gates collide 1.5 blocks high but are outlined 1 block high.
    if (/fence|(^|_)wall$/.test(block.name) && block.shapes.some((s) => s[4] > 1))
      return block.shapes.map((s) => [s[0], s[1], s[2], s[3], Math.min(s[4], 1), s[5]]);
    return undefined;
  };
}

module.exports = { createOutlines };
