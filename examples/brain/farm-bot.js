// Learned farmer: record yourself harvesting and replanting wheat in the JNbot
// Client, train on it, then let a bot keep the field going.
// Options: farm-bot.options.json.
//
// Targets are blocks here: fully grown wheat to break and empty farmland to
// plant on. The bot learns which one you go for (only ripe wheat, the nearest,
// replant before moving on…), walks there, then breaks it (attack) or plants
// (use) the way you did. Keep the recording focused: harvest and replant only.
const { Brain, script } = require('jnbot');

const ripe = (b) => b.name === 'wheat' && b.state?.age === 7;
// farmland with nothing planted on it
const emptyFarmland = (o, b, dx, dy, dz) => b.name === 'farmland' && o.block(dx, dy + 1, dz)?.name === 'air';

const brain = new Brain({
  name: 'farm-bot',
  // see further than the default 4 blocks so ripe wheat across the field is found
  observe: { blockRadius: 8, blockHeight: 2 },

  features: (o) => ({
    ripe: o.findBlocks(ripe).length,
    seeds: o.self.items.wheat_seeds ?? 0,
    holdingSeeds: o.self.held === 'wheat_seeds',
    onGround: o.self.onGround,
    terrain: Brain.rays(o, { count: 8, length: 4 }),
  }),

  target: {
    // every growth stage is a candidate, so the model learns that you only take age 7
    candidates: (o) => o.findBlocks((b, dx, dy, dz) => b.name === 'wheat' || emptyFarmland(o, b, dx, dy, dz)),
    features: (o, b) => ({
      wheat: b.name === 'wheat',
      age: b.state?.age,
      dist: b.dist,
      angle: b.angle,
      dy: b.dy,
      seeds: o.self.items.wheat_seeds ?? 0,
    }),
  },

  // attack breaks the target block, use right-clicks it (plants with seeds in hand)
  heads: ['forward', 'strafe', 'jump', 'sprint', 'attack', 'use', Brain.hold({ seeds: /wheat_seeds/ })],
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function record(minutes) {
  const [client] = await script.getMcClients();
  if (!client) throw new Error('Launch Minecraft with the JNbot Client and join a world first');

  const recording = await brain.record(script.getMcClient(client.clientId));
  const stopOnExit = script.onExit(() => recording.stop());
  console.log(`Recording ${client.username} for ${minutes} min. Harvest and replant!`);

  const end = Date.now() + minutes * 60_000;
  while (Date.now() < end) {
    script.updateProgress({ current: minutes * 60 - Math.ceil((end - Date.now()) / 1000), total: minutes * 60 });
    await sleep(1000);
  }
  await recording.stop();
  stopOnExit();
  console.log(`Saved ${recording.steps} steps to ${recording.file}`);
}

async function train() {
  console.log('Training…');
  const report = await brain.train();
  console.log(`Trained on ${report.steps} steps from ${report.recordings} recording(s)`);
  for (const [head, r] of Object.entries(report.heads)) {
    const accuracy = r.accuracy === undefined ? '' : ` accuracy ${(r.accuracy * 100).toFixed(1)}%`;
    console.log(`${head}:${accuracy} (${r.rows} rows, ${r.rounds} rounds) uses ${r.topFeatures.slice(0, 3).join(', ')}`);
  }
}

async function run() {
  const alt = script.getAlts().find((a) => a.username === script.settings.alt);
  if (!alt) throw new Error('Pick a bot in the options');

  const join = { gamemode: script.settings.gamemode, login: true };
  for await (const bot of script.forEachBot([alt], {}, { join })) await farm(bot);
}

async function farm(bot) {
  let lastLog = 0;
  const stop = brain.run(bot, {
    onStep: (o, d) => {
      if (Date.now() - lastLog < 2000) return;
      lastLog = Date.now();
      const target = d.target ? `${d.target.name}${d.target.state?.age !== undefined ? ` age ${d.target.state.age}` : ''} ${d.target.dist.toFixed(1)}m` : 'none';
      const action = d.navigating ? 'walking' : ['attack', 'use'].filter((h) => d.values[h]).join(' ') || '-';
      console.log(`ripe ${o.findBlocks(ripe).length} | ${action} | target ${target}`);
    },
  });
  script.onExit(stop);
  console.log(`${bot.username} is farming. Stop the plugin to stop it.`);
  await new Promise(() => {}); // keep running until the plugin is stopped
}

async function main() {
  const { mode } = script.settings;
  const minutes = Number(script.settings.minutes) || 5;
  if (mode === 'reset') return brain.reset();
  if (mode === 'record' || mode === 'all') await record(minutes);
  if (mode === 'train' || mode === 'all') await train();
  if (mode === 'run' || mode === 'all') await run();
}

main();
