/**
 * Feature helpers that turn variable-size world state into fixed-size,
 * order-free features in the player's facing frame.
 */
import type {
  BrainEntity,
  BrainFeatures,
  BrainObservation,
} from '../../../../common/types/brainApi';

/** Flatten user features to `name -> number` (booleans 0/1, missing NaN, strings ignored). */
export function flatten(
  features: BrainFeatures,
  out: Record<string, number> = {},
  prefix = '',
): Record<string, number> {
  for (const [key, value] of Object.entries(features)) {
    const name = prefix + key;
    if (typeof value === 'number') out[name] = value;
    else if (typeof value === 'boolean') out[name] = +value;
    else if (value === null || value === undefined) out[name] = NaN;
    else if (typeof value === 'object') flatten(value, out, `${name}.`);
  }
  return out;
}

const TAU = Math.PI * 2;

export function swarm(
  o: BrainObservation,
  {
    filter = (e: BrainEntity) => e.hostile,
    sectors = 8,
    rings = [3, 8],
  }: {
    filter?: (e: BrainEntity) => boolean;
    sectors?: number;
    rings?: number[];
  } = {},
): BrainFeatures {
  const counts = new Array<number>(sectors * rings.length).fill(0);
  let count = 0;
  let nearest: BrainEntity | undefined;
  for (const e of o.entities) {
    if (!filter(e)) continue;
    count++;
    nearest ??= e; // entities are sorted nearest first
    const ring = rings.findIndex((radius) => e.dist <= radius);
    if (ring < 0) continue;
    // sector 0 is straight ahead, increasing clockwise
    const sector =
      Math.floor(
        ((((e.angle + Math.PI / sectors) % TAU) + TAU) % TAU) / (TAU / sectors),
      ) % sectors;
    counts[ring * sectors + sector]++;
  }
  const out: BrainFeatures = {
    count,
    nearestDist: nearest?.dist,
    nearestAngle: nearest?.angle,
    nearestDy: nearest?.dy,
    nearestApproach: nearest?.approach,
  };
  counts.forEach(
    (n, i) => (out[`r${Math.floor(i / sectors)}s${i % sectors}`] = n),
  );
  return out;
}

const HAZARDS = /lava|fire|cactus|magma|sweet_berry|campfire|powder_snow/;

export function rays(
  o: BrainObservation,
  { count = 8, length = 4 }: { count?: number; length?: number } = {},
): BrainFeatures {
  const { x, z, yaw } = o.self;
  const fx = x - Math.floor(x);
  const fz = z - Math.floor(z);
  const out: BrainFeatures = {};
  for (let i = 0; i < count; i++) {
    // ray 0 points where you look, increasing clockwise
    const angle = yaw - (i * TAU) / count;
    const dx = -Math.sin(angle);
    const dz = -Math.cos(angle);
    let wall = length;
    let drop = length;
    let hazard = length;
    for (let d = 0.5; d <= length; d += 0.5) {
      const bx = fx + dx * d;
      const bz = fz + dz * d;
      const feet = o.block(bx, 0, bz);
      const head = o.block(bx, 1, bz);
      if (!feet || !head) break; // outside the observed cube
      if (
        hazard === length &&
        [feet, head, o.block(bx, -1, bz)].some((b) => b && HAZARDS.test(b.name))
      )
        hazard = d;
      if (feet.solid || head.solid) {
        wall = d;
        break;
      }
      if (
        drop === length &&
        !o.block(bx, -1, bz)?.solid &&
        !o.block(bx, -2, bz)?.solid
      )
        drop = d;
    }
    out[`${i}`] = { wall, drop, hazard };
  }
  return out;
}
