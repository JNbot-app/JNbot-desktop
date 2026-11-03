// Learned mob fighter: record yourself fighting zombies, skeletons and spiders
// in the JNbot Client, train on it, then let a bot fight the same way.
// Options: mob-fighter.options.json.
//
// Every step (100 ms) each head makes its own decision and all of them are
// applied together: the bot can strafe + sprint + jump + attack at once, and
// switch to a bow, eat, or raise its shield (right click picks the right hand).
const { Brain, script } = require('jnbot');

const FOOD = /apple|bread|beef|porkchop|chicken|mutton|cod|salmon|potato|carrot|melon_slice|cookie|pie|stew|berries|rabbit/;
const ITEMS = { sword: /sword|axe/, bow: /bow/, food: FOOD };
const count = (o, test) =>
  Object.entries(o.self.items).reduce((sum, [name, n]) => sum + (test.test(name) ? n : 0), 0);

const brain = new Brain({
  name: 'mob-fighter',

  // What the bot looks at. Keep it small and relative to you; nested objects
  // become feature names like `melee.nearestDist` (shown in the training report).
  features: (o) => {
    // projectiles whose path passes within 1.5 blocks of you in the next second
    const incoming = o.entities.filter(
      (e) => e.projectile && e.closestIn > 0 && e.closestIn < 20 && e.closest < 1.5,
    );
    const skeleton = o.entities.find((e) => e.type === 'skeleton');
    return {
      health: o.self.health,
      food: o.self.food,
      onGround: o.self.onGround,
      falling: o.self.vy < -0.1,
      // which item is in hand (0 = other, then sword / bow / food)
      holding: Object.values(ITEMS).findIndex((test) => test.test(o.self.held)),
      shield: o.self.offHand === 'shield',
      // bow charge / eating / blocking progress, in ticks
      using: o.self.useTicks,
      arrows: count(o, /^arrow$/),
      foodItems: count(o, FOOD),
      incoming: {
        count: incoming.length,
        inTicks: incoming.length ? Math.min(...incoming.map((e) => e.closestIn)) : undefined,
        angle: incoming[0]?.angle,
      },
      // the nearest skeleton: is it aiming at you, and when did it last shoot?
      skeleton: skeleton && {
        dist: skeleton.dist,
        angle: skeleton.angle,
        dy: skeleton.dy,
        facingMe: skeleton.facingMe,
        sinceShot: skeleton.sinceShot,
      },
      // melee mobs per direction/distance band: same size for 1 or 10 mobs
      melee: Brain.swarm(o, { filter: (e) => e.hostile && e.type !== 'skeleton', sectors: 8, rings: [3, 8] }),
      ranged: Brain.swarm(o, { filter: (e) => e.type === 'skeleton', sectors: 4, rings: [16] }),
      // walls, drops and lava around you
      terrain: Brain.rays(o, { count: 8, length: 4 }),
    };
  },

  // Which mob to focus. Each candidate is scored on its own; the bot looks at
  // the winner (and leads + arcs its shots when holding a bow).
  target: {
    candidates: (o) => o.entities.filter((e) => e.hostile),
    features: (o, e) => ({
      type: ['zombie', 'skeleton', 'spider'].indexOf(e.type),
      dist: e.dist,
      angle: e.angle,
      dy: e.dy,
      approach: e.approach,
      health: e.health,
      facingMe: e.facingMe,
      sinceShot: e.sinceShot,
      holding: Object.values(ITEMS).findIndex((test) => test.test(o.self.held)),
    }),
  },

  // One small model per decision, all applied every step:
  //   forward: back / none / forward     strafe: left / none / right
  //   jump, sprint, attack: yes / no
  //   use: hold right click (eat, charge + release the bow, block with an off-hand shield)
  //   hold: which item to hold (other / sword / bow / food)
  heads: ['forward', 'strafe', 'jump', 'sprint', 'attack', 'use', Brain.hold(ITEMS)],
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function record(minutes) {
  const [client] = await script.getMcClients();
  if (!client) throw new Error('Launch Minecraft with the JNbot Client and join a world first');

  const recording = await brain.record(script.getMcClient(client.clientId));
  const stopOnExit = script.onExit(() => recording.stop());
  console.log(`Recording ${client.username} for ${minutes} min. Go fight some mobs!`);

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
  for await (const bot of script.forEachBot([alt], {}, { join })) await fight(bot);
}

async function fight(bot) {
  let lastLog = 0;
  const stop = brain.run(bot, {
    onStep: (o, d) => {
      if (Date.now() - lastLog < 2000) return;
      lastLog = Date.now();
      const moves = d.navigating ? 'walking to target' : ['back', '-', 'forward'][d.values.forward] + ' ' + ['left', '-', 'right'][d.values.strafe];
      const flags = ['jump', 'sprint', 'attack', 'use'].filter((h) => d.values[h]).join(' ');
      const item = ['-', 'sword', 'bow', 'food'][d.values.hold];
      console.log(`hp ${o.self.health.toFixed(0)} | ${item} | ${moves} ${flags} | target ${d.target ? `${d.target.type} ${d.target.dist.toFixed(1)}m` : 'none'}`);
    },
  });
  script.onExit(stop);
  console.log(`${bot.username} is fighting. Stop the plugin to stop it.`);
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
