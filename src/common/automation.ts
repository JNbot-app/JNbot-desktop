import type { BrainLearnSettings } from './brainSpec';

export const AUTOMATION_SCHEMA_VERSION = 2 as const;

export type AutomationSpatialMode = 'relative' | 'absolute';
export type AutomationTargetKind = 'minecraft' | 'bot';
export type AutomationSessionState =
  | 'recording'
  | 'playing'
  | 'paused'
  | 'failed'
  | 'completed'
  | 'stopped';

export interface AutomationVec3 {
  x: number;
  y: number;
  z: number;
}

export interface AutomationReplayOrigin extends AutomationVec3 {
  yaw?: number;
}

export interface AutomationPositionRef {
  absolute: AutomationVec3;
  relative: AutomationVec3;
}

export interface AutomationItemFingerprint {
  itemId: string;
  name?: string;
  count?: number;
  components?: string;
}

export interface AutomationWindowMatcher {
  title?: string;
  type?: string;
  inventory?: boolean;
}

export interface AutomationEntitySelector {
  sourceRuntimeId?: number;
  uuid?: string;
  type: string;
  name?: string;
  position?: AutomationPositionRef;
  radius?: number;
}

export interface AutomationPathPoint extends AutomationPositionRef {
  atMs: number;
  tick: number;
  yaw: number;
  pitch: number;
  onGround: boolean;
  velocity?: AutomationVec3;
  forward: boolean;
  back: boolean;
  left: boolean;
  right: boolean;
  jump: boolean;
  sprint: boolean;
  sneak: boolean;
  riding?: boolean;
}

interface AutomationStepBase {
  id: string;
  enabled: boolean;
  atMs: number;
  label?: string;
}

export type AutomationScreenAction =
  | 'button'
  | 'recipe'
  | 'trade'
  | 'rename'
  | 'beacon'
  | 'book'
  | 'sign'
  | 'bundle'
  | 'creativeSlot'
  | 'pickItem'
  | 'spectatorTeleport';

export type AutomationStep =
  | (AutomationStepBase & { kind: 'movePath'; points: AutomationPathPoint[] })
  | (AutomationStepBase & { kind: 'chat'; message: string })
  | (AutomationStepBase & { kind: 'hotbar'; slot: number })
  | (AutomationStepBase & { kind: 'openInventory' })
  | (AutomationStepBase & {
      kind: 'windowClick';
      window: AutomationWindowMatcher;
      slot: number;
      button: number;
      actionType: string;
      itemBefore?: AutomationItemFingerprint;
    })
  | (AutomationStepBase & {
      kind: 'closeWindow';
      window?: AutomationWindowMatcher;
    })
  | (AutomationStepBase & {
      kind: 'attackEntity' | 'useEntity';
      entity: AutomationEntitySelector;
      hand?: 'main' | 'off';
    })
  | (AutomationStepBase & {
      kind: 'breakBlock' | 'useBlock';
      position: AutomationPositionRef;
      face?: 'up' | 'down' | 'north' | 'south' | 'east' | 'west';
      hand?: 'main' | 'off';
      blockBefore?: string;
    })
  | (AutomationStepBase & {
      kind:
        | 'useItem'
        | 'releaseUseItem'
        | 'swingArm'
        | 'swapHands'
        | 'wake'
        | 'respawn';
      hand?: 'main' | 'off';
    })
  | (AutomationStepBase & { kind: 'dropItem'; entireStack?: boolean })
  | (AutomationStepBase & {
      kind: 'screenAction';
      action: AutomationScreenAction;
      data: Record<string, unknown>;
    });

export interface AutomationInput {
  id: string;
  label: string;
  secret: boolean;
  required: boolean;
}

export interface AutomationDocument {
  schemaVersion: typeof AUTOMATION_SCHEMA_VERSION;
  id: string;
  name: string;
  revision: number;
  createdAt: number;
  updatedAt: number;
  durationMs: number;
  source: {
    kind: 'minecraft';
    clientId?: string;
    username?: string;
    mcVersion?: string;
    serverAddress?: string;
    dimension?: string;
  };
  origin: AutomationVec3 & { yaw: number; pitch: number };
  inputs: AutomationInput[];
  steps: AutomationStep[];
  interrupted?: boolean;
  /** what "Play with AI" should learn; the rest is detected from the examples */
  learn?: BrainLearnSettings;
  /** the take (AI example file) the steps were recorded in */
  replayTake?: string;
}

