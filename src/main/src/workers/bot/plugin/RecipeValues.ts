import math from 'math-expression-evaluator';
import type { RuntimeCondition, RuntimeValue } from './RecipeProgram';
import type { Bot } from '../../workerTypes';

export type ValueScope = {
  outputs: Map<string, any>;
  remembered: Map<string, any>;
  loops: Map<string, any>;
  trigger: Record<string, any>;
  options: Record<string, any>;
  bot: Bot | null;
};

const readBotProperty = (bot: Bot | null, propertyId: string) => {
  if (!bot) throw new Error('This value needs a connected bot.');
  if (propertyId === 'username') return bot.username;
  if (propertyId === 'health') return bot.health;
  if (propertyId === 'food') return bot.food;
  if (propertyId === 'oxygen') return bot.oxygenLevel;
  if (propertyId === 'positionX') return bot.entity?.position?.x;
  if (propertyId === 'positionY') return bot.entity?.position?.y;
  if (propertyId === 'positionZ') return bot.entity?.position?.z;
  if (propertyId === 'gamemode') return bot.getGamemode();
  if (propertyId === 'online') return bot.isOnline();
  if (propertyId === 'experienceLevel') return bot.experience?.level;
  throw new Error(`Unknown bot property: ${propertyId}`);
};

export function resolveValue(value: RuntimeValue, scope: ValueScope): any {
  switch (value.kind) {
    case 'literal':
      return value.value;
    case 'output':
      return scope.outputs.get(value.key);
    case 'remembered':
      return scope.remembered.get(value.key);
    case 'trigger':
      return scope.trigger[value.outputId];
    case 'loop': {
      const item = scope.loops.get(value.key);
      return value.property === undefined ? item : item?.[value.property];
    }
    case 'option':
      return scope.options[value.optionId];
    case 'botProperty':
      return readBotProperty(scope.bot, value.propertyId);
    case 'template':
      return value.parts
        .map((part) =>
          typeof part === 'string' ? part : resolveValue(part, scope),
        )
        .map((part) =>
          typeof part === 'object' ? JSON.stringify(part) : String(part ?? ''),
        )
        .join('');
    case 'expression': {
      const left = Number(resolveValue(value.left, scope));
      const right = Number(resolveValue(value.right, scope));
      if (value.operator === 'add') return left + right;
      if (value.operator === 'subtract') return left - right;
      if (value.operator === 'multiply') return left * right;
      if (value.operator === 'divide') return left / right;
      return left % right;
    }
    case 'formula': {
      const variables = Object.fromEntries(
        Object.entries(value.references).map(([name, reference]) => [
          name,
          resolveValue(reference, scope),
        ]),
      );
      return math.eval(
        value.expression.replace(/@([a-zA-Z_][a-zA-Z0-9_]*)/g, '$1'),
        variables,
      );
    }
    default:
      throw new Error('Unsupported recipe value.');
  }
}

export function matchesCondition(
  condition: RuntimeCondition,
  scope: ValueScope,
) {
  const left = resolveValue(condition.left, scope);
  const right = condition.right
    ? resolveValue(condition.right, scope)
    : undefined;
  let matches: boolean;
  switch (condition.operator) {
    case 'equal':
      matches = left === right;
      break;
    case 'notEqual':
      matches = left !== right;
      break;
    case 'contains':
      matches = String(left).includes(String(right));
      break;
    case 'notContains':
      matches = !String(left).includes(String(right));
      break;
    case 'greater':
      matches = Number(left) > Number(right);
      break;
    case 'less':
      matches = Number(left) < Number(right);
      break;
    case 'greaterEqual':
      matches = Number(left) >= Number(right);
      break;
    case 'lessEqual':
      matches = Number(left) <= Number(right);
      break;
    case 'true':
      matches = Boolean(left);
      break;
    case 'false':
      matches = !left;
      break;
    case 'matches':
      matches = new RegExp(String(right)).test(String(left));
      break;
    default:
      throw new Error(`Unsupported condition: ${condition.operator}`);
  }
  return condition.not ? !matches : matches;
}

export function matchesConditions(
  match: 'all' | 'any',
  conditions: RuntimeCondition[],
  scope: ValueScope,
) {
  const predicate = (condition: RuntimeCondition) =>
    matchesCondition(condition, scope);
  return match === 'any'
    ? conditions.some(predicate)
    : conditions.every(predicate);
}
