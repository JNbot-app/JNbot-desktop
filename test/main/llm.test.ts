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