/** What a take recorded for exact replay; saved beside its AI example. */
export type AutomationTake = Pick<
  AutomationDocument,
  'source' | 'origin' | 'inputs' | 'steps' | 'durationMs' | 'interrupted'
>;

export function createAutomationDocument(options: {
  id: string;
  name: string;
  now?: number;
}): AutomationDocument {
  const now = options.now ?? Date.now();
  return {
    schemaVersion: AUTOMATION_SCHEMA_VERSION,
    id: options.id,
    name: options.name,
    revision: 0,
    createdAt: now,
    updatedAt: now,
    durationMs: 0,
    source: { kind: 'minecraft' },
    origin: { x: 0, y: 0, z: 0, yaw: 0, pitch: 0 },
    inputs: [],
    steps: [],
  };
}

export interface AutomationSummary {
  id: string;
  name: string;
  revision: number;
  createdAt: number;
  updatedAt: number;
  durationMs: number;
  stepCount: number;
  source: AutomationDocument['source'];
  interrupted?: boolean;
}

export type AutomationPlayMode = 'exact' | 'ai';

export interface AutomationReplayOptions {
  spatialMode: AutomationSpatialMode;
  inputs?: Record<string, string>;
  /** 'ai' plays with the AI learned from the recordings instead of replaying the steps (bots only) */
  mode?: AutomationPlayMode;
}

export interface AutomationTargetDescriptor {
  kind: AutomationTargetKind;
  id: string | number;
  profileId?: number;
  username?: string;
}

export interface AutomationIssue {
  stepId: string;
  stepIndex: number;
  kind: AutomationStep['kind'];
  atMs: number;
  reason: string;
}

export interface AutomationSessionStatus {
  sessionId: string;
  automationId: string;
  target: AutomationTargetDescriptor;
  state: AutomationSessionState;
  currentStep: number;
  totalSteps: number;
  stepId?: string;
  message?: string;
  error?: string;
  issues: AutomationIssue[];
  startedAt: number;
  updatedAt: number;
  /** practice with AI: who controls the JNbot Client, how many corrections were saved, and what the AI is doing with the chance of each option */
  practice?: {
    control: 'learning' | 'ai' | 'you';
    corrections: number;
    doing?: { name: string; chances: [name: string, chance: number][] };
  };
}

const objectValue = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const stepKinds = new Set<AutomationStep['kind']>([
  'movePath',
  'chat',
  'hotbar',
  'openInventory',
  'windowClick',
  'closeWindow',
  'attackEntity',
  'useEntity',
  'breakBlock',
  'useBlock',
  'useItem',
  'releaseUseItem',
  'swingArm',
  'swapHands',
  'dropItem',
  'wake',
  'respawn',
  'screenAction',
]);
const screenActionKinds = new Set<AutomationScreenAction>([
  'button',
  'recipe',
  'trade',
  'rename',
  'beacon',
  'book',
  'sign',
  'bundle',
  'creativeSlot',
  'pickItem',
  'spectatorTeleport',
]);

export const isAutomationScreenAction = (
  value: unknown,
): value is AutomationScreenAction =>
  typeof value === 'string' &&
  screenActionKinds.has(value as AutomationScreenAction);

const finiteVector = (value: unknown): boolean => {
  const vector = objectValue(value);
  return Boolean(
    vector &&
      ['x', 'y', 'z'].every(
        (key) =>
          typeof vector[key] === 'number' &&
          Number.isFinite(vector[key] as number),
      ),
  );
};

const positionRef = (value: unknown): boolean => {
  const reference = objectValue(value);
  return Boolean(
    reference &&
      finiteVector(reference.absolute) &&
      finiteVector(reference.relative),
  );
};

const validHand = (value: unknown): boolean =>
  value === undefined || value === 'main' || value === 'off';
const validWindow = (value: unknown): boolean => {
  const window = objectValue(value);
  return Boolean(
    window &&
      (window.title === undefined || typeof window.title === 'string') &&
      (window.type === undefined || typeof window.type === 'string') &&
      (window.inventory === undefined || typeof window.inventory === 'boolean'),
  );
};

