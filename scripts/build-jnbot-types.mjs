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

const TYPE_SOURCES = [
  { id: 'botApi', label: 'Bot API', file: path.join(typeRoot, 'botApi.d.ts') },
  { id: 'mcClientApi', label: 'Minecraft client API', file: path.join(typeRoot, 'McClientApi.d.ts') },
  { id: 'mcServerApi', label: 'Minecraft server API', file: path.join(typeRoot, 'mcServerApi.d.ts') },
  { id: 'proxyApi', label: 'JNbot proxy API', file: path.join(typeRoot, 'proxyApi.d.ts') },
  { id: 'pluginOptions', label: 'Plugin options', file: path.join(typeRoot, 'pluginOptions.d.ts') },
  { id: 'pluginApi', label: 'JNbot plugin API', file: path.join(typeRoot, 'pluginApi.d.ts') },
  { id: 'brainApi', label: 'Brain API', file: path.join(typeRoot, 'brainApi.d.ts') },
  { id: 'declarePlugin', label: 'Plugin declarations', file: path.join(typeRoot, 'declarePlugin.d.ts') },
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
    members: ['stop', 'restart', 'onExit', 'startPlugin', 'stopPlugin', 'prompt', 'notification', 'dialog', 'getAlts', 'requestAccountPassword', 'forEachBot', 'forEachAlt', 'startAction', 'getMcClient', 'getMcServer', 'automations', 'ai', 'settings'],
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
const GUIDE_SRC = path.join(appRoot, 'docs/plugin-authoring.md');
const EXAMPLES_SRC = path.join(appRoot, 'docs/plugin-examples.md');
const LLM_OUT = path.join(appRoot, 'assets/llm-all.txt');
const EXTERNAL_OUTPUTS = [
  path.resolve(appRoot, '../websitev3/public/llm/llm-all.txt'),
];

const IMPORTANT_NOTE = '[IMPORTANT] Use `BotMachine` for the entire bot task. Avoid creating long functions. Split the task up into smaller steps. This will allow the bot to recover from errors like if some action failed or the bot gets suddenly kicked to hub, BotMachine allows you to deal with these scenarios much easier. For the `when` condition, try to find when the bot should perform the action. For example, if the bot doesn\'t have a window opened -> do window action. Or if specific window must be opened, we can check it using bot.getWindowTitle(). Avoid doing stuff like state.step = "step1" and then checking for state.step === "step1" in the next task.'

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
    const match = member.match(/^\s*(?:readonly\s+)?(?:['\"]([^'\"]+)['\"]|([A-Za-z_$][\w$]*))/);
    return match && selected.has(match[1] ?? match[2]);
  });

  return `interface ${name} {\n${compactMembers.map((member) => `  ${member}`).join('\n')}\n}`;
}

const sources = TYPE_SOURCES.map(({ label, file }) => prepareSource(label, file));
const types = `${sources.join('\n\n')}\n`;
const guide = fs.readFileSync(GUIDE_SRC, 'utf8').replace(/[ \t]+$/gm, '').trim();
const examples = fs.readFileSync(EXAMPLES_SRC, 'utf8').replace(/[ \t]+$/gm, '').trim();
const authoringContext = [guide, examples].filter(Boolean).join('\n\n');
const reference = `# JNbot Plugin Authoring Reference\n\n${authoringContext}\n\n# Full Plugin API Types\n\n\`\`\`ts\n${types}\`\`\`\n\n\n${IMPORTANT_NOTE}\n`;
const compactGuide = guide.replace(/```[\s\S]*?```/g, '').replace(/\n{3,}/g, '\n\n').trim();
const compactApi = MCP_CONTEXT_DECLARATIONS.map(({ id, name, file, members }) => {
  const declaration = compactInterface(fs.readFileSync(file, 'utf8'), name, members);
  return `## ${id}\n\n\`\`\`ts\n${declaration}\n\`\`\``;
}).join('\n\n');
const apiReferenceSources = TYPE_SOURCES.filter(({ id }) => id !== 'declarePlugin');
const referenceSectionIds = ['authoring', ...apiReferenceSources.map(({ id }) => id)];
const referenceSectionMarkers = Object.fromEntries(
  apiReferenceSources.map(({ id, label }) => [
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
  BANNER + 'export const PLUGIN_AUTHORING_GUIDE = ' + JSON.stringify(authoringContext) + ';\n',
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

for (const output of includeExternal ? EXTERNAL_OUTPUTS : []) {
  if (!fs.existsSync(path.dirname(output))) continue;
  writeGenerated(output, reference);
}
