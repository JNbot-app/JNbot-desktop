import * as z from 'zod/v4';
import type { LlmToolCall, LlmToolSpec } from '../../../../common/llm';
import { PLUGIN_AUTHORING_GUIDE } from '../../../../common/pluginAuthoringGuideSource';
import { JNBOT_MCP_CONTEXT, JNBOT_REFERENCE_SECTION_IDS } from '../../../../common/pluginMcpReferenceSource';

type Section = (typeof JNBOT_REFERENCE_SECTION_IDS)[number];

/** Every plugin uses these, so they are always in the prompt. */
const CORE_SECTIONS: Section[] = ['pluginApi', 'pluginOptions', 'botApi'];

/** Extra sections, added when the request mentions their topic. */
const TOPIC_SECTIONS: { section: Section; topic: RegExp }[] = [
  { section: 'brainApi', topic: /\b(brain|learn\w*|imitat\w*|record\w*|train\w*|copy me|mimic)\b/i },
  { section: 'proxyApi', topic: /\b(proxy|intercept|packets?|join (it|the bot)|play as|control it myself)\b/i },
  { section: 'mcClientApi', topic: /\b(minecraft client|mc client|game client|launch(er)?|lunar|jnbot client|mod)\b/i },
  { section: 'mcServerApi', topic: /\b(server api|rcon|console command|my (own )?server|spigot|paper|plugin server)\b/i },
];

export const SECTION_LABELS: Record<Section, string> = {
  authoring: 'authoring guide',
  botApi: 'Bot API',
  mcClientApi: 'Minecraft client API',
  mcServerApi: 'Minecraft server API',
  proxyApi: 'proxy API',
  pluginOptions: 'plugin options',
  pluginApi: 'plugin API',
  brainApi: 'Brain API',
};

/** Which reference sections go in the prompt for this request. */
export function pluginSections(request: string): Section[] {
  return [...CORE_SECTIONS, ...TOPIC_SECTIONS.filter(({ topic }) => topic.test(request)).map(({ section }) => section)];
}

const OUTPUT_FORMAT = `## How to answer

The app shows your reply live and saves the plugin itself, so ignore the guide's \`save_plugin\` / \`get_operation\` workflow.

If the user asks a question (e.g. what the plugin does, how something works), just answer it in short markdown and do not include the \`\`\`json block. Otherwise, reply in exactly this shape:

1. One or two short sentences on what the plugin does (or what you changed).
2. One \`\`\`js block with the complete plugin source (never a diff or "...rest unchanged"). Always include it, also when fixing a small problem: the app only uses the code in this block.
3. One \`\`\`json block: {"name": string, "description": string, "optionSchema": [...]}. Keep existing option ids when changing a plugin.

## Rules

- Only use APIs documented in this prompt or returned by the tools. Never invent members; if something is not possible, say so in the sentences and do the closest thing that is.
- Add an option for every value a user may want to tune (targets, delays, gamemode, messages) instead of hard-coding it.
- Handle the bot being kicked, dying or getting stuck: prefer \`BotMachine\` steps with \`when\` conditions over long linear scripts.
- Keep code short, readable and commented only where the intent is not obvious.`;

/**
 * The system prompt for writing a plugin. Cloud models get the full reference
 * for the relevant APIs up front (Claude caches it between steps), which beats
 * hoping the model asks for it. Small local models get the compact version and
 * look things up with the tools.
 */
export function pluginSystemPrompt(
  request: string,
  readSection: (section: Section) => string,
  compact: boolean,
) {
  const reference = compact
    ? JNBOT_MCP_CONTEXT
    : `${PLUGIN_AUTHORING_GUIDE}\n\n# API reference\n\n${pluginSections(request)
      .map((section) => `\`\`\`ts\n${readSection(section)}\n\`\`\``)
      .join('\n\n')}`;
  return `You are an expert JNbot plugin developer. JNbot runs JavaScript plugins in a sandboxed Node.js worker; plugins control Minecraft bots (mineflayer with JNbot extensions) through \`require('jnbot')\`.

${reference}

${OUTPUT_FORMAT}`;
}

/** Tools for looking up what is not in the prompt. */
export const PLUGIN_TOOLS: LlmToolSpec[] = [
  {
    name: 'get_jnbot_reference',
    description: 'Read one complete section of the JNbot API reference (TypeScript declarations with docs).',
    parameters: jsonSchema(z.object({ section: z.enum(JNBOT_REFERENCE_SECTION_IDS) })),
  },
  {
    name: 'list_plugins',
    description: "List the user's installed plugins (id, name, description, type). Useful to reuse an existing action or match their style.",
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'read_plugin',
    description: "Read the source code of one of the user's installed plugins.",
    parameters: jsonSchema(z.object({ pluginId: z.string() })),
  },
];

export function describePluginTool(call: LlmToolCall, pluginName: (id: string) => string | undefined) {
  if (call.name === 'get_jnbot_reference')
    return `Reading the ${SECTION_LABELS[call.input.section as Section] ?? String(call.input.section)} reference`;
  if (call.name === 'list_plugins') return 'Looking at your plugins';
  if (call.name === 'read_plugin') return `Reading ${pluginName(String(call.input.pluginId)) ?? 'a plugin'}`;
  return `Using ${call.name}`;
}

export function jsonSchema(schema: z.ZodType): Record<string, unknown> {
  const { $schema: _ignored, ...rest } = z.toJSONSchema(schema, { unrepresentable: 'any' }) as Record<string, unknown>;
  return rest;
}
