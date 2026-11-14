import { parseLlmJson, runLlmAgent, type LlmRequest } from '../../src/common/llm';

describe('LLM helpers', () => {
  test('runs tools until the model answers and keeps the conversation', async () => {
    const replies = [
      { text: '', toolCalls: [{ id: 't1', name: 'health', input: {} }] },
      { text: 'You have 20 health.', toolCalls: [] },
    ];
    const request: LlmRequest = { messages: [{ role: 'user', content: 'How am I?' }] };
    const runTool = jest.fn(async () => ({ health: 20 }));

    const answer = await runLlmAgent(async () => replies.shift()!, request, runTool);

    expect(answer).toBe('You have 20 health.');
    expect(runTool).toHaveBeenCalledWith({ id: 't1', name: 'health', input: {} });
    expect(request.messages.map(({ role }) => role)).toEqual(['user', 'assistant', 'tool', 'assistant']);
  });

  test('reports a failing tool to the model instead of throwing', async () => {
    const replies = [
      { text: '', toolCalls: [{ id: 't1', name: 'boom', input: {} }] },
      { text: 'That failed.', toolCalls: [] },
    ];
    const request: LlmRequest = { messages: [{ role: 'user', content: 'Go' }] };
    await runLlmAgent(async () => replies.shift()!, request, async () => {
      throw new Error('nope');
    });
    expect(request.messages[2]).toMatchObject({ role: 'tool', content: JSON.stringify({ error: 'nope' }) });
  });

  test('parses JSON with or without code fences', () => {
    expect(parseLlmJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(parseLlmJson('Here you go: [1,2]')).toEqual([1, 2]);
    expect(() => parseLlmJson('no json')).toThrow('did not return JSON');
  });
});

describe('grounding AI option values', () => {
  const { groundOptionValues, matchChoice } = require('../../src/main/src/functions/llm/groundOptions');
  const gamemodes = ['factionsImmortal', 'skyblock', 'prison'].map((value) => ({ label: value, value }));
  const options = [
    { id: 'gamemode', label: 'Gamemode', type: 'gamemodeSelect' },
    { id: 'speed', label: 'Speed', type: 'slider', min: 1, max: 10, step: 1 },
    { id: 'token', label: 'API token', type: 'input', inputType: 'password' },
    { id: 'enabled', label: 'Enabled', type: 'switch' },
  ];
  const choices = (option: { type: string }) => (option.type === 'gamemodeSelect' ? gamemodes : undefined);

  test('matches a loose name to the only fitting choice', () => {
    expect(matchChoice('factions', gamemodes)).toEqual(gamemodes[0]);
    expect(matchChoice('Sky Block', gamemodes)).toEqual(gamemodes[1]);
    expect(matchChoice('bedwars', gamemodes)).toBe('not one of the choices');
  });

  test('keeps valid changes and reports the rest', () => {
    const result = groundOptionValues(
      options,
      { gamemode: 'factions', speed: 14.4, token: 'abc', enabled: true, unknown: 1 },
      { enabled: true },
      choices,
    );
    expect(result.values).toEqual({ gamemode: 'factionsImmortal', speed: 10 });
    expect(result.changes.map(({ id }: { id: string }) => id)).toEqual(['gamemode', 'speed']);
    expect(result.skipped).toEqual([{ label: 'API token', value: 'abc', reason: 'set this one yourself' }]);
  });
});

test('runLlmAgent reports tool steps as progress', async () => {
  const replies = [
    { text: '', toolCalls: [{ id: 't1', name: 'look', input: {} }] },
    { text: 'Done', toolCalls: [] },
  ];
  const events: unknown[] = [];
  await runLlmAgent(async () => replies.shift()!, { messages: [] }, async () => null, {
    onEvent: (event) => events.push(event),
    describeTool: () => 'Looking around',
  });
  expect(events).toEqual([{ type: 'status', text: 'Looking around' }, { type: 'turn' }]);
});

describe('OpenAI-compatible streaming', () => {
  const http = require('node:http');
  const { completeOpenAi } = require('../../src/main/src/functions/llm/providers');

  test('streams text and reasoning and joins split tool calls', async () => {
    const chunks = [
      { choices: [{ delta: { reasoning: 'Let me think' } }] },
      { choices: [{ delta: { content: 'Hel' } }] },
      { choices: [{ delta: { content: 'lo' } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, id: 'c1', function: { name: 'look', arguments: '{"a"' } }] } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: ':1}' } }] } }] },
    ];
    const server = http.createServer((_req: any, res: any) => {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      // Split mid-line to check buffering.
      const body = chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join('') + 'data: [DONE]\n\n';
      res.write(body.slice(0, 30));
      setTimeout(() => res.end(body.slice(30)), 10);
    });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const events: unknown[] = [];
    try {
      const response = await completeOpenAi(
        { messages: [{ role: 'user', content: 'hi' }] },
        'model',
        `http://127.0.0.1:${server.address().port}`,
        undefined,
        { onEvent: (event: unknown) => events.push(event) },
      );
      expect(response.text).toBe('Hello');
      expect(response.toolCalls).toEqual([{ id: 'c1', name: 'look', input: { a: 1 } }]);
      expect(events).toEqual([
        { type: 'thinking', delta: 'Let me think' },
        { type: 'text', delta: 'Hel' },
        { type: 'text', delta: 'lo' },
      ]);
    } finally {
      server.close();
    }
  });
});

test('free-form options keep values that are not in their list', () => {
  const { groundOptionValues } = require('../../src/main/src/functions/llm/groundOptions');
  const options = [
    { id: 'items', label: 'Items', type: 'multiSelect', options: ['Diamond', 'Iron ingot'], freeSolo: true },
    { id: 'mode', label: 'Mode', type: 'select', options: [{ label: 'Safe', value: 'safe' }] },
  ];
  const choices = (option: any) =>
    option.type === 'multiSelect' ? option.options.map((value: string) => ({ label: value, value })) : option.options;
  const result = groundOptionValues(options, { items: ['iron ingot', 'Emerald'], mode: 'fast' }, {}, choices);
  expect(result.values).toEqual({ items: ['Iron ingot', 'Emerald'] });
  expect(result.skipped).toEqual([{ label: 'Mode', value: 'fast', reason: 'not one of the choices' }]);
});

describe('reading the editor AI reply', () => {
  const { parsePluginDraft, llmAnswerText } = require('../../src/common/llm');
  const plugin = "const { script } = require('jnbot');\nmain();";

  test('a plugin needs its code; details alone ask again', () => {
    expect(parsePluginDraft(`Done.\n\`\`\`js\n${plugin}\n\`\`\`\n\`\`\`json\n{"name":"A"}\n\`\`\``)).toEqual({ name: 'A', source: plugin });
    expect(parsePluginDraft('Fixed it.\n```json\n{"name":"A","optionSchema":[]}\n```')).toBe('missing');
  });

  test('a question gets an answer, snippets included', () => {
    const answer = 'It chats.\n```js\nbot.chat("hi")\n```';
    expect(parsePluginDraft(answer)).toEqual({ answer });
    expect(llmAnswerText(answer)).toBe(answer);
    expect(llmAnswerText(`Made it.\n\`\`\`js\n${plugin}\n\`\`\`\n\`\`\`json\n{}\n\`\`\``)).toBe('Made it.');
    expect(llmAnswerText(`Writing\n\`\`\`js\n${plugin}`)).toBe('Writing');
  });
});
