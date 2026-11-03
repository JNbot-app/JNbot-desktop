import {
  getRecipeAction,
  getRecipeEvent,
} from '../../../../../common/recipeCatalog';
import {
  normalizeRecipeDocument,
  type RecipeCondition,
  type RecipeDefinitionV3,
  type RecipeDocumentV3,
  type RecipeStep,
  type RecipeValue,
} from '../../../../../common/recipeV3';
import { validateRecipeDocument } from '../../../../../common/recipeValidation';
import type {
  CompiledEventRecipe,
  InstructionSource,
  RecipeInstruction,
  RecipeProgram,
  RuntimeCondition,
  RuntimeValue,
} from './RecipeProgram';

type CompileContext = {
  recipeId: string;
  callPath: string[];
  inputs: Record<string, RuntimeValue>;
};

const pathKey = (callPath: string[], id: string, output = 'value') =>
  [...callPath, id, output].join('/');

export default class RecipeCompiler {
  private readonly document: RecipeDocumentV3;
  private readonly recipes: Map<string, RecipeDefinitionV3>;
  private nextInstructionId = 1;

  constructor(document: RecipeDocumentV3) {
    this.document = normalizeRecipeDocument(document);
    this.recipes = new Map(
      this.document.recipes.map((recipe) => [recipe.id, recipe]),
    );
  }

  public compile(): RecipeProgram {
    const validation = validateRecipeDocument(this.document);
    if (!validation.valid) {
      throw new Error(
        validation.issues
          .filter((issue) => issue.severity === 'error')
          .map((issue) => issue.message)
          .join(' '),
      );
    }

    const onRun = this.document.recipes.find(
      (recipe) => recipe.role === 'onRun' && recipe.enabled,
    );
    if (!onRun) throw new Error('This plugin needs an enabled On Run recipe.');

    return {
      kind: 'recipe-program',
      version: 3,
      onRun: this.compileSteps(onRun.steps, this.context(onRun)),
      events: this.document.recipes
        .filter((recipe) => recipe.role === 'event')
        .map((recipe) => this.compileEvent(recipe)),
    };
  }

  private context(recipe: RecipeDefinitionV3): CompileContext {
    return { recipeId: recipe.id, callPath: [], inputs: {} };
  }

  private source(step: RecipeStep, context: CompileContext): InstructionSource {
    return {
      recipeId: context.recipeId,
      stepId: step.id,
      callPath: context.callPath,
    };
  }

  private instruction<T extends Omit<RecipeInstruction, 'id' | 'source'>>(
    step: RecipeStep,
    context: CompileContext,
    instruction: T,
  ): RecipeInstruction {
    return {
      ...instruction,
      id: this.nextInstructionId++,
      source: this.source(step, context),
    } as RecipeInstruction;
  }

  private compileEvent(recipe: RecipeDefinitionV3): CompiledEventRecipe {
    if (recipe.trigger?.kind !== 'botEvent') {
      throw new Error(`Event recipe "${recipe.name}" has no event.`);
    }
    if (!getRecipeEvent(recipe.trigger.eventId)) {
      throw new Error(`Unknown event: ${recipe.trigger.eventId}`);
    }
    return {
      recipeId: recipe.id,
      eventId: recipe.trigger.eventId,
      enabled: recipe.enabled,
      mode: recipe.trigger.mode,
      concurrency:
        recipe.trigger.concurrency === 'parallel' ? 'parallel' : 'queue',
      instructions: this.compileSteps(recipe.steps, this.context(recipe)),
    };
  }

  private compileSteps(
    steps: RecipeStep[],
    context: CompileContext,
  ): RecipeInstruction[] {
    return steps
      .filter((step) => !step.disabled)
      .flatMap((step) => this.compileStep(step, context));
  }

