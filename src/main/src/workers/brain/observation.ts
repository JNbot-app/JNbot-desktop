/**
 * The observation contract shared by recording (JNbot Client) and runtime
 * (mineflayer bot). Both adapters produce the same plain {@link Snapshot};
 * {@link Observer} turns consecutive snapshots into a {@link BrainObservation}
 * (velocities + bot-relative fields). Because recordings store snapshots, not
 * features, users can change their features and retrain without re-recording.
 *
 * Angles use mineflayer's convention: radians, yaw 0 = north (-Z), increasing
 * counter-clockwise; pitch positive = looking up.
 */
import type { Bot } from 'mineflayer';
import minecraftData from 'minecraft-data';
import type {
  IMcClient,
  McEntityInfo,
  McItemStack,
} from '../../../../common/types/McClientApi';
import type {
  BrainBlock as BlockInfo,
  BrainBlockTarget,
  BrainEntity,
  BrainObservation,
  BrainObserveOptions as ObserveOptions,
} from '../../../../common/types/brainApi';
import {
  toMineflayerPitch,
  toMineflayerYaw,
} from '../../../../common/automation';

interface SnapshotSelf {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  health: number;
  food: number;
  onGround: boolean;
  sprinting: boolean;
  sneaking: boolean;
  usingItem: boolean;
  held: string;
  offHand: string;
  /** inventory item counts by name (missing in recordings made before it existed) */
  items?: Record<string, number>;
}

interface SnapshotEntity {
  id: number;
  type: string;
  player: boolean;
  x: number;
  y: number;
  z: number;
  yaw: number;
  health: number;
  held: string;
  state?: BlockInfo['state'];
}

/** block cube: origin (floored player pos), radius, height and the blocks in y, z, x order */
interface Cube {
  o: [number, number, number];
  r: number;
  h: number;
}

export interface Snapshot {
  t: number;
  self: SnapshotSelf;
  entities: SnapshotEntity[];
  /** the view around you, as palette indices */
  blocks: Cube & { c: number[] };
  /** the far view, every {@link FAR_MS}: runs of [palette index, count] */
  far?: Cube & { runs: number[] };
}

export const DEFAULT_OBSERVE: Required<ObserveOptions> = {
  entityRadius: 32,
  blockRadius: 8,
  blockHeight: 6,
  farRadius: 32,
  farHeight: 6,
};

/** how often the far view is taken: things far away can wait a moment */
const FAR_MS = 3000;

/** eye height when standing: reach is measured from the eyes */
const EYE_HEIGHT = 1.62;

const shortName = (name: string | undefined) =>
  (name ?? '').replace(/^.*[:.]/, '');
const itemName = (stack: McItemStack | undefined) =>
  stack && !stack.empty ? shortName(stack.itemId) : '';

function countItems(items: { name: string; count: number }[]) {
  const counts: Record<string, number> = {};
  for (const { name, count } of items)
    counts[name] = (counts[name] ?? 0) + count;
  return counts;
}

/** target id of a block: its world position */
export const blockId = (x: number, y: number, z: number) =>
  `${Math.floor(x)},${Math.floor(y)},${Math.floor(z)}`;

/** block properties with numbers and booleans parsed (the client reports strings), undefined when none */
function blockState(
  state: Record<string, unknown> | undefined,
): BlockInfo['state'] {
  if (!state) return undefined;
  const out: NonNullable<BlockInfo['state']> = {};
  for (const [key, value] of Object.entries(state)) {
    const text = String(value);
    out[key] =
      text === 'true' || text === 'false'
        ? text === 'true'
        : text !== '' && Number.isFinite(+text)
          ? +text
          : text;
  }
  return Object.keys(out).length ? out : undefined;
}

/**
 * A mob's synced values by name (`#16` names come from minecraft-data's
 * `metadataKeys`), without health (a field of its own) and 0/false values:
 * the client only reports values that differ from the defaults, mineflayer
 * whatever the server sent, so both leave the usual defaults out.
 */
