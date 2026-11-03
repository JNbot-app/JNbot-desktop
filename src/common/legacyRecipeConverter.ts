import {
  getRecipeCollection,
  recipeActionCatalog,
  recipeEventCatalog,
} from './recipeCatalog';
import {
  RECIPE_DOCUMENT_VERSION,
  createRecipeId,
  literal,
  type RecipeDefinitionV3,
  type RecipeDocumentV3,
  type RecipeStep,
  type RecipeValue,
} from './recipeV3';

type LegacyOption = { type?: string; value?: unknown };
type LegacyNode = {
  id: string;
  type?: string;
  data?: {
    label?: string;
    options?: Record<string, LegacyOption>;
    output?: Record<string, string>;
  };
};
type LegacyEdge = {
  source: string;
  target: string;
  sourceHandle?: string | null;
};
export type LegacyCanvasLike = { nodes: LegacyNode[]; edges: LegacyEdge[] };

export type LegacyConversionResult =
  | { ok: true; document: RecipeDocumentV3; warnings: string[] }
  | { ok: false; reasons: string[] };

const controls = new Set([
  'start',
  'stop',
  'ifElse',
  'forLoop',
  'whileLoop',
  'forEachLoop',
  'forEachAlt',
  'forEachPlayer',
  'forEachEntity',
  'forEachItem',
  'forEachInventoryItem',
  'forEachWindowItem',
  'setVariable',
  'mathEval',
  'JS',
]);
const actionIds = new Set(recipeActionCatalog.map((action) => action.id));
const legacyActionIds = new Set([...actionIds, 'botLogin']);
const eventByNodeType = new Map(
  recipeEventCatalog.map((event) => [event.nodeType, event]),
);

function option(node: LegacyNode, id: string): LegacyOption {
  return node.data?.options?.[id] ?? {};
}

