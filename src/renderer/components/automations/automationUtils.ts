import {
  automationStepId,
  type AutomationStep,
} from '../../../common/automation';

export type EditableKind = AutomationStep['kind'];

export const clone = <T>(value: T): T => structuredClone(value);

const position = {
  absolute: { x: 0, y: 0, z: 0 },
  relative: { x: 0, y: 0, z: 0 },
};

export const actionKinds: EditableKind[] = [
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
];

export const actionLabel = (kind: EditableKind): string =>
  (
    ({
      movePath: 'Motion',
      openInventory: 'Open inventory',
      windowClick: 'Window click',
      closeWindow: 'Close window',
      attackEntity: 'Attack entity',
      useEntity: 'Use entity',
      breakBlock: 'Break block',
      useBlock: 'Use block',
      useItem: 'Use item',
      releaseUseItem: 'Release item',
      swingArm: 'Swing arm',
      swapHands: 'Swap hands',
      dropItem: 'Drop item',
      screenAction: 'Screen action',
    }) as Record<string, string>
  )[kind] ?? kind;

export const describeStep = (step: AutomationStep): string => {
  if (step.label) return step.label;
  switch (step.kind) {
    case 'chat':
      return step.message || 'Empty message';
    case 'windowClick':
      return step.window.title
        ? `${step.window.title} (slot ${step.slot})`
        : `Slot ${step.slot}`;
    case 'closeWindow':
      return step.window?.title ? `Close ${step.window.title}` : 'Close window';
    case 'hotbar':
      return `Slot ${step.slot + 1}`;
    case 'movePath':
      return `${step.points.length} motion frames`;
    case 'attackEntity':
      return `Attack ${step.entity.type}`;
    case 'useEntity':
      return `Use ${step.entity.type}`;
    case 'breakBlock':
      return `Break block (${step.position.absolute.x}, ${step.position.absolute.y}, ${step.position.absolute.z})`;
    case 'useBlock':
      return `Use block (${step.position.absolute.x}, ${step.position.absolute.y}, ${step.position.absolute.z})`;
    case 'dropItem':
      return step.entireStack ? 'Drop entire stack' : 'Drop item';
    case 'screenAction':
      return `Screen ${step.action}`;
    default:
      return actionLabel(step.kind);
  }
};

export const newStep = (kind: EditableKind, atMs: number): AutomationStep => {
  const base = { id: automationStepId(), enabled: true, atMs };
  switch (kind) {
    case 'movePath':
      return {
        ...base,
        kind,
        points: [
          {
            ...clone(position),
            atMs,
            tick: 0,
            yaw: 0,
            pitch: 0,
            onGround: true,
            forward: false,
            back: false,
            left: false,
            right: false,
            jump: false,
            sneak: false,
            sprint: false,
          },
        ],
      };
    case 'chat':
      return { ...base, kind, message: '' };
    case 'hotbar':
      return { ...base, kind, slot: 0 };
    case 'openInventory':
    case 'closeWindow':
    case 'wake':
    case 'respawn':
      return { ...base, kind } as AutomationStep;
    case 'windowClick':
      return {
        ...base,
        kind,
        window: {},
        slot: 0,
        button: 0,
        actionType: 'PICKUP',
      };
    case 'attackEntity':
    case 'useEntity':
      return {
        ...base,
        kind,
        entity: { type: 'minecraft:pig', radius: 16 },
        hand: 'main',
      };
    case 'breakBlock':
    case 'useBlock':
      return {
        ...base,
        kind,
        position: clone(position),
        face: 'up',
        hand: 'main',
      };
    case 'useItem':
    case 'releaseUseItem':
    case 'swingArm':
    case 'swapHands':
      return { ...base, kind, hand: 'main' };
    case 'dropItem':
      return { ...base, kind, entireStack: false };
    case 'screenAction':
      return { ...base, kind, action: 'button', data: {} };
  }
};

/** m:ss */
export const clock = (ms: number) => {
  const seconds = Math.round(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
};
