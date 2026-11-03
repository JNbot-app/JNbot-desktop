// Plain-language names for a brain model's inputs and outputs (see
// workers/brain/spec.ts brainFromSpec for the features, heads.ts for the heads).

import {
  brainActionName,
  type BrainSpec,
  interactionLabel,
} from '../../../../../common/brainSpec';

/** swarm sectors and rays: 0 is straight ahead, increasing clockwise */
const DIRECTIONS = [
  'ahead',
  'ahead-right',
  'right',
  'behind-right',
  'behind',
  'behind-left',
  'left',
  'ahead-left',
];
const RINGS = ['within 3 blocks', '3–8 blocks away'];

const GROUPS: Record<string, string> = {
  health: 'You',
  held: 'You',
  motion: 'You',
  hostile: 'Hostile mobs',
  players: 'Players',
  projectiles: 'Projectiles',
  rays: 'Surroundings',
  target: 'Target',
  intent: 'What there is to do',
  memory: 'What it did last',
};

const FIELDS: Record<string, string> = {
  health: 'health',
  food: 'hunger',
  onGround: 'on the ground',
  vy: 'vertical speed',
  pitch: 'looking up or down',
  sneaking: 'sneaking',
  usingItem: 'using an item',
  useTicks: 'time using the item',
  held: 'held item',
  count: 'how many',
  nearestDist: 'nearest distance',
  nearestAngle: 'nearest direction',
  nearestDy: 'nearest height',
  nearestApproach: 'nearest approach speed',
  dist: 'distance',
  dy: 'height difference',
  angle: 'direction',
  forward: 'distance ahead',
  right: 'distance to the right',
  approach: 'approach speed',
  facingMe: 'facing you',
  kind: 'what to do',
  has: 'how many of its item you have',
  entityHealth: 'its health',
  last: 'last thing done',
  since: 'seconds since',
  streak: 'times in a row',
};

/** the blocks around a target block */
const SIDES: Record<string, string> = {
  up: 'above it',
  down: 'below it',
  north: 'north of it',
  south: 'south of it',
  east: 'east of it',
  west: 'west of it',
};

const SIDE_FIELDS: Record<string, string> = {
  air: 'empty',
  solid: 'solid',
  liquid: 'liquid',
  usual: 'what was there when you did it',
};

const BOOLEANS = new Set([
  'onGround',
  'sneaking',
  'usingItem',
  'facingMe',
  ...Object.keys(SIDE_FIELDS),
]);
const ANGLES = /angle|pitch/i;

/** the input's group (self, hostile, rays…) */
export const featureGroup = (name: string) => {
  const group = name.split('.')[0];
  return GROUPS[group] ?? group;
};

/** `intent.<k>.<target feature>.<min|max>`: the lowest or highest among the things to do the k-th interaction to */
function intentLabel(rest: string[], spec?: BrainSpec): string {
  const interaction = spec?.interactions[+rest[0] - 1];
  const what = interaction
    ? interactionLabel(interaction)
    : `Option ${rest[0]}`;
  if (rest[1] === 'count') return `${what}: how many there are`;
  const field = rest.slice(1, -1).join('.');
  const label = featureLabel(`target.${field}`).replace(/^Target: /, '');
  const any = BOOLEANS.has(rest.at(-2)!);
  const highest = rest.at(-1) === 'max';
  return `${what}: ${any ? (highest ? 'any' : 'all') : highest ? 'highest' : 'lowest'} ${label}`;
}

export function featureLabel(name: string, spec?: BrainSpec): string {
  const [group, ...rest] = name.split('.');
  if (group === 'intent') return intentLabel(rest, spec);
  const field = rest.at(-1) ?? group;
  const sector = /^r(\d)s(\d)$/.exec(field);
  if (sector)
    return `${featureGroup(name)} ${RINGS[+sector[1]]}, ${DIRECTIONS[+sector[2]]}`;
  if (group === 'target' && SIDES[rest[0]])
    return `Target: ${SIDES[rest[0]]} is ${SIDE_FIELDS[field] ?? field}`;
  if (group === 'rays')
    return `Distance to a ${field} ${DIRECTIONS[+rest[0]] ?? rest[0]}`;
  return `${featureGroup(name)}: ${FIELDS[field] ?? field}`;
}

/** what an index feature's values mean: -1 is none, k the k-th item or interaction */
function indexNames(name: string, spec: BrainSpec): string[] | undefined {
  if (name === 'held.held') return spec.hold;
  if (name === 'target.kind' || name === 'memory.last')
    return spec.interactions.map(interactionLabel);
  return undefined;
}

const round = (value: number) => +value.toFixed(2);

/** the question a split asks: is `x[name] <= threshold`? */
export function splitQuestion(
  name: string,
  threshold: number,
  spec: BrainSpec,
): string {
  const label = featureLabel(name, spec);
  // intent features end in min/max: the field is the one before
  const field = name.split('.').at(name.startsWith('intent.') ? -2 : -1)!;
  if (BOOLEANS.has(field)) return `${label}? no`;
  const names = indexNames(name, spec);
  if (names) {
    const matching = ['nothing', ...names].filter((_, k) => k - 1 <= threshold);
    return `${label} is ${matching.join(' or ')}`;
  }
  if (ANGLES.test(field))
    return `${label} ≤ ${Math.round((threshold * 180) / Math.PI)}°`;
  return `${label} ≤ ${round(threshold)}`;
}

const CLASSES: Record<string, string[]> = {
  forward: ['walk back', 'stand still', 'walk forward'],
  strafe: ['step left', 'no sidestep', 'step right'],
};

/** names of a head's outputs; a binary head's single score is for "yes" */
export function headOutputs(head: string, spec: BrainSpec): string[] {
  if (head === 'hold') return ['keep the item', ...(spec.hold ?? [])];
  if (head === 'intent')
    return ['do nothing', ...spec.interactions.map(interactionLabel)];
  if (head === 'target') return ['pick this one'];
  if (head === 'turn') return ['turn (radians)'];
  return CLASSES[head] ?? [brainActionName(head)];
}
