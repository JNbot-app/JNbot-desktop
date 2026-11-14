// Generates the ambient plugin API reference from the authored contracts.
//
// The app's implementation types are split into focused files under
// src/common/types. This script assembles only the plugin-facing surface so
// Monaco, the bundled LLM reference, and external plugin workspaces stay in
// sync with the source contracts.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(__dirname, '..');
const typeRoot = path.join(appRoot, 'src/common/types');

// `topic` picks the split website context file (llm-<topic>.txt) a source lands in.
const TYPE_SOURCES = [
  { id: 'botApi', label: 'Bot API', topic: 'bot-api', file: path.join(typeRoot, 'botApi.d.ts') },
  { id: 'mcClientApi', label: 'Minecraft client API', topic: 'mc-client-api', file: path.join(typeRoot, 'McClientApi.d.ts') },
  { id: 'mcServerApi', label: 'Minecraft server API', topic: 'mc-server-api', file: path.join(typeRoot, 'mcServerApi.d.ts') },
  { id: 'proxyApi', label: 'JNbot proxy API', topic: 'proxy-api', file: path.join(typeRoot, 'proxyApi.d.ts') },
  { id: 'pluginOptions', label: 'Plugin options', topic: 'script-api', file: path.join(typeRoot, 'pluginOptions.d.ts') },
  { id: 'pluginApi', label: 'JNbot plugin API', topic: 'script-api', file: path.join(typeRoot, 'pluginApi.d.ts') },
  { id: 'brainApi', label: 'Brain API', topic: 'brain-api', file: path.join(typeRoot, 'brainApi.d.ts') },
  { id: 'declarePlugin', label: 'Plugin declarations', topic: 'script-api', file: path.join(typeRoot, 'declarePlugin.d.ts') },
];

const LLM_TOPICS = [
  { id: 'guide', title: 'Plugin authoring guide', use: 'Start here: entrypoints, single-alt vs multi-alt joining, BotMachine, options, examples.' },
  { id: 'examples', title: 'Complete example plugins', use: 'Full plugins with option schemas: single-alt BotMachine, multi-alt forEachBot, AI chat, chain action.' },
  { id: 'script-api', title: 'Script API', use: "`require('jnbot')` exports, `script.*`, BotMachine, Bot.join, option schema types." },
  { id: 'bot-api', title: 'Bot API', use: 'The mineflayer bot plus JNbot helpers (windows, items, transfers, movement).' },
  { id: 'mc-client-api', title: 'Minecraft client API', use: 'Driving a real Minecraft client launched with the JNbot Client mod.' },
  { id: 'mc-server-api', title: 'Minecraft server API', use: 'Managed servers: commands, players, worlds.' },
  { id: 'proxy-api', title: 'Proxy API', use: 'ProxyServer, sessions, packet pipelines and proxy plugins.' },
  { id: 'brain-api', title: 'Brain API', use: 'Learned bots: record a player, train, run on a bot.' },
];

const MCP_CONTEXT_DECLARATIONS = [
  {
    id: 'botApi',
    name: 'MineflayerBot',
    file: path.join(typeRoot, 'botApi.d.ts'),
    members: ['on', 'once', 'off', 'chat', 'whisper', 'blockAt', 'findBlock', 'findBlocks', 'nearestEntity', 'setControlState', 'getControlState', 'clearControlStates', 'lookAt', 'look', 'equip', 'dig', 'placeBlock', 'activateBlock', 'attack', 'swingArm', 'setQuickBarSlot', 'waitForTicks', 'respawn'],
  },
  {
    id: 'pluginApi',
    name: 'ScriptAPI',
    file: path.join(typeRoot, 'pluginApi.d.ts'),
    members: ['stop', 'restart', 'onExit', 'startPlugin', 'stopPlugin', 'prompt', 'notification', 'dialog', 'getAlts', 'requestAccountPassword', 'forEachBot', 'forEachAlt', 'startAction', 'getMcClient', 'getMcServer', 'automations', 'ai', 'llm', 'settings'],
  },
  {
    id: 'mcServerApi',
    name: 'IMcServer',
    file: path.join(typeRoot, 'mcServerApi.d.ts'),
    members: ['getStatus', 'executeCommand', 'broadcast', 'getPlayers', 'getPlayer', 'sendMessage', 'kickPlayer', 'getWorlds', 'getWorldInfo', 'apiList', 'apiVersion', 'apiCapabilities', 'request', 'on'],
  },
];