function entityState(
  data: Record<string, unknown> | undefined,
  keys: string[] | undefined,
): BlockInfo['state'] {
  const out: NonNullable<BlockInfo['state']> = {};
  for (const [key, value] of Object.entries(data ?? {})) {
    if ((typeof value !== 'number' && typeof value !== 'boolean') || !value)
      continue;
    const name = key.startsWith('#') ? (keys?.[+key.slice(1)] ?? key) : key;
    if (name !== 'health') out[name] = value;
  }
  return Object.keys(out).length ? out : undefined;
}

/** Block palette: snapshots reference blocks by index to stay small. One per stream of snapshots. */
export class Palette {
  readonly blocks: BlockInfo[] = [];

  /** when this stream last took the far view */
  #farAt = -Infinity;

  /** true (and restarts the wait) when the far view is due */
  farDue(t: number): boolean {
    if (t - this.#farAt < FAR_MS) return false;
    this.#farAt = t;
    return true;
  }

  #index = new Map<string, number>();

  index(block: BlockInfo): number {
    const state = block.state
      ? Object.entries(block.state)
          .map(([k, v]) => `${k}=${v}`)
          .join(',')
      : '';
    const key = `${block.name}|${+block.solid}${+block.liquid}|${state}`;
    let i = this.#index.get(key);
    if (i === undefined) {
      i = this.blocks.push(block) - 1;
      this.#index.set(key, i);
    }
    return i;
  }
}

const AIR: BlockInfo = { name: 'air', solid: false, liquid: false };

/** palette indices of a cube, in y, z, x order */
function blockCube(
  o: [number, number, number],
  r: number,
  h: number,
  index: (x: number, y: number, z: number) => number,
) {
  const c: number[] = [];
  for (let dy = -h; dy <= h; dy++)
    for (let dz = -r; dz <= r; dz++)
      for (let dx = -r; dx <= r; dx++) c.push(index(o[0] + dx, o[1] + dy, o[2] + dz));
  return { o, r, h, c };
}

function fromRuns<T extends number[] | Uint16Array>(
  runs: ArrayLike<number>,
  out: T,
): T {
  let i = 0;
  for (let k = 0; k < runs.length; k += 2)
    for (let n = runs[k + 1]; n > 0; n--) out[i++] = runs[k];
  return out;
}

/** runs of [value, count] */
function toRuns(c: number[]) {
  const runs: number[] = [];
  for (const v of c)
    if (runs[runs.length - 2] === v) runs[runs.length - 1]++;
    else runs.push(v, 1);
  return runs;
}

export function snapshotBot(
  bot: Bot,
  options: ObserveOptions,
  palette: Palette,
): Snapshot {
  const { entityRadius, blockRadius, blockHeight, farRadius, farHeight } = {
    ...DEFAULT_OBSERVE,
    ...options,
  };
  const me = bot.entity;
  const pos = me.position;
  const entities: SnapshotEntity[] = [];
  for (const e of Object.values(bot.entities)) {
    if (e === me || e.position.distanceTo(pos) > entityRadius) continue;
    entities.push({
      id: e.id,
      type: shortName(e.name),
      player: e.type === 'player',
      x: e.position.x,
      y: e.position.y,
      z: e.position.z,
      yaw: e.yaw,
      health: typeof e.health === 'number' ? e.health : NaN,
      held: e.heldItem?.name ?? '',
      state: entityState(
        Object.fromEntries(
          Object.entries(e.metadata ?? {}).map(([i, v]) => [`#${i}`, v]),
        ),
        bot.registry.entitiesByName[e.name ?? '']?.metadataKeys,
      ),
    });
  }
  const o: [number, number, number] = [
    Math.floor(pos.x),
    Math.floor(pos.y),
    Math.floor(pos.z),
  ];
  const cursor = pos.floored();
  // the palette index per block state, so the far view doesn't build a block per position
  const indices = new Map<number, number>();
  const index = (x: number, y: number, z: number) => {
    cursor.set(x, y, z);
    const id = bot.world.getBlockStateId(cursor);
    let i = indices.get(id);
    if (i === undefined) {
      const block = bot.blockAt(cursor);
      i = palette.index(
        block
          ? {
              name: block.name,
              solid: block.boundingBox === 'block',
              liquid: block.name === 'water' || block.name === 'lava',
              state: blockState(block.getProperties()),
            }
          : AIR,
      );
      indices.set(id, i);
    }
    return i;
  };
  const t = Date.now();
  const far =
    farRadius > 0 && palette.farDue(t)
      ? blockCube(o, farRadius, farHeight, index)
      : undefined;
  return {
    t,
    self: {
      x: pos.x,
      y: pos.y,
      z: pos.z,
      yaw: me.yaw,
      pitch: me.pitch,
      health: bot.health,
      food: bot.food,
      onGround: me.onGround,
      sprinting: bot.controlState.sprint,
      sneaking: bot.controlState.sneak,
      usingItem: bot.usingHeldItem,
      held: bot.heldItem?.name ?? '',
      offHand: bot.inventory.slots[45]?.name ?? '',
      items: countItems(bot.inventory.slots.filter((item) => item !== null)),
    },
    entities,
    blocks: blockCube(o, blockRadius, blockHeight, index),
    far: far && { o, r: far.r, h: far.h, runs: toRuns(far.c) },
  };
}

/** the JNbot Client calls a snapshot needs (main process client or worker proxy) */
export type SnapshotClient = Pick<
  IMcClient,
  | 'getCurrentPosition'
  | 'getHealth'
  | 'getHeldItems'
  | 'getPlayerState'
  | 'getInventory'
  | 'getNearbyEntities'
  | 'getBlockCube'
  | 'apiVersion'
>;

/** per client: names of each entity type's synced values, for clients that send them by index */
const entityKeys = new WeakMap<
  SnapshotClient,
  Promise<(type: string) => string[] | undefined>
>();

function entityKeysOf(client: SnapshotClient) {
  let keys = entityKeys.get(client);
  if (!keys) {
    keys = client
      .apiVersion()
      .then(({ mcVersion }) => {
        const data = mcVersion ? minecraftData(mcVersion) : undefined;
        return (type: string) => data?.entitiesByName[type]?.metadataKeys;
      })
      .catch(() => () => undefined);
    entityKeys.set(client, keys);
  }
  return keys;
}

/** a cube from the client, as runs of indices into the palette */
async function clientCube(
  client: SnapshotClient,
  o: [number, number, number],
  r: number,
  h: number,
  palette: Palette,
) {
  const cube = await client.getBlockCube({
    from: { x: o[0] - r, y: o[1] - h, z: o[2] - r },
    to: { x: o[0] + r, y: o[1] + h, z: o[2] + r },
  });
  const indices = cube.palette.map((b) =>
    palette.index({
      name: shortName(b.blockId),
      solid: b.isSolid,
      liquid: b.isLiquid,
      state: blockState(b.state),
    }),
  );
  return cube.runs.map((v, i) => (i % 2 ? v : indices[v]));
}

export async function snapshotClient(
  client: SnapshotClient,
  options: ObserveOptions,
  palette: Palette,
): Promise<Snapshot> {
  const {
    entityRadius,
    blockRadius: r,
    blockHeight: h,
    farRadius,
    farHeight,
  } = { ...DEFAULT_OBSERVE, ...options };
  const pos = await client.getCurrentPosition();
  const o: [number, number, number] = [
    Math.floor(pos.x),
    Math.floor(pos.y),
    Math.floor(pos.z),
  ];
  const t = Date.now();
  const farDue = farRadius > 0 && palette.farDue(t);
  const [health, held, state, inventory, nearby, near, far, keys] = await Promise.all([
    client.getHealth(),
    client.getHeldItems(),
    client.getPlayerState(),
    client.getInventory(),
    client.getNearbyEntities({
      radius: entityRadius,
      includePlayers: true,
      limit: 128,
    }),
    clientCube(client, o, r, h, palette),
    farDue && clientCube(client, o, farRadius, farHeight, palette),
    entityKeysOf(client),
  ]);
  return {
    t,
    self: {
      x: pos.x,
      y: pos.y,
      z: pos.z,
      yaw: toMineflayerYaw(pos.yaw),
      pitch: toMineflayerPitch(pos.pitch),
      health: health.health,
      food: health.food ?? 20,
      onGround: state.onGround,
      sprinting: state.sprinting,
      sneaking: state.sneaking,
      usingItem: state.usingItem,
      held: itemName(held.mainHand),
      offHand: itemName(held.offHand),
      items: countItems(
        inventory.items.map((item) => ({
          name: shortName(item.itemId),
          count: item.count,
        })),
      ),
    },
    entities: nearby.entities
      .filter((e) => e.uuid !== state.uuid && e.name !== state.username)
      .map((e: McEntityInfo) => ({
        id: e.id,
        type: shortName(e.type),
        player: shortName(e.type) === 'player',
        x: e.x,
        y: e.y,
        z: e.z,
        yaw: e.yaw === undefined ? NaN : toMineflayerYaw(e.yaw),
        health: e.health ?? NaN,
        held: itemName(e.equipment?.find((item) => item.slot === 'mainhand')),
        state: entityState(e.data, keys(shortName(e.type))),
      })),
    blocks: { o, r, h, c: fromRuns(near, []) },
    far: far ? { o, r: farRadius, h: farHeight, runs: far } : undefined,
  };
}

/**
 * Derived from the type on both sides: the JNbot Client doesn't report it and
 * mineflayer classifies some (slime, ghast…) as plain mobs.
 */
const HOSTILE = new Set([
  'blaze',
  'bogged',
  'breeze',
  'cave_spider',
  'creaking',
  'creeper',
  'drowned',
  'elder_guardian',
  'endermite',
  'evoker',
  'ghast',
  'guardian',
  'hoglin',
  'husk',
  'magma_cube',
  'phantom',
  'piglin_brute',
  'pillager',
  'ravager',
  'shulker',
  'silverfish',
  'skeleton',
  'slime',
  'spider',
  'stray',
  'vex',
  'vindicator',
  'warden',
  'witch',
  'wither',
  'wither_skeleton',
  'zoglin',
  'zombie',
  'zombie_villager',
]);

const PROJECTILES = new Set([
  'arrow',
  'spectral_arrow',
  'trident',
  'snowball',
  'egg',
  'fireball',
  'small_fireball',
  'dragon_fireball',
  'wither_skull',
  'llama_spit',
  'shulker_bullet',
  'potion',
  'splash_potion',
  'wind_charge',
  'breeze_wind_charge',
]);
const RANGED = /bow|trident/;
const NOT_SHOOTER = new Set(['item', 'experience_orb', ...PROJECTILES]);

/** vector length; much faster than Math.hypot */
const len = (x: number, y: number, z: number) =>
  Math.sqrt(x * x + y * y + z * z);

export const wrapAngle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/**
 * Turns snapshots into observations; keeps state across steps to derive
 * velocities, how long an item is in use and when entities last shot.
 */
export class Observer {
  #prev: Snapshot | null = null;

