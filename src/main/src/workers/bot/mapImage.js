// Encodes Minecraft map colour data (128x128 palette indices) as an indexed PNG data URI.
const zlib = require('zlib');

const SIZE = 128;

// Base map colours by id (id 0 is transparent); each id has 4 shades.
// prettier-ignore
const BASE_COLORS = [
  [0, 0, 0], [127, 178, 56], [247, 233, 163], [199, 199, 199], [255, 0, 0], [160, 160, 255],
  [167, 167, 167], [0, 124, 0], [255, 255, 255], [164, 168, 184], [151, 109, 77], [112, 112, 112],
  [64, 64, 255], [143, 119, 72], [255, 252, 245], [216, 127, 51], [178, 76, 216], [102, 153, 216],
  [229, 229, 51], [127, 204, 25], [242, 127, 165], [76, 76, 76], [153, 153, 153], [76, 127, 153],
  [127, 63, 178], [51, 76, 178], [102, 76, 51], [102, 127, 51], [153, 51, 51], [25, 25, 25],
  [250, 238, 77], [92, 219, 213], [74, 128, 255], [0, 217, 58], [129, 86, 49], [112, 2, 0],
  [209, 177, 161], [159, 82, 36], [149, 87, 108], [112, 108, 138], [186, 133, 36], [103, 117, 53],
  [160, 77, 78], [57, 41, 35], [135, 107, 98], [87, 92, 92], [122, 73, 88], [76, 62, 92],
  [76, 50, 35], [76, 82, 42], [142, 60, 46], [37, 22, 16], [189, 48, 49], [148, 63, 97],
  [92, 25, 29], [22, 126, 134], [58, 142, 140], [86, 44, 62], [20, 180, 133], [100, 100, 100],
  [216, 175, 147], [127, 167, 150],
];
const SHADES = [180, 220, 255, 135];

const PLTE = Buffer.alloc(256 * 3);
BASE_COLORS.forEach((rgb, id) =>
  SHADES.forEach((shade, s) =>
    rgb.forEach((c, i) => {
      PLTE[(id * 4 + s) * 3 + i] = Math.floor((c * shade) / 255);
    }),
  ),
);
const TRNS = Buffer.from([0, 0, 0, 0]); // id 0 (all shades) is transparent

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  let crc = 0xffffffff;
  for (const byte of body) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  const out = Buffer.alloc(body.length + 8);
  out.writeUInt32BE(data.length, 0);
  body.copy(out, 4);
  out.writeUInt32BE((crc ^ 0xffffffff) >>> 0, body.length + 4);
  return out;
}

const HEADER = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  // 128x128, 8-bit, colour type 3 (indexed)
  chunk('IHDR', Buffer.from([0, 0, 0, SIZE, 0, 0, 0, SIZE, 8, 3, 0, 0, 0])),
  chunk('PLTE', PLTE),
  chunk('tRNS', TRNS),
]);
const IEND = chunk('IEND', Buffer.alloc(0));

/** @param {Uint8Array} colors 128*128 map colour indices */
function mapToPng(colors) {
  const raw = Buffer.alloc((SIZE + 1) * SIZE);
  for (let y = 0; y < SIZE; y++)
    raw.set(colors.subarray(y * SIZE, (y + 1) * SIZE), y * (SIZE + 1) + 1);
  const png = Buffer.concat([
    HEADER,
    chunk('IDAT', zlib.deflateSync(raw)),
    IEND,
  ]);
  return `data:image/png;base64,${png.toString('base64')}`;
}

module.exports = { mapToPng, MAP_SIZE: SIZE };