const TXT_OUT = path.join(
  appRoot,
  'src/renderer/assets/autoComplete/fullApiTypes.txt',
);
const PKG_DTS = path.resolve(appRoot, '../@jnbot-types/index.d.ts');
const APP_CONST = path.join(appRoot, 'src/common/pluginApiTypesSource.ts');
const GUIDE_CONST = path.join(appRoot, 'src/common/pluginAuthoringGuideSource.ts');
const MCP_REFERENCE_CONST = path.join(appRoot, 'src/common/pluginMcpReferenceSource.ts');
const GUIDE_SRC = path.join(appRoot, 'src/common/types/plugin-authoring.md');
const EXAMPLES_SRC = path.join(appRoot, 'src/common/types/plugin-examples.md');
const FULL_EXAMPLES_SRC = path.join(appRoot, 'src/common/types/plugin-full-examples.md');
const LLM_OUT = path.join(appRoot, 'assets/llm-all.txt');
const WEBSITE_LLM_DIR = path.resolve(appRoot, '../websitev3/public/llm');
const WEBSITE_URL = 'https://jnbot.netlify.app';
const INDEX_START = '<!-- jnbot-context-files:start -->';
const INDEX_END = '<!-- jnbot-context-files:end -->';

const BANNER =
  '// AUTO-GENERATED — do not edit by hand.\n' +
  '// Source: app/src/common/types/*.d.ts\n' +
  '// Regenerate with: node scripts/build-jnbot-types.mjs\n\n';
const check = process.argv.includes('--check');
const includeExternal = process.argv.includes('--external');