export function assertAutomationDocument(
  value: unknown,
): asserts value is AutomationDocument {
  const document = objectValue(value);
  if (!document) throw new TypeError('Automation must be an object');
  if (document.schemaVersion !== AUTOMATION_SCHEMA_VERSION)
    throw new TypeError(
      `Unsupported automation schema: ${String(document.schemaVersion)}. Record this task again.`,
    );
  if (typeof document.id !== 'string' || !document.id)
    throw new TypeError('Automation id is required');
  if (typeof document.name !== 'string' || !document.name.trim())
    throw new TypeError('Automation name is required');
  if (!Number.isInteger(document.revision) || Number(document.revision) < 0)
    throw new TypeError('Automation revision must be a non-negative integer');
  if (!Array.isArray(document.steps))
    throw new TypeError('Automation steps must be an array');
  if (!Array.isArray(document.inputs))
    throw new TypeError('Automation inputs must be an array');
  const source = objectValue(document.source);
  if (!source || source.kind !== 'minecraft')
    throw new TypeError('Automation source must be a Minecraft client');
  const origin = objectValue(document.origin);
  if (
    !origin ||
    !['x', 'y', 'z', 'yaw', 'pitch'].every(
      (key) =>
        typeof origin[key] === 'number' &&
        Number.isFinite(origin[key] as number),
    )
  )
    throw new TypeError('Automation origin is invalid');
  if (
    typeof document.durationMs !== 'number' ||
    !Number.isFinite(document.durationMs) ||
    document.durationMs < 0
  )
    throw new TypeError('Automation duration is invalid');

  let lastTime = 0;
  const ids = new Set<string>();
  for (const rawStep of document.steps) {
    const step = objectValue(rawStep);
    if (!step || typeof step.id !== 'string' || !step.id)
      throw new TypeError('Every automation step needs an id');
    if (ids.has(step.id))
      throw new TypeError(`Duplicate automation step id: ${step.id}`);
    ids.add(step.id);
    if (
      typeof step.kind !== 'string' ||
      !stepKinds.has(step.kind as AutomationStep['kind'])
    )
      throw new TypeError(`Step ${step.id} has an unsupported kind`);
    if (typeof step.enabled !== 'boolean')
      throw new TypeError(`Step ${step.id} needs an enabled state`);
    if (
      typeof step.atMs !== 'number' ||
      !Number.isFinite(step.atMs) ||
      step.atMs < 0
    )
      throw new TypeError(`Step ${step.id} has an invalid time`);
    if (step.atMs < lastTime)
      throw new TypeError(`Step ${step.id} occurs before the previous step`);
    lastTime = step.atMs;
    if (
      step.kind === 'movePath' &&
      (!Array.isArray(step.points) ||
        !step.points.length ||
        step.points.some(
          (point) =>
            !positionRef(point) ||
            !Number.isInteger(point.tick) ||
            !Number.isFinite(point.atMs) ||
            !Number.isFinite(point.yaw) ||
            !Number.isFinite(point.pitch) ||
            typeof point.onGround !== 'boolean' ||
            [
              'forward',
              'back',
              'left',
              'right',
              'jump',
              'sprint',
              'sneak',
            ].some((key) => typeof point[key] !== 'boolean') ||
            (point.riding !== undefined && typeof point.riding !== 'boolean'),
        ))
    )
      throw new TypeError(`Motion step ${step.id} has invalid frames`);
    if (step.kind === 'chat' && typeof step.message !== 'string')
      throw new TypeError(`Chat step ${step.id} has an invalid message`);
    if (
      step.kind === 'hotbar' &&
      (!Number.isInteger(step.slot) || step.slot < 0 || step.slot > 8)
    )
      throw new TypeError(`Hotbar step ${step.id} has an invalid slot`);
    if (
      step.kind === 'windowClick' &&
      (!validWindow(step.window) ||
        !Number.isInteger(step.slot) ||
        !Number.isInteger(step.button) ||
        typeof step.actionType !== 'string')
    )
      throw new TypeError(`Window step ${step.id} is invalid`);
    if (
      step.kind === 'closeWindow' &&
      step.window !== undefined &&
      !validWindow(step.window)
    )
      throw new TypeError(`Window step ${step.id} is invalid`);
    if (
      (step.kind === 'breakBlock' || step.kind === 'useBlock') &&
      !positionRef(step.position)
    )
      throw new TypeError(`Block step ${step.id} has an invalid position`);
    if (
      (step.kind === 'breakBlock' || step.kind === 'useBlock') &&
      !validHand(step.hand)
    )
      throw new TypeError(`Block step ${step.id} has an invalid hand`);
    if (
      (step.kind === 'attackEntity' || step.kind === 'useEntity') &&
      (!objectValue(step.entity) ||
        typeof step.entity.type !== 'string' ||
        !step.entity.type)
    )
      throw new TypeError(`Entity step ${step.id} has an invalid target`);
    if (
      (step.kind === 'attackEntity' || step.kind === 'useEntity') &&
      !validHand(step.hand)
    )
      throw new TypeError(`Entity step ${step.id} has an invalid hand`);
    if (
      [
        'useItem',
        'releaseUseItem',
        'swingArm',
        'swapHands',
        'wake',
        'respawn',
      ].includes(step.kind) &&
      !validHand(step.hand)
    )
      throw new TypeError(`Player step ${step.id} has an invalid hand`);
    if (
      step.kind === 'dropItem' &&
      step.entireStack !== undefined &&
      typeof step.entireStack !== 'boolean'
    )
      throw new TypeError(`Drop step ${step.id} is invalid`);
    if (
      step.kind === 'screenAction' &&
      (!isAutomationScreenAction(step.action) || !objectValue(step.data))
    )
      throw new TypeError(`Screen step ${step.id} is invalid`);
  }
}

