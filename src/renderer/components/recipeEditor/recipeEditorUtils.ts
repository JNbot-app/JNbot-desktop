import {
  createRecipeId,
  literal,
  type RecipeCondition,
  type RecipeDefinitionV3,
  type RecipeDocumentV3,
  type RecipeStep,
  type RecipeValue,
} from '../../../common/recipeV3';
import {
  getRecipeAction,
  getRecipeEvent,
  recipeBotPropertyCatalog,
  recipeCollectionCatalog,
  type RecipeInputDefinition,
} from '../../../common/recipeCatalog';
import type { RecipeBotEffect } from '../../../common/recipeAnalysis';

export type ListPathPart = {
  stepId: string;
  slot: 'then' | 'otherwise' | 'steps' | 'branch';
  branchId?: string;
};

export type InsertTarget = {
  recipeId: string;
  path: ListPathPart[];
  index: number;
};

export type ScopeGroup = 'bot' | 'variables' | 'options' | 'event' | 'inputs';

export type ScopeValue = {
  key: string;
  label: string;
  group: ScopeGroup;
  value: RecipeValue;
};

export const botPropertyScope = (): ScopeValue[] =>
  recipeBotPropertyCatalog.map((property) => ({
    key: `bot:${property.id}`,
    label: property.label,
    group: 'bot',
    value: {
      kind: 'reference',
      source: 'bot',
      outputId: property.id,
    },
  }));

export const appendScope = (
  scope: ScopeValue[],
  additions: ScopeValue[],
): ScopeValue[] => {
  const existing = new Set(scope.map((item) => item.key));
  return [...scope, ...additions.filter((item) => !existing.has(item.key))];
};

/** Values a completed step contributes to the following steps on its path. */
export function stepOutputScope(
  step: RecipeStep,
  document: RecipeDocumentV3,
): ScopeValue[] {
  if (step.kind === 'action') {
    const action = getRecipeAction(step.actionId);
    return (action?.outputs ?? []).map((output) => ({
      key: `${step.id}:${output.id}`,
      label: `${action?.name} · ${output.label}`,
      group: 'variables' as const,
      value: {
        kind: 'reference' as const,
        source: 'step' as const,
        sourceId: step.id,
        outputId: output.id,
      },
    }));
  }
  if (step.kind === 'remember') {
    return [
      {
        key: `${step.id}:value`,
        label: step.name || 'Saved value',
        group: 'variables',
        value: {
          kind: 'reference',
          source: 'saved',
          sourceId: step.id,
          outputId: 'value',
        },
      },
    ];
  }
  if (step.kind === 'callRecipe') {
    const called = document.recipes.find(
      (recipe) => recipe.id === step.recipeId,
    );
    return (called?.outputs ?? []).map((output) => ({
      key: `${step.id}:${output.id}`,
      label: `${called?.name} · ${output.name}`,
      group: 'variables' as const,
      value: {
        kind: 'reference' as const,
        source: 'step' as const,
        sourceId: step.id,
        outputId: output.id,
      },
    }));
  }
  if (step.kind === 'waitForEvent') {
    return (getRecipeEvent(step.eventId)?.outputs ?? []).map((output) => ({
      key: `${step.id}:${output.id}`,
      label: `Event value · ${output.label}`,
      group: 'event' as const,
      value: {
        kind: 'reference' as const,
        source: 'step' as const,
        sourceId: step.id,
        outputId: output.id,
      },
    }));
  }
  return [];
}

export type RecipeDragData =
  | {
      type: 'step';
      recipeId: string;
      path: ListPathPart[];
      index: number;
      stepId: string;
    }
  | {
      type: 'library';
      itemType: 'action' | 'logic';
      itemId: string;
      label: string;
    }
  | { type: 'drop'; target: InsertTarget };

export const logicLibraryItems = [
  { id: 'if', name: 'If / Otherwise', description: 'Choose which steps run.' },
  {
    id: 'repeatCount',
    name: 'Repeat',
    description: 'Repeat steps a number of times.',
  },
  {
    id: 'repeatWhile',
    name: 'Repeat while',
    description: 'Repeat while a condition is true.',
  },
  { id: 'forEach', name: 'For each', description: 'Run steps for every item.' },
  {
    id: 'parallel',
    name: 'Run together',
    description: 'Run independent branches together.',
  },
  {
    id: 'remember',
    name: 'Remember value',
    description: 'Save a value for later.',
  },
  {
    id: 'callRecipe',
    name: 'Call a recipe',
    description: 'Run a reusable recipe or enable an event.',
  },
  {
    id: 'waitForEvent',
    name: 'Wait for an event',
    description: 'Continue when the active bot receives an event once.',
  },
  { id: 'stop', name: 'Stop plugin', description: 'End the plugin here.' },
  {
    id: 'return',
    name: 'Exit recipe',
    description: 'Finish this recipe or stop its event listener.',
  },
] as const;

