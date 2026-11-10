/** Human-readable output for a replay report. */
const fmt = (n, d = 4) => (Number.isFinite(n) ? n.toFixed(d) : String(n));
const xyz = (p) => `${fmt(p.x)} ${fmt(p.y)} ${fmt(p.z)}`;
const ground = (g) => (g === undefined ? '?' : g ? 'ground' : 'air');
const after = (events) => (events.length ? `   after ${events.join(', ')}` : '');

function formatTask(task, report, issues) {
  const lines = [];
  const m = task.movement;
  const p = task.packets;
  lines.push(`${task.pass ? 'PASS' : 'FAIL'}  task ${task.name}  (ticks ${task.from}–${task.to})`);
  lines.push(
    `  movement  ${m.checked} checked, ${m.mismatches} mismatches, max error ${fmt(m.maxError)}, mean ${fmt(m.meanError, 6)} (tolerance ${report.tolerance})`,
  );
  lines.push(`  packets   ${p.checked} ticks checked, ${p.mismatches} mismatches`);
  const skipped = Object.entries(task.skipped);
  if (skipped.length) lines.push(`  skipped   ${skipped.map(([reason, n]) => `${n} ${reason}`).join(', ')}`);

  if (m.issues.length) {
    lines.push('', '  First movement mismatches (client = recorded, bot = engine):');
    for (const i of m.issues.slice(0, issues))
      lines.push(
        `    tick ${i.tick} @${i.t}s  error ${fmt(i.error, 5)}  Δ ${xyz(i.delta)}  input ${i.input}`,
        `      client ${xyz(i.client)} ${ground(i.client.onGround)}   bot ${xyz(i.bot)} ${ground(i.bot.onGround)}   bot velocity ${xyz(i.velocity)}` +
          after(i.events),
      );
  }
  const kinds = Object.entries(p.kinds).sort((a, b) => b[1] - a[1]);
  if (kinds.length) {
    lines.push('', '  Packet mismatches by kind:');
    for (const [kind, n] of kinds.slice(0, issues)) lines.push(`    ${String(n).padStart(5)}×  ${kind}`);
    lines.push('', '  First packet mismatches:');
    for (const i of p.issues.slice(0, issues))
      lines.push(`    tick ${i.tick} @${i.t}s  input ${i.input}  client [${i.client.join(', ')}]  bot [${i.bot.join(', ')}]` + after(i.events));
  }
  return lines.join('\n');
}

function formatReport(report, { issues = 10 } = {}) {
  const header = `${report.pass ? 'PASS' : 'FAIL'}  ${report.recording}  (${report.version}, ${report.ticks} ticks from ${report.mode}, inputs ${report.inputs}, engine ${report.engine})`;
  const warnings = report.warnings.map((w) => `  warning   ${w}`);
  return [header, ...warnings, ...report.tasks.map((task) => `\n${formatTask(task, report, issues)}`)].join('\n');
}

module.exports = { formatReport };
