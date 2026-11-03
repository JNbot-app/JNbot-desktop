import {
  getRecipeAction,
  getRecipeBotProperty,
  getRecipeCollection,
  getRecipeEvent,
} from './recipeCatalog';
import {
  analyzeRecipeBotEffects,
  stepUsesBotValue,
  type RecipeBotEffect,
} from './recipeAnalysis';
import {
  type RecipeDefinitionV3,
  type RecipeCondition,
  type RecipeDocumentV3,
  type RecipeStep,
  type RecipeValue,
  walkRecipeSteps,
} from './recipeV3';

export type RecipeValidationIssue = {
  severity: 'error' | 'warning';
  message: string;
  recipeId?: string;
  recipeName?: string;
  stepId?: string;
  componentName?: string;
  fieldId?: string;
};

export type RecipeValidationResult = {
  valid: boolean;
  issues: RecipeValidationIssue[];
};

function valueIsEmpty(value: RecipeValue | undefined): boolean {
  return (
    !value ||
    (value.kind === 'literal' &&
      (value.value === '' || value.value === null || value.value === undefined))
  );
}

function getComponentName(step: RecipeStep): string {
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

function validateValueScope(
  value: RecipeValue | undefined,
  visibleStepIds: Set<string>,
  issues: RecipeValidationIssue[],
  recipeId: string,
  stepId: string,
  fieldId?: string,
) {
  if (!value) return;
  if (
    value.kind === 'reference' &&
    value.source === 'bot' &&
    !getRecipeBotProperty(value.outputId)
  ) {
    issues.push({
      severity: 'error',
      message: 'This bot property no longer exists.',
      recipeId,
      stepId,
      fieldId,
    });
  }
  if (
    value.kind === 'reference' &&
    (value.source === 'step' ||
      value.source === 'saved' ||
      value.source === 'loop') &&
    (!value.sourceId || !visibleStepIds.has(value.sourceId))
  ) {
    issues.push({
      severity: 'error',
      message: 'This value is not available at this point in the recipe.',
      recipeId,
      stepId,
      fieldId,
    });
  } else if (value.kind === 'template') {
    value.parts.forEach((part) => {
      if (typeof part !== 'string')
        validateValueScope(
          part,
          visibleStepIds,
          issues,
          recipeId,
          stepId,
          fieldId,
        );
    });
  } else if (value.kind === 'expression') {
    validateValueScope(
      value.left,
      visibleStepIds,
      issues,
      recipeId,
      stepId,
      fieldId,
    );
    validateValueScope(
      value.right,
      visibleStepIds,
      issues,
      recipeId,
      stepId,
      fieldId,
    );
  } else if (value.kind === 'formula') {
    if (!value.expression.trim()) {
      issues.push({
        severity: 'error',
        message: 'Write an equation or use a fixed number instead.',
        recipeId,
        stepId,
        fieldId,
      });
    }
    const missing = [...value.expression.matchAll(/@([a-zA-Z_][a-zA-Z0-9_]*)/g)]
      .map((match) => match[1])
      .find((name) => !value.references?.[name]);
    if (missing) {
      issues.push({
        severity: 'error',
        message: `@${missing} is not an available value. Choose it from the @ menu.`,
        recipeId,
        stepId,
        fieldId,
      });
    }
    Object.values(value.references ?? {}).forEach((reference) =>
      validateValueScope(
        reference,
        visibleStepIds,
        issues,
        recipeId,
        stepId,
        fieldId,
      ),
    );
  }
}

function validateSteps(
  recipe: RecipeDefinitionV3,
  steps: RecipeStep[],
  issues: RecipeValidationIssue[],
  allStepIds: Set<string>,
  callableIds: Set<string>,
  recipes: Map<string, RecipeDefinitionV3>,
  botEffects: Map<string, RecipeBotEffect>,
  hasBot: boolean,
  visibleStepIds: Set<string> = new Set(),
): boolean {
  const validateConditions = (
    conditions: RecipeCondition[],
    stepId: string,
  ) => {
    if (conditions.length === 0) {
      issues.push({
        severity: 'error',
        message: 'Add at least one condition.',
        recipeId: recipe.id,
        stepId,
      });
    }
    conditions.forEach((condition) => {
      validateValueScope(
        condition.left,
        visibleStepIds,
        issues,
        recipe.id,
        stepId,
      );
      validateValueScope(
        condition.right,
        visibleStepIds,
        issues,
        recipe.id,
        stepId,
      );
    });
  };
  let botAvailable = hasBot;
  for (const step of steps) {
    if (!step.id || allStepIds.has(step.id)) {
      issues.push({
        severity: 'error',
        message: 'Every step must have a unique ID.',
        recipeId: recipe.id,
        stepId: step.id,
      });
    } else {
      allStepIds.add(step.id);
    }
    if (step.disabled) continue;

    if (!botAvailable && stepUsesBotValue(step)) {
      issues.push({
        severity: 'error',
        message: 'This value needs a connected bot at this point.',
        recipeId: recipe.id,
        stepId: step.id,
      });
    }

    if (step.kind === 'action') {
      const action = getRecipeAction(step.actionId);
      if (!action) {
        issues.push({
          severity: 'error',
          message: `Unknown action: ${step.actionId}`,
          recipeId: recipe.id,
          stepId: step.id,
        });
        continue;
      }
      if (action.requiresBot && !botAvailable) {
        issues.push({
          severity: 'error',
          message: `${action.name} needs a connected bot. Add Join server first.`,
          recipeId: recipe.id,
          stepId: step.id,
        });
      }
      action.inputs.forEach((definition) => {
        if (definition.required && valueIsEmpty(step.inputs[definition.id])) {
          issues.push({
            severity: 'error',
            message: `${definition.label} is required.`,
            recipeId: recipe.id,
            stepId: step.id,
            fieldId: definition.id,
          });
        }
        validateValueScope(
          step.inputs[definition.id],
          visibleStepIds,
          issues,
          recipe.id,
          step.id,
          definition.id,
        );
      });
      if (step.actionId === 'botJoin') botAvailable = true;
      visibleStepIds.add(step.id);
    } else if (step.kind === 'if') {
      validateConditions(step.conditions, step.id);
      const thenHasBot = validateSteps(
        recipe,
        step.then,
        issues,
        allStepIds,
        callableIds,
        recipes,
        botEffects,
        botAvailable,
        new Set(visibleStepIds),
      );
      const otherwiseHasBot = validateSteps(
        recipe,
        step.otherwise,
        issues,
        allStepIds,
        callableIds,
        recipes,
        botEffects,
        botAvailable,
        new Set(visibleStepIds),
      );
      botAvailable = thenHasBot && otherwiseHasBot;
    } else if (step.kind === 'repeatCount' || step.kind === 'repeatWhile') {
      if (step.kind === 'repeatCount')
        validateValueScope(
          step.count,
          visibleStepIds,
          issues,
          recipe.id,
          step.id,
        );
      else {
        validateValueScope(
          step.condition.left,
          visibleStepIds,
          issues,
          recipe.id,
          step.id,
        );
        validateValueScope(
          step.condition.right,
          visibleStepIds,
          issues,
          recipe.id,
          step.id,
        );
      }
      validateSteps(
        recipe,
        step.steps,
        issues,
        allStepIds,
        callableIds,
        recipes,
        botEffects,
        botAvailable,
        new Set([...visibleStepIds, step.id]),
      );
    } else if (step.kind === 'forEach') {
      if (!getRecipeCollection(step.collectionId)) {
        issues.push({
          severity: 'error',
          message: `Unknown collection: ${step.collectionId}`,
          recipeId: recipe.id,
          stepId: step.id,
        });
      }
      validateSteps(
        recipe,
        step.steps,
        issues,
        allStepIds,
        callableIds,
        recipes,
        botEffects,
        botAvailable || step.collectionId === 'bots',
        new Set([...visibleStepIds, step.id]),
      );
    } else if (step.kind === 'parallel') {
      if (step.branches.length < 2)
        issues.push({
          severity: 'error',
          message: 'Run together needs at least two branches.',
          recipeId: recipe.id,
          stepId: step.id,
        });
      step.branches.forEach((branch) =>
        validateSteps(
          recipe,
          branch.steps,
          issues,
          allStepIds,
          callableIds,
          recipes,
          botEffects,
          botAvailable,
          new Set(visibleStepIds),
        ),
      );
    } else if (step.kind === 'waitForEvent') {
      if (!botAvailable) {
        issues.push({
          severity: 'error',
          message:
            'Wait for an event needs a connected bot. Add Join server first.',
          recipeId: recipe.id,
          stepId: step.id,
        });
      }
      if (!getRecipeEvent(step.eventId)) {
        issues.push({
          severity: 'error',
          message: 'Choose an event to wait for.',
          recipeId: recipe.id,
          stepId: step.id,
        });
      }
      visibleStepIds.add(step.id);
    } else if (step.kind === 'callRecipe') {
      const called = recipes.get(step.recipeId);
      if (!called || !callableIds.has(step.recipeId)) {
        issues.push({
          severity: 'error',
          message: 'The selected recipe no longer exists.',
          recipeId: recipe.id,
          stepId: step.id,
        });
      } else {
        const effect = botEffects.get(step.recipeId);
        if (effect?.requiresBot && !botAvailable) {
          issues.push({
            severity: 'error',
            message: `${called.name} needs a connected bot. Join a server first.`,
            recipeId: recipe.id,
            stepId: step.id,
          });
        }
        if (effect?.providesBot) botAvailable = true;
      }
    } else if (
      step.kind === 'return' &&
      !['callable', 'event'].includes(recipe.role)
    ) {
      issues.push({
        severity: 'error',
        message: 'Exit recipe cannot be used in On Run.',
        recipeId: recipe.id,
        stepId: step.id,
      });
    } else if (step.kind === 'developerCode' && !step.code.trim()) {
      issues.push({
        severity: 'warning',
        message: 'This developer code step is empty.',
        recipeId: recipe.id,
        stepId: step.id,
      });
    }
    if (step.kind === 'remember') {
      validateValueScope(
        step.value,
        visibleStepIds,
        issues,
        recipe.id,
        step.id,
      );
      visibleStepIds.add(step.id);
    } else if (step.kind === 'callRecipe') {
      Object.entries(step.inputs).forEach(([fieldId, value]) =>
        validateValueScope(
          value,
          visibleStepIds,
          issues,
          recipe.id,
          step.id,
          fieldId,
        ),
      );
      visibleStepIds.add(step.id);
    }
  }
  return botAvailable;
}

function findCallCycles(document: RecipeDocumentV3): RecipeValidationIssue[] {
  const callable = new Map(
    document.recipes
      .filter((recipe) => recipe.role === 'callable')
      .map((recipe) => [recipe.id, recipe]),
  );
  const calls = (steps: RecipeStep[], output: string[] = []): string[] => {
    steps.forEach((step) => {
      if (step.kind === 'callRecipe') output.push(step.recipeId);
      else if (step.kind === 'if') {
        calls(step.then, output);
        calls(step.otherwise, output);
      } else if (
        step.kind === 'repeatCount' ||
        step.kind === 'repeatWhile' ||
        step.kind === 'forEach'
      )
        calls(step.steps, output);
      else if (step.kind === 'parallel')
        step.branches.forEach((branch) => calls(branch.steps, output));
    });
    return output;
  };
  const issues: RecipeValidationIssue[] = [];
  const visit = (id: string, path: string[]) => {
    if (path.includes(id)) {
      issues.push({
        severity: 'error',
        message:
          'Reusable recipes cannot call themselves, directly or indirectly.',
        recipeId: id,
      });
      return;
    }
    const recipe = callable.get(id);
    if (!recipe) return;
    calls(recipe.steps).forEach((next) => visit(next, [...path, id]));
  };
  callable.forEach((_, id) => visit(id, []));
  return issues;
}

export function validateRecipeDocument(
  document: RecipeDocumentV3,
): RecipeValidationResult {
  const issues: RecipeValidationIssue[] = [];
  const onRun = document.recipes.filter((recipe) => recipe.role === 'onRun');
  if (onRun.length !== 1)
    issues.push({
      severity: 'error',
      message: 'A plugin must contain exactly one On Run recipe.',
    });
  const recipeIds = new Set<string>();
  document.recipes.forEach((recipe) => {
    if (!recipe.id || recipeIds.has(recipe.id))
      issues.push({
        severity: 'error',
        message: 'Every recipe must have a unique ID.',
        recipeId: recipe.id,
      });
    recipeIds.add(recipe.id);
    if (!['onRun', 'event', 'callable'].includes(recipe.role))
      issues.push({
        severity: 'error',
        message: `The recipe type "${recipe.role}" is no longer supported.`,
        recipeId: recipe.id,
      });
    if (recipe.role === 'event') {
      if (
        !recipe.trigger ||
        recipe.trigger.kind !== 'botEvent' ||
        !getRecipeEvent(recipe.trigger.eventId)
      ) {
        issues.push({
          severity: 'error',
          message: 'Select a valid event trigger.',
          recipeId: recipe.id,
        });
      }
    }
  });
  const callableIds = new Set(
    document.recipes
      .filter((recipe) => recipe.role === 'callable' || recipe.role === 'event')
      .map((recipe) => recipe.id),
  );
  const recipes = new Map(
    document.recipes.map((recipe) => [recipe.id, recipe]),
  );
  const botEffects = analyzeRecipeBotEffects(document);
  const allStepIds = new Set<string>();
  document.recipes.forEach((recipe) => {
    // A callable inherits its caller's bot. Runtime validation gives the
    // useful error if a caller invokes it before joining.
    const eventHasBot = recipe.role === 'event' || recipe.role === 'callable';
    validateSteps(
      recipe,
      recipe.steps,
      issues,
      allStepIds,
      callableIds,
      recipes,
      botEffects,
      eventHasBot,
    );
  });
  issues.push(...findCallCycles(document));

  const recipeNames = new Map(
    document.recipes.map((recipe) => [recipe.id, recipe.name]),
  );
  const componentNames = new Map<string, string>();
  document.recipes.forEach((recipe) =>
    walkRecipeSteps(recipe.steps, (step) => {
      componentNames.set(step.id, getComponentName(step));
    }),
  );
  issues.forEach((issue) => {
    if (issue.recipeId) issue.recipeName = recipeNames.get(issue.recipeId);
    if (issue.stepId) issue.componentName = componentNames.get(issue.stepId);
  });

  return {
    valid: !issues.some((issue) => issue.severity === 'error'),
    issues,
  };
}