export const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

export const pathKey = (path: ListPathPart[]): string =>
  path
    .map((part) => `${part.stepId}:${part.slot}:${part.branchId ?? ''}`)
    .join('/');

export const targetsEqual = (
  left: InsertTarget,
  right: InsertTarget,
): boolean =>
  left.recipeId === right.recipeId &&
  left.index === right.index &&
  pathKey(left.path) === pathKey(right.path);

export function mutableListAtPath(
  recipe: RecipeDefinitionV3,
  path: ListPathPart[],
): RecipeStep[] | undefined {
  let list = recipe.steps;
  for (const part of path) {
    const step = list.find((candidate) => candidate.id === part.stepId);
    if (!step) return undefined;
    if (part.slot === 'then' && step.kind === 'if') list = step.then;
    else if (part.slot === 'otherwise' && step.kind === 'if')
      list = step.otherwise;
    else if (
      part.slot === 'steps' &&
      (step.kind === 'repeatCount' ||
        step.kind === 'repeatWhile' ||
        step.kind === 'forEach')
    ) {
      list = step.steps;
    } else if (part.slot === 'branch' && step.kind === 'parallel') {
      const branch = step.branches.find(
        (candidate) => candidate.id === part.branchId,
      );
      if (!branch) return undefined;
      list = branch.steps;
    } else return undefined;
  }
  return list;
}

export function mutateStep(
  steps: RecipeStep[],
  stepId: string,
  update: (step: RecipeStep) => void,
): boolean {
  for (const step of steps) {
    if (step.id === stepId) {
      update(step);
      return true;
    }
    const children = childLists(step);
    if (children.some((list) => mutateStep(list, stepId, update))) return true;
  }
  return false;
}

export function findContainingList(
  steps: RecipeStep[],
  stepId: string,
): RecipeStep[] | undefined {
  if (steps.some((step) => step.id === stepId)) return steps;
  for (const step of steps) {
    for (const child of childLists(step)) {
      const found = findContainingList(child, stepId);
      if (found) return found;
    }
  }
  return undefined;
}

const childLists = (step: RecipeStep): RecipeStep[][] => {
  if (step.kind === 'if') return [step.then, step.otherwise];
  if (
    step.kind === 'repeatCount' ||
    step.kind === 'repeatWhile' ||
    step.kind === 'forEach'
  )
    return [step.steps];
  if (step.kind === 'parallel')
    return step.branches.map((branch) => branch.steps);
  return [];
};

export function defaultValue(definition: RecipeInputDefinition): RecipeValue {
  if (definition.defaultValue !== undefined)
    return literal(definition.defaultValue);
  if (definition.type === 'number') return literal(0);
  if (definition.type === 'boolean') return literal(false);
  return literal('');
}

export function createActionStep(actionId: string): RecipeStep {
  const action = getRecipeAction(actionId);
  if (!action) throw new Error(`Unknown recipe action: ${actionId}`);
  return {
    id: createRecipeId('step'),
    kind: 'action',
    actionId,
    inputs: Object.fromEntries(
      action.inputs.map((definition) => [
        definition.id,
        defaultValue(definition),
      ]),
    ),
  };
}

export const createCondition = (): RecipeCondition => ({
  id: createRecipeId('condition'),
  left: literal(''),
  operator: 'equal',
  right: literal(''),
});

