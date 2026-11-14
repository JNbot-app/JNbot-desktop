// Canonical list of script names the worker knows how to run.
// Keep in sync with the SCRIPTS map in main.worker.js.
// `macro` and `chain` are internal entry points (plugins / chains) and are
// excluded from CLI listings.
const ALL_SCRIPT_NAMES = [
  'macro',
  'chat',
  // 'gkit collector',
  // 'gkit upgrader',
  // 'afk',
  // 'altScanner',
  // 'kit collector',
  // 'book sorter',
  'discordBot',
  'chain',
  'jnbotproxy',
  'mcpSession',
];

const INTERNAL_SCRIPT_NAMES = ['macro', 'chain', 'mcpSession'];

const USER_SCRIPT_NAMES = ALL_SCRIPT_NAMES.filter(
  (name) => !INTERNAL_SCRIPT_NAMES.includes(name),
);

module.exports = {
  ALL_SCRIPT_NAMES,
  USER_SCRIPT_NAMES,
  INTERNAL_SCRIPT_NAMES,
};