function writeGenerated(file, content) {
  const current = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
  if (check) {
    if (current !== content) throw new Error(`Generated file is stale: ${file}`);
    return;
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  console.log('Wrote', path.relative(appRoot, file));
}

/**
 * Convert an authored module declaration file into ambient declarations.
 * Top-level exports/imports belong to the app module and are removed, while
 * exports nested inside `declare module` blocks are part of the plugin API and
 * must remain intact.
 */
function toAmbient(src) {
  let depth = 0;
  return src
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .filter((line) => !/^\s*import\s.*;?\s*$/.test(line))
    .map((line) => {
      const ambientLine =
        depth === 0 ? line.replace(/^\s*export\s+/, '') : line;
      depth += (line.match(/{/g) ?? []).length;
      depth -= (line.match(/}/g) ?? []).length;
      return ambientLine;
    })
    .join('\n')
    .replace(/[ \t]+$/gm, '')
    .trim();
}

function prepareSource(label, file) {
  let source = fs.readFileSync(file, 'utf8');

  // botApi contains the base mineflayer surface and an older copy of the
  // extension type. The current extension contract lives in pluginApi.
  if (file.endsWith('/botApi.d.ts')) {
    source = source.replace(/\ntype BotPluginExtensions = {[\s\S]*$/, '\n');
  }

  // declarePlugin owns the JNbot module declaration and legacy non-proxy
  // globals. Keep it separate from the authored API interfaces.

  const body = toAmbient(source);
  return `// ─── ${label} ───────────────────────────────────────────────────────────\n\n${body}`;
}

function extractDeclaration(source, name) {
  const start = source.search(new RegExp(`(?:export\\s+)?interface\\s+${name}\\b`));
  if (start < 0) throw new Error(`Could not find interface ${name}`);

  const openBrace = source.indexOf('{', start);
  if (openBrace < 0) throw new Error(`Could not find body for interface ${name}`);

  let depth = 0;
  let quote = null;
  let lineComment = false;
  let blockComment = false;

  for (let index = openBrace; index < source.length; index += 1) {
    const character = source[index];
    const next = source[index + 1];

    if (lineComment) {
      if (character === '\n') lineComment = false;
      continue;
    }
    if (blockComment) {
      if (character === '*' && next === '/') {
        blockComment = false;
        index += 1;
      }
      continue;
    }
    if (quote) {
      if (character === '\\') index += 1;
      else if (character === quote) quote = null;
      continue;
    }
    if (character === '/' && next === '/') {
      lineComment = true;
      index += 1;
      continue;
    }
    if (character === '/' && next === '*') {
      blockComment = true;
      index += 1;
      continue;
    }
    if (character === '"' || character === "'" || character === '`') {
      quote = character;
      continue;
    }
    if (character === '{') depth += 1;
    if (character === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1).trim();
    }
  }

  throw new Error(`Could not close interface ${name}`);
}

function compactInterface(source, name, memberNames) {
  const declaration = extractDeclaration(source, name);
  const body = declaration
    .slice(declaration.indexOf('{') + 1, -1)
    .replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
  const members = [];
  let current = '';
  let braces = 0;
  let parentheses = 0;
  let brackets = 0;

  for (const character of body) {
    current += character;
    if (character === '{') braces += 1;
    if (character === '}') braces -= 1;
    if (character === '(') parentheses += 1;
    if (character === ')') parentheses -= 1;
    if (character === '[') brackets += 1;
    if (character === ']') brackets -= 1;
    if (character === ';' && braces === 0 && parentheses === 0 && brackets === 0) {
      members.push(current.trim());
      current = '';
    }
  }

  const selected = new Set(memberNames);
  const compactMembers = members.filter((member) => {
    const match = member.match(/^\s*(?:readonly\s+)?(?:['"]([^'"]+)['"]|([A-Za-z_$][\w$]*))/);
    return match && selected.has(match[1] ?? match[2]);
  });

  return `interface ${name} {\n${compactMembers.map((member) => `  ${member}`).join('\n')}\n}`;
}

const sources = TYPE_SOURCES.map(({ label, file }) => prepareSource(label, file));
const types = `${sources.join('\n\n')}\n`;
const readMarkdown = (file) => fs.readFileSync(file, 'utf8').replace(/[ \t]+$/gm, '').trim();
const guide = readMarkdown(GUIDE_SRC);
const examples = readMarkdown(EXAMPLES_SRC);
const fullExamples = readMarkdown(FULL_EXAMPLES_SRC);
const authoringContext = [guide, examples].filter(Boolean).join('\n\n');
const reference = `# JNbot Plugin Authoring Reference\n\n${authoringContext}\n\n${fullExamples}\n\n# Full Plugin API Types\n\n\`\`\`ts\n${types}\`\`\`\n`;
const compactGuide = guide.replace(/```[\s\S]*?```/g, '').replace(/\n{3,}/g, '\n\n').trim();
const compactApi = MCP_CONTEXT_DECLARATIONS.map(({ id, name, file, members }) => {
  const declaration = compactInterface(fs.readFileSync(file, 'utf8'), name, members);
  return `## ${id}\n\n\`\`\`ts\n${declaration}\n\`\`\``;
}).join('\n\n');
const referenceSectionIds = ['authoring', 'examples', ...TYPE_SOURCES.map(({ id }) => id)];
const referenceSectionMarkers = Object.fromEntries(
  TYPE_SOURCES.map(({ id, label }) => [
    id,
    `// ─── ${label} ───────────────────────────────────────────────────────────`,
  ]),
);
const mcpContext = [
  '# JNbot coding context',
  compactGuide,
  `Use \`get_jnbot_reference\` when the compact API below is not enough. It returns one complete generated reference section. Available sections: ${referenceSectionIds.map((s) => `\`${s}\``).join(', ')}. Do not guess undocumented members.`,
  '# Primary API surfaces',
  compactApi,
].join('\n\n');

writeGenerated(TXT_OUT, types);
// Sibling package checkout; absent in fresh clones such as CI.
if (fs.existsSync(path.dirname(PKG_DTS))) writeGenerated(PKG_DTS, BANNER + types);
writeGenerated(
  APP_CONST,
  BANNER + 'export const PLUGIN_API_TYPES = ' + JSON.stringify(types) + ';\n',
);
writeGenerated(
  GUIDE_CONST,
  BANNER +
    'export const PLUGIN_AUTHORING_GUIDE = ' + JSON.stringify(authoringContext) + ';\n' +
    'export const PLUGIN_FULL_EXAMPLES = ' + JSON.stringify(fullExamples) + ';\n',
);
writeGenerated(
  MCP_REFERENCE_CONST,
  BANNER +
    'export const JNBOT_MCP_CONTEXT = ' + JSON.stringify(mcpContext) + ';\n' +
    'export const JNBOT_REFERENCE_SECTION_IDS = ' + JSON.stringify(referenceSectionIds) + ' as const;\n' +
    'export type JnbotReferenceSection = (typeof JNBOT_REFERENCE_SECTION_IDS)[number];\n' +
    'export const JNBOT_REFERENCE_SECTION_MARKERS = ' + JSON.stringify(referenceSectionMarkers, null, 2) + ' as const;\n',
);
writeGenerated(LLM_OUT, reference);

// Website context: llm-all.txt (everything, kept for existing links) plus one
// file per topic so agents can fetch only what a task needs.
function topicFile({ id, title }) {
  const header =
    `# JNbot context: ${title}\n\n` +
    `Part of the JNbot LLM context. Index: ${WEBSITE_URL}/llm.txt. Everything in one file: ${WEBSITE_URL}/llm-all.txt.\n`;
  if (id === 'guide') return `${header}\n${authoringContext}\n`;
  if (id === 'examples') return `${header}\n${fullExamples}\n`;
  const body = TYPE_SOURCES.filter((source) => source.topic === id)
    .map(({ label, file }) => prepareSource(label, file))
    .join('\n\n');
  return (
    `${header}Types may reference declarations from the other API files. Read llm-guide.txt for the patterns to use.\n\n` +
    `\`\`\`ts\n${body}\n\`\`\`\n`
  );
}

