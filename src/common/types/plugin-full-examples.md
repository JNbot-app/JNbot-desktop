# Complete example plugins

Each example is a full plugin: the option schema followed by the source. Copy the structure, not the server-specific details (commands, window titles, item names), which differ per server and should be options.

## Single alt: claim a kit on a timer (BotMachine)

One account, runs until the user stops it. BotMachine joins, enters the gamemode and reconnects after kicks; the tasks only describe what to do in each situation.

```json
[{"name":"General","options":[{"id":"alt","label":"Account","type":"altSelect"},{"id":"gamemode","label":"Gamemode","type":"gamemodeSelect"},{"id":"command","label":"Kit command","type":"input","defaultValue":"/kit"},{"id":"kit","label":"Kit item name","type":"input","defaultValue":"Daily"},{"id":"minutes","label":"Claim every (minutes)","type":"slider","min":1,"max":1440,"step":1,"defaultValue":60}]}]
```

```js
const { BotMachine, script } = require('jnbot');

const { alt, gamemode, command, kit, minutes } = script.settings;

function claimTasks() {
  return [
    {
      name: 'open kits menu',
      when: ({ bot, state }) => Date.now() >= state.nextClaim && !bot.currentWindow,
      run: ({ bot }) => bot.openWindow(command),
    },
    {
      name: 'claim kit',
      when: ({ bot, state }) => Date.now() >= state.nextClaim && Boolean(bot.currentWindow),
      run: async ({ bot, state }) => {
        if (!(await bot.items(kit).container().click()))
          console.warn(`No "${kit}" item in ${bot.getWindowTitle()}`);
        bot.closeWindow(bot.currentWindow);
        state.nextClaim = Date.now() + minutes * 60_000;
      },
    },
  ];
}

async function main() {
  const machine = new BotMachine(claimTasks(), {
    options: { username: alt },
    join: { gamemode, login: true },
    state: { nextClaim: 0 },
  }).start();
  script.onExit(() => machine.stop());
}

main();
```

## Many alts: collect kits and send them to a main account (forEachBot + BotMachine)

`forEachBot` filters the alts with the standard options (`gamemode`, `altRange`, `ignoreAlts`, `withTags`), joins each one and ends it after the loop body. The body awaits a per-bot BotMachine, so the bot stays online until its tasks are done.

```json
[{"name":"Alts","options":[{"id":"gamemode","label":"Gamemode","type":"gamemodeSelect"},{"id":"altRange","label":"Alt range","type":"altRange"},{"id":"withTags","label":"Only alts with tags","type":"tagsSelect"},{"id":"ignoreAlts","label":"Ignore alts","type":"altsSelect"}]},{"name":"Transfer","options":[{"id":"mainAccount","label":"Main account","type":"altSelect"},{"id":"transferMode","label":"Transfer with","type":"select","options":[{"label":"/trade","value":"trade"},{"label":"/gift","value":"gift"}],"defaultValue":"trade"},{"id":"kitCommand","label":"Kit command","type":"input","defaultValue":"/kit"},{"id":"kit","label":"Kit item name","type":"input","defaultValue":"Daily"}]}]
```

```js
const { BotMachine, script } = require('jnbot');

const { mainAccount, transferMode, kitCommand, kit } = script.settings;

// Build tasks per bot: `once` progress is stored on the task objects.
function collectTasks() {
  return [
    {
      name: 'claim kit',
      once: true,
      when: () => true,
      run: async ({ bot }) => {
        const window = await bot.openWindow(kitCommand);
        if (!window) return;
        await bot.items(kit).container().click();
        bot.closeWindow(window);
      },
    },
    {
      name: 'send items',
      when: () => true,
      run: async ({ bot, machine }) => {
        await bot.transfer(transferMode, mainAccount, { timeout: 60_000 });
        machine.finish();
      },
    },
  ];
}

async function main() {
  const alts = script.getAlts().filter((alt) => alt.username !== mainAccount);
  for await (const bot of script.forEachBot(alts, script.settings)) {
    await new Promise((resolve) =>
      new BotMachine(collectTasks(), { bot, disableAutoReconnect: true }).onFinish(resolve).start(),
    );
  }
}

main();
```

## Single alt: AI chat companion (script.llm with a fallback)

Most users have no AI provider set up, so check `isAvailable()` and tell the user what to do instead of failing.

```json
[{"name":"General","options":[{"id":"alt","label":"Account","type":"altSelect"},{"id":"gamemode","label":"Gamemode","type":"gamemodeSelect"},{"id":"persona","label":"Personality","type":"input","defaultValue":"a friendly, helpful player"}]}]
```

```js
const { Bot, script } = require('jnbot');

async function main() {
  if (!(await script.llm.isAvailable())) {
    script.notification({ type: 'warning', title: 'AI chat', message: 'Add an AI provider in Settings to use this plugin.' });
    return script.stop();
  }

  const bot = await Bot.join({ username: script.settings.alt }, { gamemode: script.settings.gamemode, login: true });
  const chat = script.llm.createChat({
    system: `You are ${bot.username}, ${script.settings.persona} on a Minecraft server. Reply in one short line.`,
    memory: 30,
  });

  bot.on('chat', async (username, message) => {
    if (username === bot.username || !message.toLowerCase().includes(bot.username.toLowerCase())) return;
    bot.chat(await chat.send(`${username}: ${message}`));
  });
}

main();
```

## Action for chains: buy an item

Actions run on a bot that is already online. `args[0]` holds values from earlier chain steps; the returned object adds values for later steps (`{item}` in text options). Return `false` or throw to take the chain's "If it fails" branch.

```json
[{"name":"General","options":[{"id":"command","label":"Shop command","type":"input","defaultValue":"/shop"},{"id":"item","label":"Item name","type":"input","defaultValue":"Diamond"}]}]
```

```js
async function main(bot, settings, args = []) {
  const previous = args[0] ?? {};
  const window = await bot.openWindow(settings.command);
  if (!window) return false;

  if (!(await bot.items(settings.item).container().click())) {
    bot.closeWindow(window);
    return false;
  }
  bot.closeWindow(window);
  return { item: settings.item, boughtBy: previous.alt ?? bot.username };
}
```