  #prevEntities = new Map<number, SnapshotEntity>();

  #useStart: number | null = null;

  /** shooter id -> time of its last projectile */
  #shots = new Map<number, number>();

  /** the latest far view, and its cells by palette index */
  #far?: Cube & { c: Uint16Array; cells: Map<number, number[]> };

  constructor(private readonly palette: BlockInfo[]) {}

  #readFar({ o, r, h, runs }: NonNullable<Snapshot['far']>) {
    const c = fromRuns(runs, new Uint16Array((2 * r + 1) ** 2 * (2 * h + 1)));
    const cells = new Map<number, number[]>();
    c.forEach((v, i) => {
      const list = cells.get(v);
      if (list) list.push(i);
      else cells.set(v, [i]);
    });
    this.#far = { o, r, h, c, cells };
  }

  observe(snap: Snapshot): BrainObservation {
    const prev = this.#prev;
    // velocities in blocks/tick, like mineflayer
    const ticks = prev ? Math.max(1, (snap.t - prev.t) / 50) : 1;
    const s = snap.self;
    const sin = Math.sin(s.yaw);
    const cos = Math.cos(s.yaw);
    // use started somewhere since the previous step; count from there so the
    // first step of a use isn't 0 like "not using"
    this.#useStart = s.usingItem ? this.#useStart ?? prev?.t ?? snap.t : null;
    const self = {
      ...s,
      items: s.items ?? {},
      vx: prev ? (s.x - prev.self.x) / ticks : 0,
      vy: prev ? (s.y - prev.self.y) / ticks : 0,
      vz: prev ? (s.z - prev.self.z) / ticks : 0,
      useTicks: this.#useStart === null ? 0 : (snap.t - this.#useStart) / 50,
    };
    if (prev) this.#recordShots(snap);

    const entities = snap.entities.map((e): BrainEntity => {
      const before = this.#prevEntities.get(e.id);
      const vx = before ? (e.x - before.x) / ticks : 0;
      const vy = before ? (e.y - before.y) / ticks : 0;
      const vz = before ? (e.z - before.z) / ticks : 0;
      const dx = e.x - s.x;
      const dz = e.z - s.z;
      const dy = e.y - s.y;
      const flat = Math.sqrt(dx * dx + dz * dz) || 1;
      const forward = -dx * sin - dz * cos;
      const right = dx * cos - dz * sin;
      // closest point of its current path to your body centre
      const rx = dx;
      const ry = dy - 0.9;
      const rz = dz;
      const wx = vx - self.vx;
      const wy = vy - self.vy;
      const wz = vz - self.vz;
      const speed2 = wx * wx + wy * wy + wz * wz;
      const closestIn =
        speed2 > 1e-4 ? -(rx * wx + ry * wy + rz * wz) / speed2 : NaN;
      const at = closestIn > 0 ? closestIn : 0;
      const shot = this.#shots.get(e.id);
      // explicit fields: spreading makes slow dictionary-mode objects
      return {
        id: e.id,
        type: e.type,
        player: e.player,
        x: e.x,
        y: e.y,
        z: e.z,
        yaw: e.yaw,
        health: e.health,
        held: e.held,
        state: e.state,
        kind: 'entity',
        hostile: HOSTILE.has(e.type),
        projectile: PROJECTILES.has(e.type),
        facingMe: Number.isNaN(e.yaw)
          ? NaN
          : Math.abs(wrapAngle(e.yaw - Math.atan2(dx, dz))),
        sinceShot: shot === undefined ? NaN : (snap.t - shot) / 50,
        closest: len(rx + wx * at, ry + wy * at, rz + wz * at),
        closestIn,
        vx,
        vy,
        vz,
        dist: len(dx, dy, dz),
        dy,
        forward,
        right,
        angle: Math.atan2(right, forward),
        approach: -((vx - self.vx) * dx + (vz - self.vz) * dz) / flat,
      };
    });
    entities.sort((a, b) => a.dist - b.dist);

    this.#prev = snap;
    this.#prevEntities = new Map(snap.entities.map((e) => [e.id, e]));

    // the cube is centred on the feet block
    const { o, r, h, c } = snap.blocks;
    const side = 2 * r + 1;
    if (snap.far) this.#readFar(snap.far);
    const far = this.#far;
    const fside = far ? 2 * far.r + 1 : 0;
    const near = (x: number, y: number, z: number) =>
      Math.abs(x - o[0]) <= r &&
      Math.abs(y - o[1]) <= h &&
      Math.abs(z - o[2]) <= r;
    const target = (
      block: BlockInfo,
      x: number,
      y: number,
      z: number,
    ): BrainBlockTarget => {
      // to the block centre, in your facing frame like entities
      const cx = x + 0.5 - s.x;
      const cz = z + 0.5 - s.z;
      const forward = -cx * sin - cz * cos;
      const right = cx * cos - cz * sin;
      // explicit fields: spreading makes slow dictionary-mode objects
      return {
        name: block.name,
        solid: block.solid,
        liquid: block.liquid,
        state: block.state,
        kind: 'block',
        id: blockId(x, y, z),
        x,
        y,
        z,
        dx: x - o[0],
        dy: y - o[1],
        dz: z - o[2],
        dist: len(cx, y + 0.5 - s.y - EYE_HEIGHT, cz),
        forward,
        right,
        angle: Math.atan2(right, forward),
      };
    };
    return {
      t: snap.t,
      self,
      entities,
      block: (dx, dy, dz) => {
        const x = Math.floor(dx);
        const y = Math.floor(dy);
        const z = Math.floor(dz);
        if (Math.abs(x) <= r && Math.abs(y) <= h && Math.abs(z) <= r)
          return this.palette[c[((y + h) * side + (z + r)) * side + (x + r)]];
        if (!far) return undefined;
        // beyond the view: the far view, a few seconds old at most
        const fx = o[0] + x - far.o[0];
        const fy = o[1] + y - far.o[1];
        const fz = o[2] + z - far.o[2];
        if (Math.abs(fx) > far.r || Math.abs(fy) > far.h || Math.abs(fz) > far.r)
          return undefined;
        return this.palette[
          far.c[((fy + far.h) * fside + (fz + far.r)) * fside + (fx + far.r)]
        ];
      },
      findBlocks: (match, farToo) => {
        const found: BrainBlockTarget[] = [];
        let i = 0;
        for (let dy = -h; dy <= h; dy++)
          for (let dz = -r; dz <= r; dz++)
            for (let dx = -r; dx <= r; dx++) {
              const block = this.palette[c[i++]];
              if (block && match(block, dx, dy, dz))
                found.push(target(block, o[0] + dx, o[1] + dy, o[2] + dz));
            }
        if (farToo && far)
          for (const [index, cells] of far.cells) {
            const block = this.palette[index];
            if (!block || !match(block, NaN, NaN, NaN)) continue;
            for (const cell of cells) {
              const x = far.o[0] + (cell % fside) - far.r;
              const z = far.o[2] + (Math.floor(cell / fside) % fside) - far.r;
              const y = far.o[1] + Math.floor(cell / fside / fside) - far.h;
              if (!near(x, y, z)) found.push(target(block, x, y, z));
            }
          }
        return found.sort((a, b) => a.dist - b.dist);
      },
    };
  }

  /** attributes new projectiles to the nearest mob holding a ranged weapon (or anything right next to it) */
  #recordShots(snap: Snapshot): void {
    for (const p of snap.entities) {
      if (!PROJECTILES.has(p.type) || this.#prevEntities.has(p.id)) continue;
      let shooter: SnapshotEntity | undefined;
      let best = Infinity;
      for (const e of snap.entities) {
        if (NOT_SHOOTER.has(e.type)) continue;
        const d = len(e.x - p.x, e.y - p.y, e.z - p.z);
        if (d < best && (d < 3 || (d < 8 && RANGED.test(e.held)))) {
          shooter = e;
          best = d;
        }
      }
      if (shooter) this.#shots.set(shooter.id, snap.t);
    }
  }
}
