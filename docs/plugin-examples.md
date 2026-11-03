# Compact plugin examples

## Local tool calls and extraction

```js
const { script } = require('jnbot');

async function main() {
  const schema = {
    type: 'object',
    properties: { quantity: { type: 'integer', minimum: 1 } },
    required: ['quantity'],
    additionalProperties: false,
  };
  // Use an HTTPS URL for a compatible fine-tuned .cact model, or leave blank.
  const modelUrl = '';
  const agent = script.ai.createAgent({ model: 'flash', modelUrl });
  agent.addTool({
    name: 'set_quantity',
    description: 'Set the requested item quantity',
    parameters: schema,
    handler: ({ quantity }) => {
      console.log(`Requested quantity: ${quantity}`);
      return { quantity };
    },
  });
  try {
    console.log(await agent.predict('Set quantity to 7')); // No handler runs.
    const result = await agent.run('Set quantity to 7');
    if (result.status === 'failed') console.log(result.error, result.results);
    console.log(await script.ai.extract('The quantity is 3', schema, { model: 'flash', modelUrl }));
    const { modelId, values } = await script.ai.embed('diamond sword', { model: 'main' });
    console.log(modelId, values.length);
    agent.removeTool('set_quantity');
    agent.setTools([]);
  } finally {
    agent.dispose();
  }
}
```

## Multi-alt chat plugin

```json
[{"name":"General","options":[{"id":"message","label":"Message","type":"input","defaultValue":"Hello"},{"id":"gamemode","label":"Gamemode","type":"gamemodeSelect"},{"id":"altRange","label":"Alt range","type":"altRange"},{"id":"ignoreAlts","label":"Ignore alts","type":"altsSelect"}]}]
```

```js
const { script } = require('jnbot');

async function main() {
  for await (const bot of script.forEachBot(script.getAlts(), script.settings, {
    join: { gamemode: script.settings.gamemode, login: true },
  })) bot.chat(script.settings.message);
}

main();
```

## Connected-bot action

```js
async function main(bot, settings, args = []) {
  await bot.openWindow(settings.command);
  return { command: settings.command, args };
}
```

## Rich option schema

```json
[{"name":"Settings","options":[{"id":"mode","label":"Mode","type":"select","options":[{"label":"Safe","value":"safe"},{"label":"Fast","value":"fast"}],"defaultValue":"safe"},{"id":"apiToken","label":"API token","type":"input","inputType":"password"},{"id":"targets","label":"Targets","type":"list","fields":[{"key":"name","label":"Name","type":"input"},{"key":"enabled","label":"Enabled","type":"switch","defaultValue":true}]},{"id":"home","label":"Home","type":"coordinate","withDimension":true}]}]
```

## Learned mob fighter (Brain)

Record yourself fighting in the JNbot Client, train, then let a bot copy you. Recordings store raw observations, so you can change `features` and train again without recording again.

```json
[{"name":"Brain","options":[{"id":"mode","label":"Mode","type":"select","options":[{"label":"Record (JNbot Client)","value":"record"},{"label":"Train","value":"train"},{"label":"Run on bot","value":"run"}],"defaultValue":"record"},{"id":"minutes","label":"Record minutes","type":"input","inputType":"number","defaultValue":"10"}]}]
```

```js
const { Brain, script } = require('jnbot');

const brain = new Brain({
  name: 'mob-fighter',
  features: (o) => ({
    health: o.self.health,
    onGround: o.self.onGround,
    mobs: Brain.swarm(o, { filter: (e) => e.hostile }),
    terrain: Brain.rays(o, { count: 8, length: 4 }),
  }),
  // which mob to focus: learned from the mob you attack next. The bot walks to it
  // with the pathfinder (around walls) and copies you once it's in reach and in
  // sight; every head also sees its features as `target.*`
  target: {
    candidates: (o) => o.entities.filter((e) => e.hostile),
    features: (o, e) => ({ dist: e.dist, angle: e.angle, dy: e.dy, approach: e.approach, health: e.health }),
  },
  heads: ['forward', 'strafe', 'jump', 'sprint', 'attack'],
});

async function main() {
  const { mode } = script.settings;
  if (mode === 'record') {
    const [client] = await script.getMcClients();
    if (!client) return console.log('Launch Minecraft with the JNbot Client first');
    const recording = await brain.record(script.getMcClient(client.clientId));
    script.onExit(() => recording.stop());
    const total = Number(script.settings.minutes) * 60;
    for (let seconds = 0; seconds < total; seconds++) {
      script.updateProgress({ current: seconds, total });
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    await recording.stop();
  } else if (mode === 'train') {
    console.log(await brain.train());
  } else {
    for await (const bot of script.forEachBot(script.getAlts().slice(0, 1), {})) {
      script.onExit(brain.run(bot));
      await new Promise(() => {}); // run until the plugin is stopped
    }
  }
}

main();
```

### Learned farmer (block targets)

Targets can be blocks too: `o.findBlocks(match)` lists blocks in the observed cube with their state (e.g. wheat `age`). The bot learns which block you break or right-click next, walks there, and then `attack` breaks it and `use` right-clicks it (planting seeds on farmland). Full plugin: `examples/brain/farm-bot.js`.

```js
const ripe = (b) => b.name === 'wheat' && b.state?.age === 7;
const brain = new Brain({
  name: 'farm-bot',
  observe: { blockRadius: 8 }, // see across the field
  features: (o) => ({ ripe: o.findBlocks(ripe).length, seeds: o.self.items.wheat_seeds ?? 0 }),
  target: {
    // all wheat (so it learns to wait for age 7) and empty farmland to replant
    candidates: (o) => o.findBlocks((b, dx, dy, dz) =>
      b.name === 'wheat' || (b.name === 'farmland' && o.block(dx, dy + 1, dz)?.name === 'air')),
    features: (o, b) => ({ wheat: b.name === 'wheat', age: b.state?.age, dist: b.dist, angle: b.angle }),
  },
  heads: ['forward', 'strafe', 'jump', 'attack', 'use', Brain.hold({ seeds: /wheat_seeds/ })],
});
```
