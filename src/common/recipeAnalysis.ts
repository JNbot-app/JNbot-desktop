import { getRecipeAction } from './recipeCatalog';
import type { RecipeDocumentV3, RecipeStep, RecipeValue } from './recipeV3';

export type RecipeBotEffect = {
  requiresBot: boolean;
  providesBot: boolean;
};

const valueUsesBot = (value?: RecipeValue): boolean => {
  if (!value) return false;
  if (value.kind === 'reference') return value.source === 'bot';
  if (value.kind === 'template')
    return value.parts.some(
      (part) => typeof part !== 'string' && valueUsesBot(part),
    );
  if (value.kind === 'expression')
    return valueUsesBot(value.left) || valueUsesBot(value.right);
  if (value.kind === 'formula')
    return Object.values(value.references ?? {}).some(valueUsesBot);
  return false;
};

export const stepUsesBotValue = (step: RecipeStep): boolean => {
  if (step.kind === 'action')
    return Object.values(step.inputs).some(valueUsesBot);
  if (step.kind === 'remember') return valueUsesBot(step.value);
  if (step.kind === 'repeatCount') return valueUsesBot(step.count);
  if (step.kind === 'if')
    return step.conditions.some(
      (condition) =>
        valueUsesBot(condition.left) || valueUsesBot(condition.right),
    );
  if (step.kind === 'repeatWhile')
    return (
      valueUsesBot(step.condition.left) || valueUsesBot(step.condition.right)
    );
  if (step.kind === 'callRecipe')
    return Object.values(step.inputs).some(valueUsesBot);
  return false;
};

function summarizeSteps(
  steps: RecipeStep[],
  effects: Map<string, RecipeBotEffect>,
): RecipeBotEffect {
  let hasBot = false;
  let requiresBot = false;

  for (const step of steps) {
    if (step.disabled) continue;
    if (step.kind === 'return') break;
    if (stepUsesBotValue(step)) requiresBot ||= !hasBot;

    if (step.kind === 'action') {
      const action = getRecipeAction(step.actionId);
      if (action?.requiresBot) requiresBot ||= !hasBot;
      if (step.actionId === 'botJoin') hasBot = true;
    } else if (step.kind === 'callRecipe') {
      const effect = effects.get(step.recipeId);
      if (effect?.requiresBot) requiresBot ||= !hasBot;
      if (effect?.providesBot) hasBot = true;
    } else if (step.kind === 'if') {
      const thenEffect = summarizeSteps(step.then, effects);
      const elseEffect = summarizeSteps(step.otherwise, effects);
      requiresBot ||=
        !hasBot && (thenEffect.requiresBot || elseEffect.requiresBot);
      hasBot ||= thenEffect.providesBot && elseEffect.providesBot;
    } else if (step.kind === 'parallel') {
      const branches = step.branches.map((branch) =>
        summarizeSteps(branch.steps, effects),
      );
      requiresBot ||= !hasBot && branches.some((effect) => effect.requiresBot);
    } else if (
      step.kind === 'repeatCount' ||
      step.kind === 'repeatWhile' ||
      step.kind === 'forEach'
    ) {
      const nested = summarizeSteps(step.steps, effects);
      const loopProvidesBot =
        step.kind === 'forEach' && step.collectionId === 'bots';
      requiresBot ||= !hasBot && nested.requiresBot && !loopProvidesBot;
    }
  }
  return { requiresBot, providesBot: hasBot };
}

/** Fixed-point summaries keep bot flow correct through chains of functions. */
export function analyzeRecipeBotEffects(document: RecipeDocumentV3) {
  const callable = document.recipes.filter(
    (recipe) => recipe.role === 'callable',
  );
  const effects = new Map<string, RecipeBotEffect>(
    callable.map((recipe) => [
      recipe.id,
      { requiresBot: false, providesBot: false },
    ]),
  );

  for (let pass = 0; pass <= callable.length; pass++) {
    let changed = false;
    callable.forEach((recipe) => {
      const next = summarizeSteps(recipe.steps, effects);
      const interfaceUsesBot = [
        ...(recipe.inputs ?? []),
        ...(recipe.outputs ?? []),
      ].some((parameter) => valueUsesBot(parameter.defaultValue));
      if (interfaceUsesBot && !next.providesBot) next.requiresBot = true;
      const previous = effects.get(recipe.id)!;
      if (
        previous.requiresBot !== next.requiresBot ||
        previous.providesBot !== next.providesBot
      ) {
        effects.set(recipe.id, next);
        changed = true;
      }
    });
    if (!changed) break;
  }
  return effects;
}
