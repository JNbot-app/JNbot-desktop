export const RECIPE_DOCUMENT_VERSION = 3 as const;

export type RecipeValueType =
  | 'string'
  | 'number'
  | 'boolean'
  | 'object'
  | 'list'
  | 'any';

export type RecipeLiteralValue =
  | string
  | number
  | boolean
  | null
  | RecipeLiteralValue[]
  | { [key: string]: RecipeLiteralValue };

export type RecipeValue =
  | { kind: 'literal'; value: RecipeLiteralValue }
  | {
      kind: 'reference';
      source:
        | 'trigger'
        | 'step'
        | 'loop'
        | 'recipeInput'
        | 'saved'
        | 'pluginOption'
        | 'bot';
      sourceId?: string;
      outputId: string;
    }
  | {
      kind: 'template';
      parts: Array<string | Exclude<RecipeValue, { kind: 'template' }>>;
    }
  | {
      kind: 'expression';
      operator: 'add' | 'subtract' | 'multiply' | 'divide' | 'remainder';
      left: RecipeValue;
      right: RecipeValue;
    }
  | {
      kind: 'formula';
      /**
       * A human-written equation such as `@messageCount + 1`. References are
       * retained separately so changing a label never changes what runs.
       */
      expression: string;
      references?: Record<string, Exclude<RecipeValue, { kind: 'formula' }>>;
    };

export type RecipeComparisonOperator =
  | 'equal'
  | 'notEqual'
  | 'contains'
  | 'notContains'
  | 'greater'
  | 'less'
  | 'greaterEqual'
  | 'lessEqual'
  | 'true'
  | 'false'
  | 'matches';

export type RecipeCondition = {
  id?: string;
  left: RecipeValue;
  operator: RecipeComparisonOperator;
  right?: RecipeValue;
  not?: boolean;
};

export type RecipeActionStep = {
  id: string;
  kind: 'action';
  actionId: string;
  inputs: Record<string, RecipeValue>;
  disabled?: boolean;
};

export type RecipeIfStep = {
  id: string;
  kind: 'if';
  match: 'all' | 'any';
  conditions: RecipeCondition[];
  then: RecipeStep[];
  otherwise: RecipeStep[];
  disabled?: boolean;
};

export type RecipeRepeatCountStep = {
  id: string;
  kind: 'repeatCount';
  count: RecipeValue;
  steps: RecipeStep[];
  disabled?: boolean;
};

export type RecipeRepeatWhileStep = {
  id: string;
  kind: 'repeatWhile';
  condition: RecipeCondition;
  steps: RecipeStep[];
  disabled?: boolean;
};

export type RecipeForEachStep = {
  id: string;
  kind: 'forEach';
  collectionId: string;
  usePluginFilters?: boolean;
  showProgress?: boolean;
  showControls?: boolean;
  steps: RecipeStep[];
  disabled?: boolean;
};

export type RecipeParallelStep = {
  id: string;
  kind: 'parallel';
  branches: Array<{ id: string; name: string; steps: RecipeStep[] }>;
  disabled?: boolean;
};

export type RecipeRememberStep = {
  id: string;
  kind: 'remember';
  name: string;
  value: RecipeValue;
  disabled?: boolean;
};

export type RecipeCallStep = {
  id: string;
  kind: 'callRecipe';
  recipeId: string;
  inputs: Record<string, RecipeValue>;
  disabled?: boolean;
};

/** Pause this workflow until the active bot emits an event once. */
export type RecipeWaitForEventStep = {
  id: string;
  kind: 'waitForEvent';
  eventId: string;
  disabled?: boolean;
};

export type RecipeStopStep = {
  id: string;
  kind: 'stop';
  disabled?: boolean;
};

/** Exit the current reusable recipe or event listener. */
export type RecipeReturnStep = {
  id: string;
  kind: 'return';
  disabled?: boolean;
};

export type RecipeDeveloperCodeStep = {
  id: string;
  kind: 'developerCode';
  code: string;
  disabled?: boolean;
};

export type RecipeStep =
  | RecipeActionStep
  | RecipeIfStep
  | RecipeRepeatCountStep
  | RecipeRepeatWhileStep
  | RecipeForEachStep
  | RecipeParallelStep
  | RecipeRememberStep
  | RecipeCallStep
  | RecipeWaitForEventStep
  | RecipeStopStep
  | RecipeReturnStep
  | RecipeDeveloperCodeStep;

export type RecipeTrigger =
  | { kind: 'run' }
  | {
      kind: 'botEvent';
      eventId: string;
      mode: 'every' | 'once';
      concurrency: 'queue' | 'parallel';
    };

export type RecipeParameter = {
  id: string;
  name: string;
  type: RecipeValueType;
  defaultValue?: RecipeValue;
};

export type RecipeDefinitionV3 = {
  id: string;
  name: string;
  role: 'onRun' | 'event' | 'callable';
  enabled: boolean;
  trigger?: RecipeTrigger;
  inputs?: RecipeParameter[];
  outputs?: RecipeParameter[];
  steps: RecipeStep[];
};

export type RecipeDocumentV3 = {
  kind: 'recipe';
  version: typeof RECIPE_DOCUMENT_VERSION;
  recipes: RecipeDefinitionV3[];
};

export function createRecipeId(prefix = 'recipe'): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

export function literal(value: RecipeLiteralValue = ''): RecipeValue {
  return { kind: 'literal', value };
}

export function createDefaultRecipeDocument(): RecipeDocumentV3 {
  return {
    kind: 'recipe',
    version: RECIPE_DOCUMENT_VERSION,
    recipes: [
      {
        id: createRecipeId('on_run'),
        name: 'On Run',
        role: 'onRun',
        enabled: true,
        trigger: { kind: 'run' },
        steps: [],
      },
    ],
  };
}

export function isRecipeDocument(value: unknown): value is RecipeDocumentV3 {
  if (!value || typeof value !== 'object') return false;
  const document = value as Partial<RecipeDocumentV3>;
  return (
    document.kind === 'recipe' &&
    document.version === RECIPE_DOCUMENT_VERSION &&
    Array.isArray(document.recipes)
  );
}

export function normalizeRecipeDocument(
  document: RecipeDocumentV3,
): RecipeDocumentV3 {
  return document;
}

export function walkRecipeSteps(
  steps: RecipeStep[],
  visit: (step: RecipeStep) => void,
): void {
  for (const step of steps) {
    visit(step);
    if (step.kind === 'if') {
      walkRecipeSteps(step.then, visit);
      walkRecipeSteps(step.otherwise, visit);
    } else if (
      step.kind === 'repeatCount' ||
      step.kind === 'repeatWhile' ||
      step.kind === 'forEach'
    ) {
      walkRecipeSteps(step.steps, visit);
    } else if (step.kind === 'parallel') {
      step.branches.forEach((branch) => walkRecipeSteps(branch.steps, visit));
    }
  }
}
