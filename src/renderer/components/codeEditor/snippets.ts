import type * as Monaco from 'monaco-editor/esm/vs/editor/editor.api';

type Snippet = { label: string; detail: string; body: string };

// Bodies use Monaco snippet syntax: ${1:placeholder} tab stops, $0 final cursor.
const SNIPPETS: Snippet[] = [
  {
    label: 'tpl-plugin',
    detail: 'Template: run on every selected alt',
    body: `const { script } = require('jnbot');

for await (const bot of script.forEachBot(script.getAlts(), script.settings)) {
  $0
}
`,
  },
  {
    label: 'tpl-action',
    detail: 'Template: action on one connected bot',
    body: `async function main(bot, settings, args = []) {
  $0
}
`,
  },
  {
    label: 'tpl-botmachine',
    detail: 'Template: BotMachine task loop per alt',
    body: `const { script, BotMachine } = require('jnbot');

for await (const bot of script.forEachBot(script.getAlts(), script.settings)) {
  await new Promise((resolve) => {
    new BotMachine(
      [
        {
          name: '\${1:Open menu}',
          when: ({ bot }) => !bot.currentWindow,
          run: async ({ bot }) => {
            await bot.openWindow('\${2:/menu}');
          },
        },
        {
          name: 'Done',
          when: ({ bot }) => bot.getWindowTitle()?.includes('\${3:Menu}') ?? false,
          run: ({ machine }) => {
            $0
            machine.finish();
          },
        },
      ],
      { bot },
    )
      .onFinish(resolve)
      .start();
  });
}
`,
  },
  {
    label: 'tpl-chat',
    detail: 'Template: reply to chat messages',
    body: `const { script } = require('jnbot');

for await (const bot of script.forEachBot(script.getAlts(), script.settings)) {
  bot.on('messagestr', (message) => {
    if (message.includes('\${1:!ping}')) bot.chat('\${2:pong}');
  });
  await new Promise((resolve) => bot.once('end', resolve));
}
`,
  },
  {
    label: 'onchat',
    detail: 'Listen to chat messages',
    body: `bot.on('messagestr', (message) => {
  $0
});`,
  },
  {
    label: 'openwindow',
    detail: 'Open a window and click an item',
    body: `const window = await bot.openWindow('\${1:/menu}');
if (window) {
  const [item] = bot.findWindowSlots({ name: '\${2:Item name}' });
  if (item) await bot.clickWindow(item.slot, 0, 0);
}`,
  },
  {
    label: 'findblock',
    detail: 'Find the nearest block by name',
    body: `const block = bot.findBlock({
  matching: bot.registry.blocksByName.\${1:chest}.id,
  maxDistance: \${2:16},
});`,
  },
  {
    label: 'waitticks',
    detail: 'Wait for game ticks (20 = 1s)',
    body: 'await bot.waitForTicks(${1:20});',
  },
  {
    label: 'onexit',
    detail: 'Clean up when the plugin stops',
    body: `script.onExit(() => {
  $0
});`,
  },
];

export function registerSnippets(monaco: typeof Monaco) {
  const provider: Monaco.languages.CompletionItemProvider = {
    provideCompletionItems(model, position) {
      const word = model.getWordUntilPosition(position);
      const range = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: word.startColumn,
        endColumn: word.endColumn,
      };
      return {
        suggestions: SNIPPETS.map(({ label, detail, body }) => ({
          label,
          detail,
          documentation: { value: '```js\n' + body + '\n```' },
          kind: monaco.languages.CompletionItemKind.Snippet,
          insertText: body,
          insertTextRules:
            monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          range,
        })),
      };
    },
  };
  monaco.languages.registerCompletionItemProvider('javascript', provider);
  monaco.languages.registerCompletionItemProvider('typescript', provider);
}
