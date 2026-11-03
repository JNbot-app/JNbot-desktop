import type {
  RecipeComparisonOperator,
  RecipeLiteralValue,
} from '../../../../../common/recipeV3';

export type InstructionSource = {
  recipeId: string;
  stepId: string;
  callPath: string[];
};

export type RuntimeValue =
  | { kind: 'literal'; value: RecipeLiteralValue }
  | { kind: 'output'; key: string }
  | { kind: 'remembered'; key: string }
  | { kind: 'trigger'; outputId: string }
  | { kind: 'loop'; key: string; property?: string }
  | { kind: 'option'; optionId: string }
  | { kind: 'botProperty'; propertyId: string }
  | { kind: 'template'; parts: Array<string | RuntimeValue> }
  | {
      kind: 'expression';
      operator: 'add' | 'subtract' | 'multiply' | 'divide' | 'remainder';
      left: RuntimeValue;
      right: RuntimeValue;
    }
  | {
      kind: 'formula';
      expression: string;
      references: Record<string, RuntimeValue>;
    };

export type RuntimeCondition = {
  left: RuntimeValue;
  operator: RecipeComparisonOperator;
  right?: RuntimeValue;
  not?: boolean;
};

type BaseInstruction = {
  id: number;
  source: InstructionSource;
};

export type RecipeInstruction =
  | (BaseInstruction & {
      type: 'action';
      actionId: string;
      inputs: Record<string, RuntimeValue>;
      outputs: Record<string, string>;
    })
  | (BaseInstruction & {
      type: 'remember';
      key: string;
      value: RuntimeValue;
    })
  | (BaseInstruction & {
      type: 'if';
      match: 'all' | 'any';
      conditions: RuntimeCondition[];
      then: RecipeInstruction[];
      otherwise: RecipeInstruction[];
    })
  | (BaseInstruction & {
      type: 'repeat';
      count: RuntimeValue;
      loopKey: string;
      body: RecipeInstruction[];
    })
  | (BaseInstruction & {
      type: 'while';
      condition: RuntimeCondition;
      body: RecipeInstruction[];
    })
  | (BaseInstruction & {
      type: 'forEach';
      collectionId: string;
      usePluginFilters: boolean;
      showProgress: boolean;
      showControls: boolean;
      loopKey: string;
      body: RecipeInstruction[];
    })
  | (BaseInstruction & {
      type: 'parallel';
      branches: RecipeInstruction[][];
    })
  | (BaseInstruction & {
      type: 'waitForEvent';
      eventId: string;
      outputs: Record<string, string>;
    })
  | (BaseInstruction & {
      type: 'call';
      body: RecipeInstruction[];
      outputs: Record<string, RuntimeValue>;
    })
  | (BaseInstruction & { type: 'enableEvent'; recipeId: string })
  | (BaseInstruction & { type: 'developerCode'; code: string })
  | (BaseInstruction & { type: 'stop' })
  | (BaseInstruction & {
      type: 'return';
      scope: 'recipe' | 'event';
    });

export type CompiledEventRecipe = {
  recipeId: string;
  eventId: string;
  enabled: boolean;
  mode: 'every' | 'once';
  concurrency: 'queue' | 'parallel';
  instructions: RecipeInstruction[];
};

export type RecipeProgram = {
  kind: 'recipe-program';
  version: 3;
  onRun: RecipeInstruction[];
  events: CompiledEventRecipe[];
};
