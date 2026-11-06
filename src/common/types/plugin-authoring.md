# JNbot plugin authoring

Create or update plugins with `save_plugin`; do not merely return source code when the user asked for a plugin. Read this guide first and use `get_jnbot_reference` with the relevant section for an API you are unsure about.

## Entrypoints

Normal plugins own their bot lifecycle. Import `script` and read persistent options from `script.settings`.

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

In a chain, `args[0]` holds the values returned by earlier steps (plus `alt`, the bot's username). Return an object to add values for later steps, which users can insert into text options as `{name}`. Return `false` or throw to mark the step as failed, so the chain follows its "If it fails" choice. A chain can be started like a plugin with `script.startPlugin({ pluginId: 'chain:<chainId>' })`.

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

Local AI is available through `script.ai`. Create an agent with explicit tool names, descriptions, object JSON Schemas, and optional handlers. `predict()` returns proposed calls without executing them. `run()` makes one prediction and executes its accepted calls sequentially, retaining completed results if a later handler fails. Handler results are not sent back to the model. Each input is independent; unchanged tools stay prepared. Agents start with no tools and support `setTools`, `addTool`, `removeTool`, and `dispose`.

Choose `model: 'main'` for accuracy or `model: 'flash'` for lower memory use and faster inference. Main is the default. Both support tool calls and `script.ai.extract(text, schema, options)`, which returns a validated object or `null`. Reasoning is disabled by default. Pass `{ reasoning: true }` to `agent.predict()`, `agent.run()`, or `script.ai.extract()` to generate reasoning before tool calls. Pass `false` or omit the option to skip reasoning; predictions then return `reasoning: null`. `agent.embed(text, options)` returns `{ modelId, values }` using the agent's selected Gemma model, including its custom model URL. It accepts `signal` and `timeoutMs`, works without tools, and cancels when the agent is disposed. `script.ai.embed(text, options)` also remains available. Both embedding methods reject flash with `AI_UNSUPPORTED_FEATURE`. Rebuild stored embeddings when the model ID changes.

Tool filtering is disabled by default. On main, pass `{ toolFilterThreshold: 0.75 }` to `agent.predict()`, `agent.run()`, or `script.ai.extract()` to retain only tools whose name and description meet that cosine threshold. Values must be finite and between -1 and 1. Omit it or pass `null` to disable it; flash bypasses filtering. Tool vectors are cached in the inference worker, and the query encoding is shared with memory. When no tools survive, inference returns no match without decoding. Calibrate the threshold on your messages: similarity alone does not reliably distinguish placing from breaking, selling from buying, negation, or exact prices. The value 0.75 is an example, not a recommended default.

Pass `modelUrl` to `createAgent({ tools, model, modelUrl })`, `extract(text, schema, { model, modelUrl })`, or `embed(text, { model: 'main', modelUrl })` to use a custom model. The URL must download an HTTPS `.cact` file compatible with the selected variant. Omit it or pass a blank string to use the configured release model. An agent keeps its selected variant and URL. Downloads happen at first inference; creation and tool edits do not load a model. Installed files work offline, and flash can reuse a compatible installed main file. Publish new custom model versions at new URLs. Download or loading failures report an error without substituting another model. AI-authored plugins with external network access disabled cannot select custom models.

The model focuses on English. All supplied tools must fit within the model context; registration has no fixed tool count limit. Optional fields can be absent, and confidence can be `null`. Supported schema keywords are the fields of `AiSchema`; unsupported keywords fail at registration. Requests default to a 120-second deadline and 512 output tokens. Options accept `signal`, `timeoutMs`, and `maxNewTokens` where applicable. `run()` has no completion loop or step limit. A running handler cannot recursively call AI. Existing plugin permissions still apply to handlers.

Native support must be packaged for the device. Local inference supports desktop builds, Android ARM64, and iOS device and simulator builds. Other Android architectures return `AI_UNSUPPORTED_PLATFORM`. The app command UI and typing previews are not part of this API.

- Use `script.forEachBot(script.getAlts(), script.settings)` for multi-alt scripts; its settings object enables standard alt filters.
- Use `await bot.openWindow(command)` rather than sending a command then waiting for a window event.
- Use `bot.findWindowSlots()` before relying on slot numbers and `await bot.transferItems()` for supported transfer flows.
- Import JNbot helpers from `require('jnbot')`. Supported sandbox modules include `axios`, `events`, selected Prismarine modules, `vec3`, and `assert`; AI-authored plugins cannot use process, child processes, proxy APIs, account passwords, Fabric clients, or managed servers.
- [IMPORTANT] Use `BotMachine` for the entire bot task. Avoid creating long functions. Split the task up into smaller steps. This will allow the bot to recover from errors like if some action failed or the bot gets suddenly kicked to hub, BotMachine allows you to deal with these scenarios much easier. For the `when` condition, try to find when the bot should perform the action. For example, if the bot doesn\'t have a window opened -> do window action. Or if specific window must be opened, we can check it using bot.getWindowTitle(). Avoid doing stuff like state.step = "step1" and then checking for state.step === "step1" in the next task.