  private compileStep(
    step: RecipeStep,
    context: CompileContext,
  ): RecipeInstruction[] {
    switch (step.kind) {
      case 'action': {
        const action = getRecipeAction(step.actionId);
        if (!action) throw new Error(`Unknown action: ${step.actionId}`);
        return [
          this.instruction(step, context, {
            type: 'action',
            actionId: step.actionId,
            inputs: Object.fromEntries(
              action.inputs.map((input) => [
                input.id,
                this.compileValue(step.inputs[input.id], context),
              ]),
            ),
            outputs: Object.fromEntries(
              (action.outputs ?? []).map((output) => [
                output.id,
                pathKey(context.callPath, step.id, output.id),
              ]),
            ),
          }),
        ];
      }
      case 'remember':
        return [
          this.instruction(step, context, {
            type: 'remember',
            key: step.id,
            value: this.compileValue(step.value, context),
          }),
        ];
      case 'if':
        return [
          this.instruction(step, context, {
            type: 'if',
            match: step.match,
            conditions: step.conditions.map((condition) =>
              this.compileCondition(condition, context),
            ),
            then: this.compileSteps(step.then, context),
            otherwise: this.compileSteps(step.otherwise, context),
          }),
        ];
      case 'repeatCount':
        return [
          this.instruction(step, context, {
            type: 'repeat',
            count: this.compileValue(step.count, context),
            loopKey: pathKey(context.callPath, step.id, 'index'),
            body: this.compileSteps(step.steps, context),
          }),
        ];
      case 'repeatWhile':
        return [
          this.instruction(step, context, {
            type: 'while',
            condition: this.compileCondition(step.condition, context),
            body: this.compileSteps(step.steps, context),
          }),
        ];
      case 'forEach':
        return [
          this.instruction(step, context, {
            type: 'forEach',
            collectionId: step.collectionId,
            usePluginFilters: step.usePluginFilters !== false,
            showProgress: Boolean(step.showProgress),
            showControls: step.showControls !== false,
            loopKey: pathKey(context.callPath, step.id, 'item'),
            body: this.compileSteps(step.steps, context),
          }),
        ];
      case 'parallel':
        return [
          this.instruction(step, context, {
            type: 'parallel',
            branches: step.branches.map((branch) =>
              this.compileSteps(branch.steps, context),
            ),
          }),
        ];
      case 'callRecipe':
        return this.compileCall(step, context);
      case 'waitForEvent': {
        const event = getRecipeEvent(step.eventId);
        if (!event) throw new Error(`Unknown event: ${step.eventId}`);
        return [
          this.instruction(step, context, {
            type: 'waitForEvent',
            eventId: step.eventId,
            outputs: Object.fromEntries(
              event.outputs.map((output) => [
                output.id,
                pathKey(context.callPath, step.id, output.id),
              ]),
            ),
          }),
        ];
      }
      case 'developerCode':
        return [
          this.instruction(step, context, {
            type: 'developerCode',
            code: step.code,
          }),
        ];
      case 'stop':
        return [this.instruction(step, context, { type: 'stop' })];
      case 'return':
        return [
          this.instruction(step, context, {
            type: 'return',
            scope:
              this.recipes.get(context.recipeId)?.role === 'event'
                ? 'event'
                : 'recipe',
          }),
        ];
      default:
        throw new Error('Unsupported recipe step.');
    }
  }

  private compileCall(
    step: Extract<RecipeStep, { kind: 'callRecipe' }>,
    context: CompileContext,
  ): RecipeInstruction[] {
    const target = this.recipes.get(step.recipeId);
    if (!target || target.role === 'onRun')
      throw new Error('Recipe not found.');

    if (target.role === 'event') {
      return [
        this.instruction(step, context, {
          type: 'enableEvent',
          recipeId: target.id,
        }),
      ];
    }

    const inputs = Object.fromEntries(
      (target.inputs ?? []).map((input) => [
        input.id,
        this.compileValue(step.inputs[input.id] ?? input.defaultValue, context),
      ]),
    );
    const callContext: CompileContext = {
      recipeId: target.id,
      callPath: [...context.callPath, step.id],
      inputs,
    };
    const outputs = Object.fromEntries(
      (target.outputs ?? []).map((output) => [
        pathKey(context.callPath, step.id, output.id),
        this.compileValue(output.defaultValue, callContext),
      ]),
    );
    return [
      this.instruction(step, context, {
        type: 'call',
        body: this.compileSteps(target.steps, callContext),
        outputs,
      }),
    ];
  }

  private compileCondition(
    condition: RecipeCondition,
    context: CompileContext,
  ): RuntimeCondition {
    return {
      left: this.compileValue(condition.left, context),
      operator: condition.operator,
      not: condition.not,
      right: condition.right
        ? this.compileValue(condition.right, context)
        : undefined,
    };
  }

  private compileValue(
    value: RecipeValue | undefined,
    context: CompileContext,
  ): RuntimeValue {
    if (!value) return { kind: 'literal', value: '' };
    if (value.kind === 'literal') return value;
    if (value.kind === 'reference') {
      if (value.source === 'recipeInput') {
        return context.inputs[value.outputId] ?? { kind: 'literal', value: '' };
      }
      if (value.source === 'trigger') {
        return { kind: 'trigger', outputId: value.outputId };
      }
      if (value.source === 'pluginOption') {
        return { kind: 'option', optionId: value.outputId };
      }
      if (value.source === 'bot') {
        return { kind: 'botProperty', propertyId: value.outputId };
      }
      if (value.source === 'saved') {
        return { kind: 'remembered', key: value.sourceId ?? '' };
      }
      if (value.source === 'loop') {
        const loopOutput = value.outputId === 'item' ? 'item' : value.outputId;
        return {
          kind: 'loop',
          key: pathKey(
            context.callPath,
            value.sourceId ?? '',
            loopOutput === 'index' ? 'index' : 'item',
          ),
          property:
            loopOutput === 'item' || loopOutput === 'index'
              ? undefined
              : loopOutput,
        };
      }
      return {
        kind: 'output',
        key: pathKey(context.callPath, value.sourceId ?? '', value.outputId),
      };
    }
    if (value.kind === 'template') {
      return {
        kind: 'template',
        parts: value.parts.map((part) =>
          typeof part === 'string' ? part : this.compileValue(part, context),
        ),
      };
    }
    if (value.kind === 'formula') {
      return {
        kind: 'formula',
        expression: value.expression,
        references: Object.fromEntries(
          Object.entries(value.references ?? {}).map(([name, reference]) => [
            name,
            this.compileValue(reference, context),
          ]),
        ),
      };
    }
    return {
      kind: 'expression',
      operator: value.operator,
      left: this.compileValue(value.left, context),
      right: this.compileValue(value.right, context),
    };
  }
}
