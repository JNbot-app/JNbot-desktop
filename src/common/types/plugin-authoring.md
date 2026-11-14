# JNbot plugin authoring

Create or update plugins with `save_plugin`; do not merely return source code when the user asked for a plugin. Read this guide first and use `get_jnbot_reference` with the relevant section for an API you are unsure about.

## Entrypoints

Normal plugins own their bot lifecycle. Import `script` and read persistent options from `script.settings`. Pick the join pattern by how many alts the plugin drives:

- **One alt** (an `altSelect` option, a main account, a single bot): drive it with `BotMachine`, which joins, logs in, enters the gamemode and reconnects after kicks. For a short one-off step, `await Bot.join({ username }, { gamemode, login: true })` is enough. Do not use `forEachBot` or `getAlts().slice(0, 1)` for this.
- **Many alts** (loop over the user's alts with filters such as tags, ranks, `altRange`, ignored alts): use `script.forEachBot(script.getAlts(), script.settings)`. It filters the alts, wires the pause/skip/previous buttons, joins each alt and ends it after the loop body.

```js
const { BotMachine, script } = require('jnbot');

async function main() {
  new BotMachine(
    [
      {
        name: 'open kits menu',
        when: ({ bot, state }) => !state.claimed && !bot.currentWindow,
        run: ({ bot }) => bot.openWindow('/kit'),
      },
      {
        name: 'claim kit',
        when: ({ bot, state }) => !state.claimed && bot.getWindowTitle()?.includes('Kits'),
        run: async ({ bot, state }) => {
          await bot.items(script.settings.kit).click();
          state.claimed = true;
        },
      },
      { name: 'done', when: ({ state }) => state.claimed, run: ({ machine }) => machine.stop() }, // stop() also disconnects the bot
    ],
    { options: { username: script.settings.alt }, join: { gamemode: script.settings.gamemode, login: true } },
  )
    .onFinish(() => script.stop())
    .start();
}

main();
```

```js
const { script } = require('jnbot');

async function main() {
  for await (const bot of script.forEachBot(script.getAlts(), script.settings)) {
    bot.chat(script.settings.message);
  }
}

main();
```

Actions run on one already-connected bot. They must define `async function main(bot, settings, args = [])`; never join another bot in an action. `settings` is the saved option object plus run-time overrides. `args` is transient positional input only.

```js
async function main(bot, settings, args = []) {
  bot.chat(settings.message);
  return { sent: settings.message, args };
}
```

When a server's gamemode join or gamemode display does not match JNbot's defaults, override them per bot from the profile's on-join action, before any `await`. `bot.join`, `BotMachine` and `Bot.join({ gamemode })` all use the handler; reconnects, relog retries and sessions keep working. The handler resolves once the bot is in the gamemode and returns `false` or throws when it could not get there. The detector makes `bot.getGamemode()` report the current gamemode; without one it reports the last gamemode a join confirmed.

```js
async function main(bot) {
  bot.setGamemodeDetector((bot) => bot.scoreboard.sidebar?.title ?? null);
  bot.setJoinHandler(async (gamemode, bot) => {
    await bot.openWindow('/menu');
    if (!(await bot.items(gamemode).click())) return false;
    await bot.waitForTicks(40);
  });
}
```

In a chain, `args[0]` holds the values returned by earlier steps (plus `alt`, the bot's username). Return an object to add values for later steps, which users can insert into text options as `{name}`. Return `false` or throw to mark the step as failed, so the chain follows its "If it fails" choice. A chain can be started like a plugin with `script.startPlugin({ pluginId: 'chain:<chainId>' })`.

A chain can also store setup code: JavaScript that runs for every alt before the steps, with `chain`, `bot` and `options` in scope (`return` and `await` work); `options` holds the values of the chain's own options, defined with the same schema as a plugin's `config` and set in the chain's settings. Inside it, and in plugins run by a chain (`require('JNbot').chain`, `null` elsewhere), the chain API controls the chain for the current alt: read `steps`, `current`, `bot` and `data`; a step is referred to by its id, plugin id (first step running it; survives renames) or name; `setOptions(step, options)` forces options for a step; `runStep(step, options?)` runs a step with its overrides plus yours; `disableStep`/`enableStep`, `addStep`, `goTo`, `skipAlt` and `stop` change what comes next. `chain.patch(step, machine => …)` changes another plugin's `BotMachine` tasks by name (`insertBefore`, `insertAfter`, `replaceTask`, `removeTask`, `wrapTask`) right before it starts, without editing that plugin.

## Options

Add an option for any value a user may want to change without editing code. Read it as `script.settings.optionId` in normal plugins or `settings.optionId` in actions. Schemas are arrays of named sections. Every option needs a stable URL-safe `id`, a label, and a type. Never set defaults for passwords, tokens, credentials, or API keys.

| Type | Stored value | Required configuration |
| --- | --- | --- |
| `input` | string or number | `inputType` may be `text`, `number`, or `password` |
| `switch` | boolean | none |
| `select` | string or number | non-empty `{ label, value }[]` `options` |
| `multiSelect` | string array | non-empty string `options` |
| `slider` | number | `min`, `max`, positive `step` |
| `gamemodeSelect` | string or string array | optional `multiple` |
| `altSelect` / `altsSelect` | alt name / alt-name array | none |
| `tagsSelect` | tag-ID array | none |
| `altRange` | `[start|null, end|null]` | none |
| `list` | object array | 1–6 unique `fields` |
| `coordinate` | `{ x?, y?, z?, dimension? }` | optional `withDimension` |
| `keybind` | string | optional `simple` |
| `scriptSelect` | script ID / ID array with `multiple` | optional `kinds` (`profileScript`, `action`, `recording`, `plugin`, `chain`; default all) |

```json
[
  {
    "name": "General",
    "options": [
      { "id": "message", "label": "Message", "type": "input", "defaultValue": "Hello" },
      { "id": "repeat", "label": "Repeat", "type": "slider", "min": 1, "max": 10, "step": 1, "defaultValue": 1 },
      { "id": "enabled", "label": "Enabled", "type": "switch", "defaultValue": true }
    ]
  }
]
```

Use `valueByFieldId` only to make an eligible `select`, `gamemodeSelect`, `altSelect`, or `keybind` option control how another option is stored.


## Save workflow

1. Determine whether the request is a normal plugin or an action.
2. Create the source and an option schema together when settings are needed.
3. Call `save_plugin` with `mode: "source"`; include `pluginId` only when updating.
4. Poll `get_operation` rather than resubmitting a pending save.
5. Report the installed plugin ID or the actionable validation/approval result.



## Preferred APIs

Cloud AI is available through `script.llm` when the user added an AI provider (Claude, Gemini, OpenAI, OpenRouter or Ollama) in Settings; most users have not, so check `await script.llm.isAvailable()` first and degrade gracefully. Use `script.llm.ask(prompt, { system, tools })` for one answer, `askJson` for parsed JSON, and `createChat({ system, tools, memory })` for a conversation that remembers earlier messages (`chat.send(text)` returns the reply). Tools are `{ name, description, parameters?, run(input) }`; their results are sent back to the model. Use it for free-form text such as a chat persona; prefer `script.ai` for local tool calling and extraction.

Local AI is available through `script.ai`. Create an agent with explicit tool names, descriptions, object JSON Schemas, and optional handlers. `predict()` returns proposed calls without executing them. `run()` makes one prediction and executes its accepted calls sequentially, retaining completed results if a later handler fails. Handler results are not sent back to the model. Each input is independent; unchanged tools stay prepared. Agents start with no tools and support `setTools`, `addTool`, `removeTool`, and `dispose`.

There is one built-in model. It supports tool calls and `script.ai.extract(text, schema, options)`, which returns a validated object or `null`. Reasoning is disabled by default. Pass `{ reasoning: true }` to `agent.predict()`, `agent.run()`, or `script.ai.extract()` to generate reasoning before tool calls; predictions otherwise return `reasoning: null`.

`windowSize` sets how many tokens the model can look back on (1 to 8192, default 512). Raise it, for example to 1024, when the tool list plus the message is longer than about 512 tokens; larger windows use more memory and are a little slower. Pass it to `createAgent({ tools, windowSize })` or `extract(text, schema, { windowSize })`.

The tool list is prefilled once and cached: later requests with the same tools only process the new message, so keep an agent's tools stable between requests for the fastest responses.

Pass `modelUrl` to `createAgent({ tools, modelUrl })` or `extract(text, schema, { modelUrl })` to use a custom model. The URL must download an HTTPS `.cact` file compatible with the built-in model. Omit it or pass a blank string to use the configured release model. Downloads happen at first inference; creation and tool edits do not load a model. Installed files work offline. Publish new custom model versions at new URLs. Download or loading failures report an error without substituting another model. AI-authored plugins with external network access disabled cannot select custom models.

The model focuses on English. All supplied tools must fit within the model context; registration has no fixed tool count limit. Optional fields can be absent, and confidence can be `null`. Supported schema keywords are the fields of `AiSchema`; unsupported keywords fail at registration. Requests default to a 120-second deadline and 512 output tokens. Options accept `signal`, `timeoutMs`, and `maxNewTokens` where applicable. `run()` has no completion loop or step limit. A running handler cannot recursively call AI. Existing plugin permissions still apply to handlers.

Native support must be packaged for the device. Local inference supports desktop builds, Android ARM64, and iOS device and simulator builds. Other Android architectures return `AI_UNSUPPORTED_PLATFORM`. The app command UI and typing previews are not part of this API.

- Use `script.forEachBot(script.getAlts(), script.settings)` only when looping over several alts; its settings object enables the standard alt filters. For one alt use `BotMachine` with `options: { username }` (or `Bot.join`). Inside a `forEachBot` loop you can still hand the yielded bot to `new BotMachine(tasks, { bot })`.
- Use `await bot.openWindow(command)` rather than sending a command then waiting for a window event.
- Use `bot.items(name)` before relying on slot numbers and `await bot.transfer(mode, target, { items, exclude, keys })` (or `bot.items(query).transfer(mode, target)`) to trade, gift, store or trash items.
- Import JNbot helpers from `require('jnbot')`. Supported sandbox modules include `axios`, `events`, selected Prismarine modules, `vec3`, and `assert`; AI-authored plugins cannot use process, child processes, proxy APIs, account passwords, Fabric clients, or managed servers.
- [IMPORTANT] Use `BotMachine` for the entire bot task. Avoid creating long functions. Split the task up into smaller steps. This will allow the bot to recover from errors like if some action failed or the bot gets suddenly kicked to hub, BotMachine allows you to deal with these scenarios much easier. For the `when` condition, try to find when the bot should perform the action. For example, if the bot doesn\'t have a window opened -> do window action. Or if specific window must be opened, we can check it using bot.getWindowTitle(). Avoid doing stuff like state.step = "step1" and then checking for state.step === "step1" in the next task.

## Common mistakes

Check the plugin against this list before saving it.

- **`forEachBot` for one account.** `script.forEachBot(script.getAlts().slice(0, 1), ...)` or a loop over a single `altSelect` value. Use `new BotMachine(tasks, { options: { username }, join: { gamemode, login: true } })` or `Bot.join` instead.
- **Not awaiting work inside a `forEachBot` loop.** The bot is ended as soon as the loop body returns, so starting a BotMachine or registering listeners without awaiting them disconnects the bot immediately. Await the work, e.g. `await new Promise((resolve) => new BotMachine(tasks, { bot }).onFinish(resolve).start())`.
- **Sharing one task array between machines.** `once` progress is stored on the task objects, so build the tasks in a function and call it per bot.
- **Step counters in BotMachine state.** `state.step = 2` then `when: ({ state }) => state.step === 2` breaks after a kick or failed action. Guard on what the bot can observe: open window and its title, inventory contents, position, timestamps.
- **One long linear `async` function.** It cannot recover from kicks, lag or a menu that did not open. Split it into BotMachine tasks.
- **Sending a command and waiting for `windowOpen`.** Use `const window = await bot.openWindow(command)` and handle `null` (timed out).
- **Hard-coded slot numbers.** Menus differ per server and update; look items up with `bot.items(name)` or `bot.items({ lore })` (case-insensitive substring, colors stripped). `bot.findWindowSlots` is deprecated.
- **Hard-coded values the user may want to change.** Commands, item names, accounts, gamemodes, delays and amounts belong in options. Never give passwords, tokens or API keys a default value.
- **Joining a bot inside an action.** Actions receive an already-connected bot; only normal plugins join.
- **Deprecated globals.** Import everything from `require('jnbot')` (`script`, `Bot`, `BotMachine`, ...) instead of the global `script`, `join`, `BotMachine` or `BotStatemachine`; use `console.log` instead of `log`.
- **Using `script.llm` without `await script.llm.isAvailable()`.** Most users have no AI provider; notify them and stop instead of throwing.
- **Forgetting `main()`.** Normal plugins must call `main()` at the end of the file; actions must not.
- **Inventing API members.** If a method is not in the reference, it does not exist. Look it up with `get_jnbot_reference` or ask instead of guessing.