export function createLogicStep(
  kind: string,
  document: RecipeDocumentV3,
): RecipeStep {
  const id = createRecipeId('step');
  if (kind === 'if')
    return {
      id,
      kind: 'if',
      match: 'all',
      conditions: [createCondition()],
      then: [],
      otherwise: [],
    };
  if (kind === 'repeatCount')
    return {
      id,
      kind: 'repeatCount',
      count: literal(3),
      steps: [],
    };
  if (kind === 'repeatWhile')
    return {
      id,
      kind: 'repeatWhile',
      condition: createCondition(),
      steps: [],
    };
  if (kind === 'forEach') {
    const collection =
      recipeCollectionCatalog.find((item) => item.id === 'alts') ??
      recipeCollectionCatalog[0];
    return {
      id,
      kind: 'forEach',
      collectionId: collection.id,
      usePluginFilters: true,
      showProgress: false,
      showControls: true,
      steps: [],
    };
  }
  if (kind === 'parallel')
    return {
      id,
      kind: 'parallel',
      branches: [
        { id: createRecipeId('branch'), name: 'Branch 1', steps: [] },
        { id: createRecipeId('branch'), name: 'Branch 2', steps: [] },
      ],
    };
  if (kind === 'remember')
    return { id, kind: 'remember', name: 'Saved value', value: literal('') };
  if (kind === 'callRecipe')
    return {
      id,
      kind: 'callRecipe',
      recipeId:
        document.recipes.find((recipe) => recipe.role !== 'onRun')?.id ?? '',
      inputs: {},
    };
  if (kind === 'waitForEvent')
    return {
      id,
      kind: 'waitForEvent',
      eventId: 'chat',
    };
  if (kind === 'developerCode')
    return {
      id,
      kind: 'developerCode',
      code: '// Advanced JavaScript\nexit();',
    };
  if (kind === 'return') return { id, kind: 'return' };
  return { id, kind: 'stop' };
}

export function renewStepIds(step: RecipeStep): RecipeStep {
  const copy = clone(step);
  const renew = (current: RecipeStep) => {
    current.id = createRecipeId('step');
    if (current.kind === 'if') {
      current.then.forEach(renew);
      current.otherwise.forEach(renew);
    } else if (
      current.kind === 'repeatCount' ||
      current.kind === 'repeatWhile' ||
      current.kind === 'forEach'
    )
      current.steps.forEach(renew);
    else if (current.kind === 'parallel') {
      current.branches.forEach((branch) => {
        branch.id = createRecipeId('branch');
        branch.steps.forEach(renew);
      });
    }
  };
  renew(copy);
  return copy;
}

export function getStepTitle(step: RecipeStep): string {
  if (step.kind === 'action')
    return getRecipeAction(step.actionId)?.name ?? step.actionId;
  if (step.kind === 'if') return 'If / Otherwise';
  if (step.kind === 'repeatCount') return 'Repeat';
  if (step.kind === 'repeatWhile') return 'Repeat while';
  if (step.kind === 'forEach') return 'For each';
  if (step.kind === 'parallel') return 'Run together';
  if (step.kind === 'remember') return 'Remember value';
  if (step.kind === 'callRecipe') return 'Call a recipe';
  if (step.kind === 'waitForEvent') return 'Wait for an event';
  if (step.kind === 'return') return 'Exit recipe';
  if (step.kind === 'developerCode') return 'Developer code';
  return 'Stop plugin';
}

export const stepProvidesBot = (
  step: RecipeStep,
  effects: Map<string, RecipeBotEffect>,
) =>
  (step.kind === 'action' && step.actionId === 'botJoin') ||
  (step.kind === 'callRecipe' &&
    Boolean(effects.get(step.recipeId)?.providesBot));

export const canInsertLibraryItem = (
  document: RecipeDocumentV3,
  target: InsertTarget,
  itemType: 'action' | 'logic',
  itemId: string,
) => {
  const recipe = document.recipes.find(
    (candidate) => candidate.id === target.recipeId,
  );
  if (!recipe) return false;
  if (itemId === 'return') return ['callable', 'event'].includes(recipe.role);
  return true;
};

export const canInsertStep = (
  document: RecipeDocumentV3,
  target: InsertTarget,
  step: RecipeStep,
) => {
  const recipe = document.recipes.find(
    (candidate) => candidate.id === target.recipeId,
  );
  if (!recipe) return false;
  if (step.kind === 'return')
    return ['callable', 'event'].includes(recipe.role);
  return true;
};

export function findStep(
  steps: RecipeStep[],
  stepId: string,
): RecipeStep | undefined {
  for (const step of steps) {
    if (step.id === stepId) return step;
    for (const list of childLists(step)) {
      const found = findStep(list, stepId);
      if (found) return found;
    }
  }
  return undefined;
}