export function isAutomationDocument(
  value: unknown,
): value is AutomationDocument {
  try {
    assertAutomationDocument(value);
    return true;
  } catch {
    return false;
  }
}

export function automationSummary(
  document: AutomationDocument,
): AutomationSummary {
  return {
    id: document.id,
    name: document.name,
    revision: document.revision,
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
    durationMs: document.durationMs,
    stepCount: document.steps.length,
    source: document.source,
    interrupted: document.interrupted,
  };
}

export function resolveAutomationPosition(
  reference: AutomationPositionRef,
  mode: AutomationSpatialMode,
  replayOrigin: AutomationReplayOrigin,
  recordedYaw?: number,
): AutomationVec3 {
  if (mode === 'absolute') return { ...reference.absolute };
  const relative = resolveAutomationVector(
    reference.relative,
    mode,
    replayOrigin,
    recordedYaw,
  );
  return {
    x: replayOrigin.x + relative.x,
    y: replayOrigin.y + relative.y,
    z: replayOrigin.z + relative.z,
  };
}

export function resolveAutomationVector(
  vector: AutomationVec3,
  mode: AutomationSpatialMode,
  replayOrigin: AutomationReplayOrigin,
  recordedYaw?: number,
): AutomationVec3 {
  if (mode === 'absolute') return { ...vector };
  const angle =
    (((replayOrigin.yaw ?? recordedYaw ?? 0) -
      (recordedYaw ?? replayOrigin.yaw ?? 0)) *
      Math.PI) /
    180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return {
    x: vector.x * cos - vector.z * sin,
    y: vector.y,
    z: vector.x * sin + vector.z * cos,
  };
}

export function resolveAutomationYaw(
  yaw: number,
  mode: AutomationSpatialMode,
  replayOrigin: AutomationReplayOrigin,
  recordedYaw: number,
): number {
  return mode === 'absolute'
    ? yaw
    : yaw + (replayOrigin.yaw ?? recordedYaw) - recordedYaw;
}

/** Minecraft degrees to mineflayer radians */
export const toMineflayerYaw = (yaw: number): number =>
  Math.PI - (yaw * Math.PI) / 180;
export const toMineflayerPitch = (pitch: number): number =>
  (-pitch * Math.PI) / 180;

export function applyAutomationInputs(
  value: string,
  inputs: Record<string, string> = {},
): string {
  return value.replace(
    /\{\{secret\.([a-zA-Z0-9_-]+)\}\}/g,
    (_match, key: string) => {
      if (!(key in inputs)) throw new Error(`Missing required secret: ${key}`);
      return inputs[key];
    },
  );
}

export function redactAutomationChat(message: string): {
  message: string;
  input?: AutomationInput;
} {
  const match = message.match(/^\/(login|register|l|reg)\s+(.+)$/i);
  if (!match) return { message };
  const id = `${match[1].toLowerCase()}Password`;
  return {
    message: `/${match[1]} ${match[2]
      .trim()
      .split(/\s+/)
      .map(() => `{{secret.${id}}}`)
      .join(' ')}`,
    input: { id, label: `${match[1]} password`, secret: true, required: true },
  };
}

export const automationId = (prefix = 'automation'): string =>
  `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
export const automationStepId = (): string => automationId('step');
export const isRecordingSession = (
  status: Pick<AutomationSessionStatus, 'sessionId'>,
): boolean => status.sessionId.startsWith('recording-');
export const isActiveSession = (
  status: Pick<AutomationSessionStatus, 'state'>,
): boolean =>
  status.state === 'recording' ||
  status.state === 'playing' ||
  status.state === 'paused';