export function convertLegacyCanvas(
  canvas: LegacyCanvasLike,
): LegacyConversionResult {
  const reasons: string[] = [];
  const warnings: string[] = [];
  if (!Array.isArray(canvas.nodes) || !Array.isArray(canvas.edges))
    return {
      ok: false,
      reasons: ['The legacy document has no nodes or edges.'],
    };
  const nodes = new Map(canvas.nodes.map((node) => [node.id, node]));
  const starts = canvas.nodes.filter((node) => node.type === 'start');
  if (starts.length !== 1)
    reasons.push('The graph must contain exactly one Start component.');
  const unknown = canvas.nodes.filter(
    (node) =>
      !node.type ||
      (!controls.has(node.type) &&
        !legacyActionIds.has(node.type) &&
        !eventByNodeType.has(node.type)),
  );
  if (unknown.length)
    reasons.push(
      `Unknown components: ${unknown.map((node) => node.data?.label ?? node.type ?? node.id).join(', ')}.`,
    );

  const outgoing = new Map<string, Map<string, string[]>>();
  const incoming = new Map<string, number>();
  const sourceForTarget = new Map<string, string>();
  canvas.edges.forEach((edge) => {
    if (!nodes.has(edge.source) || !nodes.has(edge.target)) {
      reasons.push(
        `Connection ${edge.source} → ${edge.target} points to a missing component.`,
      );
      return;
    }
    const handles = outgoing.get(edge.source) ?? new Map<string, string[]>();
    const handle = edge.sourceHandle ?? 'default';
    handles.set(handle, [...(handles.get(handle) ?? []), edge.target]);
    outgoing.set(edge.source, handles);
    incoming.set(edge.target, (incoming.get(edge.target) ?? 0) + 1);
    sourceForTarget.set(edge.target, edge.source);
  });
  const merges = [...incoming.entries()].filter(
    ([id, count]) => count > 1 && nodes.get(id)?.type !== 'start',
  );
  if (merges.length)
    reasons.push(
      `Ambiguous merged branches reach: ${merges.map(([id]) => nodes.get(id)?.data?.label ?? id).join(', ')}.`,
    );
  if (reasons.length || !starts[0]) return { ok: false, reasons };

  const variableRefs = new Map<
    string,
    { source: 'step' | 'loop'; sourceId: string; outputId: string }
  >();
  canvas.nodes.forEach((node) => {
    Object.entries(node.data?.output ?? {}).forEach(([outputId, name]) => {
      if (name)
        variableRefs.set(name, {
          source: node.type?.startsWith('for') ? 'loop' : 'step',
          sourceId: node.id,
          outputId,
        });
    });
    if (node.type === 'setVariable') {
      const name = option(node, 'variableName').value;
      if (typeof name === 'string' && name)
        variableRefs.set(name, {
          source: 'step',
          sourceId: node.id,
          outputId: 'value',
        });
    }
  });

  const toValue = (legacy: LegacyOption): RecipeValue => {
    if (legacy.type === 'variable' && typeof legacy.value === 'string') {
      const ref = variableRefs.get(legacy.value.replace(/^\$/, ''));
      if (ref) return { kind: 'reference', ...ref };
    }
    if (typeof legacy.value === 'string' && legacy.value.includes('$')) {
      const parts: Array<string | Exclude<RecipeValue, { kind: 'template' }>> =
        [];
      let cursor = 0;
      const regex = /\$(\w+)/g;
      let match: RegExpExecArray | null;
      while ((match = regex.exec(legacy.value))) {
        if (match.index > cursor)
          parts.push(legacy.value.slice(cursor, match.index));
        const ref = variableRefs.get(match[1]);
        parts.push(ref ? { kind: 'reference', ...ref } : match[0]);
        cursor = match.index + match[0].length;
      }
      if (cursor < legacy.value.length) parts.push(legacy.value.slice(cursor));
      return { kind: 'template', parts };
    }
    const value = legacy.value;
    if (
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean' ||
      value === null
    )
      return literal(value as string | number | boolean | null);
    return literal(value === undefined ? '' : JSON.stringify(value));
  };

  const visited = new Set<string>();
  const active = new Set<string>();
  const eventRecipes: RecipeDefinitionV3[] = [];
  const actionStepByNodeId = new Map<
    string,
    Extract<RecipeStep, { kind: 'action' }>
  >();

  const parseTargets = (targets: string[], context: string): RecipeStep[] => {
    if (!targets.length) return [];
    if (targets.length === 1) return parseSequence(targets[0]);
    const eventTargets = targets.filter((id) =>
      eventByNodeType.has(nodes.get(id)?.type ?? ''),
    );
    if (eventTargets.length === targets.length) {
      targets.forEach((id) => parseSequence(id));
      return [];
    }
    return [
      {
        id: createRecipeId('parallel'),
        kind: 'parallel',
        branches: targets.map((target, index) => ({
          id: createRecipeId('branch'),
          name: `Branch ${index + 1}`,
          steps: parseSequence(target),
        })),
      },
    ];
  };

  const parseSequence = (nodeId: string): RecipeStep[] => {
    const node = nodes.get(nodeId);
    if (!node || !node.type) return [];
    if (active.has(nodeId) || visited.has(nodeId)) {
      reasons.push(
        `The graph contains an unsupported cycle or shared branch at ${node.data?.label ?? nodeId}.`,
      );
      return [];
    }
    active.add(nodeId);
    visited.add(nodeId);
    const handles = outgoing.get(nodeId) ?? new Map<string, string[]>();
    const next = () => parseTargets(handles.get('default') ?? [], nodeId);
    let result: RecipeStep[] = [];
    const event = eventByNodeType.get(node.type);
    if (event) {
      const runOnce = Boolean(option(node, 'runOnce').value);
      eventRecipes.push({
        id: node.id,
        name: event.name,
        role: 'event',
        enabled: true,
        trigger: {
          kind: 'botEvent',
          eventId: event.id,
          mode: runOnce ? 'once' : 'every',
          concurrency: 'queue',
        },
        steps: next(),
      });
    } else if (node.type === 'stop') {
      result = [{ id: node.id, kind: 'stop' }];
    } else if (node.type === 'ifElse') {
      result = [
        {
          id: node.id,
          kind: 'if',
          match: 'all',
          conditions: [
            {
              left: toValue(option(node, 'condition1')),
              operator: (option(node, 'operator').value as any) ?? 'equal',
              right: toValue(option(node, 'condition2')),
            },
          ],
          then: parseTargets(handles.get('true') ?? [], `${nodeId}:true`),
          otherwise: parseTargets(
            handles.get('false') ?? [],
            `${nodeId}:false`,
          ),
        },
      ];
    } else if (node.type === 'forLoop') {
      result = [
        {
          id: node.id,
          kind: 'repeatCount',
          count: toValue(option(node, 'iterations')),
          steps: parseTargets(handles.get('true') ?? [], `${nodeId}:loop`),
        },
        ...parseTargets(handles.get('false') ?? [], `${nodeId}:finish`),
      ];
    } else if (node.type === 'whileLoop') {
      result = [
        {
          id: node.id,
          kind: 'repeatWhile',
          condition: {
            left: toValue(option(node, 'condition1')),
            operator: (option(node, 'operator').value as any) ?? 'equal',
            right: toValue(option(node, 'condition2')),
          },
          steps: parseTargets(handles.get('true') ?? [], `${nodeId}:loop`),
        },
        ...parseTargets(handles.get('false') ?? [], `${nodeId}:finish`),
      ];
    } else if (node.type.startsWith('forEach')) {
      const collectionMap: Record<string, string> = {
        forEachAlt: 'alts',
        forEachPlayer: 'players',
        forEachEntity: 'entities',
        forEachItem: 'items',
        forEachInventoryItem: 'inventory',
        forEachWindowItem: 'windowItems',
      };
      const collectionId = collectionMap[node.type];
      const collection = getRecipeCollection(collectionId);
      result = [
        {
          id: node.id,
          kind: 'forEach',
          collectionId: collection?.id ?? 'alts',
          steps: parseTargets(handles.get('true') ?? [], `${nodeId}:loop`),
        },
        ...parseTargets(handles.get('false') ?? [], `${nodeId}:finish`),
      ];
    } else if (node.type === 'setVariable') {
      result = [
        {
          id: node.id,
          kind: 'remember',
          name: String(option(node, 'variableName').value || 'Value'),
          value: toValue(option(node, 'value')),
        },
        ...next(),
      ];
    } else if (node.type === 'mathEval') {
      result = [
        {
          id: node.id,
          kind: 'remember',
          name: node.data?.output?.variableName ?? 'Result',
          value: {
            kind: 'formula',
            expression: String(option(node, 'expression').value ?? '0'),
          },
        },
        ...next(),
      ];
    } else if (node.type === 'JS') {
      result = [
        {
          id: node.id,
          kind: 'developerCode',
          code: String(option(node, 'code').value ?? ''),
        },
        ...next(),
      ];
    } else if (node.type === 'botLogin') {
      const precedingStep = actionStepByNodeId.get(
        sourceForTarget.get(node.id) ?? '',
      );
      if (precedingStep?.actionId === 'botJoin') {
        precedingStep.inputs.login = literal(true);
        result = next();
      } else {
        reasons.push(
          `${node.data?.label ?? 'Log in'} can only be migrated directly after Join server.`,
        );
      }
    } else if (actionIds.has(node.type)) {
      const action = recipeActionCatalog.find(
        (candidate) => candidate.id === node.type,
      )!;
      const actionStep: Extract<RecipeStep, { kind: 'action' }> = {
        id: node.id,
        kind: 'action',
        actionId: node.type,
        inputs: Object.fromEntries(
          action.inputs.map((definition) => [
            definition.id,
            toValue(option(node, definition.id)),
          ]),
        ),
      };
      actionStepByNodeId.set(node.id, actionStep);
      result = [actionStep, ...next()];
    }
    active.delete(nodeId);
    return result;
  };

  const startTargets = outgoing.get(starts[0].id)?.get('default') ?? [];
  visited.add(starts[0].id);
  const onRunSteps = parseTargets(startTargets, starts[0].id);
  const disconnected = canvas.nodes.filter((node) => !visited.has(node.id));
  if (disconnected.length)
    reasons.push(
      `Disconnected components would be lost: ${disconnected.map((node) => node.data?.label ?? node.id).join(', ')}.`,
    );
  if (reasons.length) return { ok: false, reasons: [...new Set(reasons)] };
  if (!startTargets.length) warnings.push('The On Run recipe is empty.');
  return {
    ok: true,
    warnings,
    document: {
      kind: 'recipe',
      version: RECIPE_DOCUMENT_VERSION,
      recipes: [
        {
          id: starts[0].id,
          name: 'On Run',
          role: 'onRun',
          enabled: true,
          trigger: { kind: 'run' },
          steps: onRunSteps,
        },
        ...eventRecipes,
      ],
    },
  };
}
