import { convertLegacyCanvas } from '../../src/common/legacyRecipeConverter';
import {
  createDefaultRecipeDocument,
  literal,
  type RecipeDocumentV3,
} from '../../src/common/recipeV3';
import { validateRecipeDocument } from '../../src/common/recipeValidation';
import fs from 'fs';
import os from 'os';
import path from 'path';
import Macros from '../../src/main/src/functions/Macros';

describe('Recipe V3', () => {
  test('creates a valid empty On Run recipe', () => {
    const document = createDefaultRecipeDocument();
    expect(document.kind).toBe('recipe');
    expect(document.version).toBe(3);
    expect(validateRecipeDocument(document)).toMatchObject({ valid: true });
  });

  test('validates bot context and required inputs', () => {
    const document = createDefaultRecipeDocument();
    document.recipes[0].steps.push({
      id: 'chat',
      kind: 'action',
      actionId: 'botChat',
      inputs: { message: literal('hello') },
    });
    const result = validateRecipeDocument(document);
    expect(result.valid).toBe(false);
    expect(result.issues.some((issue) => issue.message.includes('connected bot'))).toBe(true);
  });

  test('rejects recursive reusable recipes', () => {
    const document = createDefaultRecipeDocument();
    document.recipes.push({
      id: 'helper',
      name: 'Helper',
      role: 'callable',
      enabled: true,
      steps: [
        {
          id: 'call-self',
          kind: 'callRecipe',
          recipeId: 'helper',
          inputs: {},
        },
      ],
    });
    expect(validateRecipeDocument(document).valid).toBe(false);
  });
});

describe('legacy graph conversion', () => {
  test('converts a linear graph and preserves node IDs', () => {
    const result = convertLegacyCanvas({
      nodes: [
        { id: 'start', type: 'start', data: { label: 'Start' } },
        {
          id: 'log',
          type: 'log',
          data: {
            label: 'Log',
            options: { message: { type: 'string', value: 'Hello' } },
          },
        },
      ],
      edges: [{ source: 'start', target: 'log', sourceHandle: 'default' }],
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.document.recipes[0].steps[0]).toMatchObject({
        id: 'log',
        kind: 'action',
        actionId: 'log',
      });
    }
  });

  test('falls back instead of changing ambiguous merged branches', () => {
    const result = convertLegacyCanvas({
      nodes: [
        { id: 'start', type: 'start' },
        { id: 'a', type: 'log', data: { options: {} } },
        { id: 'b', type: 'log', data: { options: {} } },
        { id: 'merge', type: 'log', data: { options: {} } },
      ],
      edges: [
        { source: 'start', target: 'a' },
        { source: 'start', target: 'b' },
        { source: 'a', target: 'merge' },
        { source: 'b', target: 'merge' },
      ],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reasons.join(' ')).toContain('Ambiguous');
    }
  });

  test('backs up the original graph before atomically saving V3', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'recipe-migration-'));
    const pluginId = 'migrationtest';
    const legacy = {
      nodes: [{ id: 'start', type: 'start', data: { options: {} } }],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
    };
    fs.writeFileSync(path.join(directory, `${pluginId}.json`), JSON.stringify(legacy));
    fs.writeFileSync(
      path.join(directory, `_${pluginId}.json`),
      JSON.stringify({
        name: 'Migration',
        description: '',
        pluginId,
        editedAt: null,
        createdAt: 1,
        public: false,
        language: 'components',
        scriptType: 'script',
      }),
    );
    const macros = new Macros({} as any);
    macros.macros_path = directory;
    const recipe = createDefaultRecipeDocument();
    expect(macros.migrateComponentsToRecipe(pluginId, recipe)).toMatchObject({
      status: 'success',
    });
    expect(
      JSON.parse(
        fs.readFileSync(
          path.join(directory, `${pluginId}.components-v2.backup.json`),
          'utf8',
        ),
      ),
    ).toEqual(legacy);
    expect(
      JSON.parse(
        fs.readFileSync(path.join(directory, `${pluginId}.json`), 'utf8'),
      ),
    ).toEqual(recipe);
    fs.rmSync(directory, { recursive: true, force: true });
  });
});