function contextIndex(files) {
  const lines = files.map(
    ({ topic, content }) =>
      `- [${topic.title}](${WEBSITE_URL}/llm/llm-${topic.id}.txt) (~${Math.round(content.length / 4000)}k tokens): ${topic.use}`,
  );
  lines.push(`- [Everything](${WEBSITE_URL}/llm-all.txt) (~${Math.round(reference.length / 4000)}k tokens): all of the above in one file.`);
  return `${INDEX_START}\n## JNbot plugin context files\n\nFetch only the files the task needs; types are generated from the app source.\n\n${lines.join('\n')}\n${INDEX_END}`;
}

if (includeExternal && fs.existsSync(WEBSITE_LLM_DIR)) {
  writeGenerated(path.join(WEBSITE_LLM_DIR, 'llm-all.txt'), reference);
  const files = LLM_TOPICS.map((topic) => ({ topic, content: topicFile(topic) }));
  for (const { topic, content } of files) {
    writeGenerated(path.join(WEBSITE_LLM_DIR, `llm-${topic.id}.txt`), content);
  }
  const indexFile = path.join(WEBSITE_LLM_DIR, 'llm.txt');
  const index = fs.readFileSync(indexFile, 'utf8');
  const start = index.indexOf(INDEX_START);
  const end = index.indexOf(INDEX_END);
  if (start < 0 || end < 0) throw new Error(`Missing ${INDEX_START} / ${INDEX_END} markers in ${indexFile}`);
  writeGenerated(indexFile, index.slice(0, start) + contextIndex(files) + index.slice(end + INDEX_END.length));
}
