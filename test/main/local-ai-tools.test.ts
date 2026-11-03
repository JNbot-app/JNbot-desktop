import prepareTools from '../../src/main/src/ai/runtime/tools';

test('tool preparation uses ASCII aliases and restores Unicode and colliding public names', () => {
  const prepared = prepareTools([
    {
      name: 'SetValue',
      description: 'Set values',
      parameters: {
        type: 'object',
        properties: {
          myField: { type: 'string' },
          my_field: { type: 'string' },
          数量: {
            type: 'array',
            items: {
              type: 'object',
              properties: { café: { type: 'integer' } },
              required: ['café'],
            },
          },
        },
        required: ['myField', 'my_field', '数量'],
      },
    },
    {
      name: '工具',
      description: 'Unicode name',
      parameters: { type: 'object' },
    },
    { name: '!!!', description: 'Empty alias', parameters: { type: 'object' } },
  ]);
  expect(prepared.tools.map((tool) => tool.name)).toEqual([
    'set_value',
    'jn_field_1',
    'jn_field_2',
  ]);
  expect(prepared.tools[0].parameters.required).toEqual([
    'my_field',
    'my_field_',
    'jn_field_2',
  ]);
  expect(
    prepared.restore({
      name: 'set_value',
      arguments: { my_field: 'a', my_field_: 'b', jn_field_2: [{ caf: 3 }] },
    }),
  ).toEqual({
    name: 'SetValue',
    arguments: { myField: 'a', my_field: 'b', 数量: [{ café: 3 }] },
  });
  expect(prepared.restore({ name: 'jn_field_1', arguments: {} })).toEqual({
    name: '工具',
    arguments: {},
  });
});

test('tool preparation closes objects unless the schema says otherwise', () => {
  const prepared = prepareTools([
    {
      name: 'sell',
      description: 'Sell',
      parameters: {
        type: 'object',
        properties: {
          item: { type: 'object', properties: { id: { type: 'string' } } },
          extra: { type: 'object', additionalProperties: true },
        },
      },
    },
  ]);
  const { parameters } = prepared.tools[0];
  expect(parameters.additionalProperties).toBe(false);
  expect(parameters.properties?.item.additionalProperties).toBe(false);
  expect(parameters.properties?.extra.additionalProperties).toBe(true);
  expect(Object.keys(parameters).at(-1)).toBe('additionalProperties');
});
