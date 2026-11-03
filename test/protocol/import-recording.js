/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');

const [input, output] = process.argv.slice(2);
if (!input || !output) {
  throw new Error('Usage: npm run test:fixtures:import -- <recording.log> <scenario.json>');
}
if (fs.existsSync(output)) throw new Error(`Refusing to overwrite ${output}`);

const redacted = (value) => JSON.parse(JSON.stringify(value, (key, item) => {
  if (/password|token|uuid|username|host|ip|verification|code/i.test(key)) return '[redacted]';
  return item;
}));
const allowed = new Set(['login', 'position', 'playerlist_header', 'scoreboard_objective', 'scoreboard_display_objective', 'open_window', 'close_window', 'held_item_slot', 'respawn', 'kick_disconnect']);
const packets = fs.readFileSync(input, 'utf8').split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
const headerPath = input.replace(/\.log$/, '.json');
const version = fs.existsSync(headerPath) ? JSON.parse(fs.readFileSync(headerPath, 'utf8')).mcVersion : '1.8.9';
const steps = [];
for (const packet of packets.filter((entry) => allowed.has(entry.n))) {
  if (packet.d === 's2c' && ['login', 'position'].includes(packet.n) && !steps.some((step) => step.send === 'spawn')) {
    steps.push({ send: 'spawn' });
  }
  if (packet.d === 'c2s' && packet.n === 'held_item_slot' && Number.isInteger(packet.p?.slotId)) {
    steps.push({ expect: 'held_item_slot', slot: packet.p.slotId });
  }
}
const scenario = {
  name: path.basename(output, path.extname(output)),
  version,
  script: '// Add the target generated plugin code before running this captured navigation scenario.',
  source: 'navigation-only proxy recording; chat packets are discarded',
  safety: 'No claiming, purchases, trashing, gifting, or transfers are represented by imported fixtures.',
  steps: redacted(steps),
};
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, `${JSON.stringify(scenario, null, 2)}\n`);
console.log(`Wrote ${steps.length} sanitized navigation steps to ${output}`);
