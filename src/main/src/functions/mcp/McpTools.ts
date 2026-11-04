import * as z from 'zod/v4';
import type { ClientPermissions } from '../../../../common/clientPermissions';
import { pluginOptionSchemaArgument } from '../../../../common/pluginOptions';
import { JNBOT_REFERENCE_SECTION_IDS } from '../../../../common/pluginMcpReferenceSource';
import type McpManager from './McpManager';

export type McpPack = 'observe' | 'control' | 'code' | 'plugins';

export interface McpClientContext {
  id: string;
  name: string;
  token: string;
  permissions: ClientPermissions;
  createdAt?: number;
  lastActivityAt?: number;
}

export interface McpToolDefinition {
  name: string;
  title: string;
  description: string;
  pack?: McpPack;
  schema: z.ZodTypeAny;
  readOnly?: boolean;
  handler: (args: Record<string, unknown>, client: McpClientContext) => Promise<unknown> | unknown;
}

// Common parameter schemas
const profileKeyInput = z.string().min(1).max(160).describe('Profile key returned by get_jnbot_context.');
const accountInput = z.string().min(1).max(64).describe('Exact account name for an active bot or the account to join.');
export const targetSchema = {
  profileKey: profileKeyInput,
  account: accountInput,
};

export const requestKey = z.string().min(1).max(120).optional().describe('Optional idempotency key. Reuse it only when retrying the same write.');
export const pluginId = z.string().regex(/^[a-z0-9]+$/i).describe('Plugin ID returned by list_plugins or a prior save_plugin operation.');

const missingForMode = (ctx: z.RefinementCtx, mode: string, field: string) =>
  ctx.addIssue({ code: 'custom', path: [field], message: `mode "${mode}" requires ${field}.` });

export const jnbotContextSchema = z.object({
  profileKey: profileKeyInput.optional().describe('Optional profile filter. Required when accountQuery is supplied because stored alts belong to a specific profile.'),
  accountQuery: z.string().trim().min(1).max(64).optional().describe('Case-insensitive text to find stored account names in profileKey. Returns at most 100 matching names, plus total and truncated. Use this before join_bot when the requested alt name is not already an active bot.'),
}).strict().superRefine((value, ctx) => {
  if (value.accountQuery && !value.profileKey) {
    ctx.addIssue({
      code: 'custom',
      path: ['profileKey'],
      message: 'profileKey is required when accountQuery is provided because stored alts belong to one profile.',
    });
  }
});

/** Flat schemas intentionally expose every property to MCP inspectors. */
export const getPluginSchema = z.object({
  mode: z.enum(['source', 'options', 'actions', 'authoring']).describe('source: plugin source; options: saved values and schema; actions: action plugins in a profile; authoring: plugin contract and guide.'),
  pluginId: pluginId.optional(),
  profileKey: profileKeyInput.optional(),
  scriptType: z.enum(['script', 'action']).optional().describe('Optional authoring guide variant. Actions require async function main(bot, settings, args = []).'),
}).strict().superRefine((value, ctx) => {
  if (['source', 'options'].includes(value.mode) && !value.pluginId) missingForMode(ctx, value.mode, 'pluginId');
  if (['options', 'actions'].includes(value.mode) && !value.profileKey) missingForMode(ctx, value.mode, 'profileKey');
});

export const savePluginSchema = z.object({
  mode: z.enum(['source', 'schema', 'options']).describe('source: create or update source and schema; schema: update only the option schema; options: update one profile’s saved option values.'),
  name: z.string().min(1).max(100).optional().describe('Plugin display name. Required by source mode.'),
  source: z.string().min(1).max(512 * 1024).optional().describe('Complete JavaScript or TypeScript plugin source. Required by source mode.'),
  scriptType: z.enum(['script', 'action']).optional().describe('script runs independently; action must export async function main(bot, settings, args = []). Required by source mode.'),
  language: z.enum(['js', 'ts']).optional().describe('Source language. Defaults to js.'),
  description: z.string().max(500).optional().describe('Optional short plugin description.'),
  pluginId: pluginId.optional(),
  optionSchema: pluginOptionSchemaArgument.optional(),
  profileKey: profileKeyInput.optional(),
  values: z.record(z.string(), z.unknown()).optional().describe('Saved option values keyed by option id. Required by options mode.'),
  replace: z.boolean().optional().describe('In options mode, replace all saved values instead of merging. Defaults to false.'),
  requestKey,
}).strict().superRefine((value, ctx) => {
  if (value.mode === 'source') {
    for (const field of ['name', 'source', 'scriptType'] as const) if (!value[field]) missingForMode(ctx, value.mode, field);
  }
  if (value.mode === 'schema') {
    if (!value.pluginId) missingForMode(ctx, value.mode, 'pluginId');
    if (value.optionSchema === undefined) missingForMode(ctx, value.mode, 'optionSchema');
  }
  if (value.mode === 'options') {
    for (const field of ['profileKey', 'pluginId', 'values'] as const) if (value[field] === undefined) missingForMode(ctx, value.mode, field);
  }
});

export const inspectWorldSchema = z.object({
  ...targetSchema,
  mode: z.enum(['nearby_entities', 'block_at', 'find_blocks']).describe('nearby_entities: bounded loaded entities; block_at: one loaded block; find_blocks: matching loaded blocks.'),
  maxDistance: z.number().min(1).max(64).optional().describe('Search radius in blocks. Defaults to 32; maximum 64.'),
  limit: z.number().int().min(1).max(100).optional().describe('Maximum result count. Defaults depend on mode; maximum 100.'),
  x: z.number().optional().describe('Block X coordinate. Required by block_at.'),
  y: z.number().optional().describe('Block Y coordinate. Required by block_at.'),
  z: z.number().optional().describe('Block Z coordinate. Required by block_at.'),
  name: z.string().min(1).max(100).optional().describe('Minecraft block name, with or without minecraft:. Required by find_blocks.'),
}).strict().superRefine((value, ctx) => {
  if (value.mode === 'block_at') for (const field of ['x', 'y', 'z'] as const) if (value[field] === undefined) missingForMode(ctx, value.mode, field);
  if (value.mode === 'find_blocks' && !value.name) missingForMode(ctx, value.mode, 'name');
});

export const MOVE_ACTION_MAP: Record<string, string> = {
  movement: 'botMovement',
  look: 'botLook',
  pathfind: 'botPathfind',
  stop_pathfinding: 'botStopPathfinding',
  clear_movement: 'botClearMovement',
  join_gamemode: 'botJoinGamemode',
  respawn: 'botRespawn',
};

export const INTERACTION_ACTION_MAP: Record<string, string> = {
  break_block: 'botBreakBlock',
  place_block: 'botPlaceBlock',
  activate_item: 'botActivateItem',
  swing_arm: 'botSwingArm',
  attack_nearest: 'botAttackNearest',
  interact_nearest: 'botInteractNearest',
  eat: 'botEat',
};

export const INVENTORY_ACTION_MAP: Record<string, string> = {
  set_hotbar: 'botSetHotbar',
  drop_held_item: 'botDropHeldItem',
  equip_item: 'botEquipItem',
  open_inventory: 'botOpenInventory',
  close_window: 'botCloseWindow',
  window_click: 'botWindowClick',
  transfer_items: 'botTransferItems',
};

export function isPackPermitted(permissions: ClientPermissions, pack?: McpPack): boolean {
  if (!pack) return true;
  if (pack === 'observe') return permissions.mcp.observe === 'allow';
  return permissions.mcp[pack] !== 'deny';
}

/**
 * Creates all MCP tool definitions and binds them to the manager and calling client.
 */
export function createMcpTools(manager: McpManager, client: McpClientContext): McpToolDefinition[] {
  const read = (
    name: string,
    title: string,
    description: string,
    schema: z.ZodTypeAny,
    handler: McpToolDefinition['handler'],
  ): McpToolDefinition => ({
    name,
    title,
    description,
    schema,
    handler,
    pack: 'observe',
    readOnly: true,
  });

  const write = (
    name: string,
    title: string,
    description: string,
    pack: McpPack,
    schema: z.ZodTypeAny,
    handler: McpToolDefinition['handler'],
  ): McpToolDefinition => ({
    name,
    title,
    description,
    pack,
    schema,
    handler,
  });

  const tools: McpToolDefinition[] = [
    // ---------------------------------------------------------------------------
    // Observation & State Tools
    // ---------------------------------------------------------------------------
    read(
      'get_jnbot_context',
      'Get JNbot context',
      'List permitted profiles, account counts, active logical bots, and active plugin runs. To find a stored alt before joining it, call this tool with that profileKey and accountQuery (for example, "Zola"); it returns bounded matching account names only. Use a returned profileKey/account pair with join_bot.',
      jnbotContextSchema,
      (args, requestClient) => {
        const profileKey = args.profileKey as string | undefined;
        if (profileKey) manager.runtimeFor(requestClient, profileKey);
        return manager.getBotBridge().context(
          profileKey ? [profileKey] : manager.allowedProfiles(requestClient),
          args.accountQuery as string | undefined,
        );
      },
    ),

    read(
      'get_bot_state',
      'Get bot state',
      'Read one active bot’s live state: connection, health, food, oxygen, position, orientation, gamemode, held item, selected slot, and window status. Include chat, inventory, or bounded tab-list players only when requested.',
      z.object({
        ...targetSchema,
        include: z.array(z.enum(['chat', 'inventory', 'players'])).max(3).optional().describe('Optional extra data. chat returns up to 100 recent entries; inventory returns window slots; players returns up to 100 tab-list players with total and truncated.'),
      }).strict(),
      (args, requestClient) => manager.readState(requestClient, manager.target(args), args.include as string[] | undefined),
    ),

    read(
      'inspect_world',
      'Inspect world',
      'Inspect only loaded world data around one active bot. Use nearby_entities for entities, block_at for one position, or find_blocks for matching loaded blocks.',
      inspectWorldSchema,
      (args, requestClient) => manager.inspectWorld(requestClient, args),
    ),

    // ---------------------------------------------------------------------------
    // Operations Tool
    // ---------------------------------------------------------------------------
    {
      name: 'get_operation',
      title: 'Get operation',
      description: 'Read one asynchronous write operation created by this client. Returns its status, result or error, and pollAfterMs. Poll pending, queued, running, or awaiting_approval operations instead of resubmitting.',
      readOnly: true,
      schema: z.object({ operationId: z.string().uuid().describe('Operation ID returned by a write tool.') }).strict(),
      handler: (args) => {
        const operation = manager.getOperations().get(client.id, String(args.operationId));
        if (!operation) throw new Error('Operation not found.');
        return operation;
      },
    },

    // ---------------------------------------------------------------------------
    // Bot Control & Interaction Tools
    // ---------------------------------------------------------------------------
    write(
      'join_bot',
      'Join bot',
      'Idempotently start or reuse a logical bot for a profile account. Returns an operation immediately; poll get_operation until terminal.',
      'control',
      z.object({
        ...targetSchema,
        version: z.string().max(30).optional().describe('Minecraft version. Defaults to the profile/default version.'),
        login: z.boolean().optional().describe('Whether to perform the normal server login flow. Defaults to true.'),
        gamemode: z.string().max(80).optional().describe('Optional gamemode to join after connecting.'),
        requestKey,
      }).strict(),
      (args) => manager.submit(
        client,
        'join_bot',
        'control',
        manager.target(args),
        args,
        () => manager.getBotBridge().joinLogical(client.id, manager.target(args), manager.joinInput(args)),
      ),
    ),

    write(
      'leave_bot',
      'Leave bot',
      'Disconnect one active logical bot. Returns an operation immediately; poll get_operation until terminal.',
      'control',
      z.object({ ...targetSchema, requestKey }).strict(),
      (args) => manager.actionOperation(client, 'leave_bot', args, 'botLeave'),
    ),

    write(
      'send_bot_chat',
      'Send bot chat',
      'Send one Minecraft chat message or slash command from an active bot. Returns an operation immediately; poll get_operation until terminal.',
      'control',
      z.object({
        ...targetSchema,
        message: z.string().min(1).max(256).describe('Chat text or slash command to send.'),
        requestKey,
      }).strict(),
      (args) => manager.actionOperation(client, 'send_bot_chat', args, 'botChat', { message: args.message }),
    ),

    write(
      'move_bot',
      'Move bot',
      'Control one active bot’s movement. input for movement: { movement: forward|back|left|right, state: boolean, duration?: milliseconds, jump?: boolean, sprint?: boolean, sneak?: boolean }. look requires { yaw, pitch, mode?: absolute|relative } in degrees. pathfind requires { x, y, z, radius?: blocks }. join_gamemode requires { gamemode }. stop_pathfinding, clear_movement, and respawn need no input. Returns an operation immediately; poll get_operation until terminal.',
      'control',
      z.object({
        ...targetSchema,
        action: z.enum(['movement', 'look', 'pathfind', 'stop_pathfinding', 'clear_movement', 'join_gamemode', 'respawn']).describe('The movement operation to perform.'),
        input: z.record(z.string(), z.unknown()).optional().describe('Action parameters described in this tool. Omit for stop_pathfinding, clear_movement, and respawn.'),
        requestKey,
      }).strict(),
      (args) => manager.actionOperation(
        client,
        'move_bot',
        args,
        manager.moveAction(String(args.action)),
        (args.input as Record<string, unknown>) ?? {},
      ),
    ),

    write(
      'interact_with_world',
      'Interact with world',
      'Interact with the world through one active bot. input for break_block is { x, y, z }; place_block is { x, y, z, face?: up|down|north|south|east|west }; activate_item is { ticks?: number }; swing_arm is { hand?: left|right }; attack_nearest and interact_nearest accept { entityName?: string, maxDistance?: number }; eat needs no input. Returns an operation immediately; poll get_operation until terminal.',
      'control',
      z.object({
        ...targetSchema,
        action: z.enum(['break_block', 'place_block', 'activate_item', 'swing_arm', 'attack_nearest', 'interact_nearest', 'eat']).describe('The world interaction to perform.'),
        input: z.record(z.string(), z.unknown()).optional().describe('Action parameters described in this tool.'),
        requestKey,
      }).strict(),
      (args) => manager.actionOperation(
        client,
        'interact_with_world',
        args,
        manager.interactionAction(String(args.action)),
        (args.input as Record<string, unknown>) ?? {},
      ),
    ),

    write(
      'manage_inventory',
      'Manage inventory',
      'Manage an active bot’s inventory and open window. input for set_hotbar is { slot: 1–9 }; drop_held_item is { entireStack?: boolean }; equip_item is { itemName, destination: hand|head|torso|legs|feet|off-hand }; window_click is { slotId: number|string, button?: number, mode?: number }; transfer_items is { mode: trade|gift|window, username?: string } and requires username for trade or gift. open_inventory and close_window need no input. Returns an operation immediately; poll get_operation until terminal.',
      'control',
      z.object({
        ...targetSchema,
        action: z.enum(['set_hotbar', 'drop_held_item', 'equip_item', 'open_inventory', 'close_window', 'window_click', 'transfer_items']).describe('The inventory operation to perform.'),
        input: z.record(z.string(), z.unknown()).optional().describe('Action parameters described in this tool.'),
        requestKey,
      }).strict(),
      (args) => manager.actionOperation(
        client,
        'manage_inventory',
        args,
        manager.inventoryAction(String(args.action)),
        (args.input as Record<string, unknown>) ?? {},
      ),
    ),

    // ---------------------------------------------------------------------------
    // Code & Scripting Tools
    // ---------------------------------------------------------------------------
    write(
      'run_bot_script',
      'Run bot script',
      'Run approved one-shot JavaScript against one active logical bot. Use only for short, targeted tasks; plugin code belongs in save_plugin. Returns an operation immediately; poll get_operation until terminal.',
      'code',
      z.object({
        ...targetSchema,
        purpose: z.string().min(1).max(240).describe('Human-readable purpose used for approval and audit.'),
        code: z.string().min(1).max(16 * 1024).describe('One-shot JavaScript executed against the selected bot.'),
        timeoutMs: z.number().int().min(1_000).max(120_000).optional().describe('Execution timeout in milliseconds. Defaults to 60000.'),
        requestKey,
      }).strict(),
      (args) => manager.submit(
        client,
        'run_bot_script',
        'code',
        manager.target(args),
        args,
        () => manager.getBotBridge().script(manager.target(args), String(args.code), Number(args.timeoutMs) || 60_000),
      ),
    ),

    // ---------------------------------------------------------------------------
    // Plugin Tools
    // ---------------------------------------------------------------------------
    {
      name: 'list_plugins',
      title: 'List plugins',
      description: 'List installed plugins available to one permitted profile. Returns plugin summaries and IDs for get_plugin, save_plugin, and run_plugin.',
      pack: 'plugins',
      readOnly: true,
      schema: z.object({ profileKey: profileKeyInput }).strict(),
      handler: (args, requestClient) => {
        manager.runtimeFor(requestClient, String(args.profileKey));
        return manager.getMacros().toList();
      },
    },

    {
      name: 'get_plugin',
      title: 'Get plugin',
      description: 'Read plugin source, one profile’s option values, available actions, or the authoring guide. Use authoring before save_plugin. Mode determines required inputs shown in the schema.',
      pack: 'plugins',
      readOnly: true,
      schema: getPluginSchema,
      handler: (args, requestClient) => manager.getPlugin(requestClient, args),
    },

    write(
      'save_plugin',
      'Save plugin',
      'Create or update a plugin/action, its option schema, or one profile’s stored option values. Use source mode with name, source, and scriptType to create; include pluginId to update source. Prefer a native optionSchema array; JSON text is accepted. Returns an operation immediately; poll get_operation until terminal.',
      'plugins',
      savePluginSchema,
      (args) => manager.savePlugin(client, args),
    ),

    write(
      'run_plugin',
      'Run plugin',
      'Start a normal plugin in a profile or run an action plugin against one active bot. mode run needs profileKey/pluginId; mode action also needs account. Returns an operation immediately; poll get_operation until terminal.',
      'plugins',
      z.object({
        mode: z.enum(['run', 'action']).describe('run starts a normal plugin; action invokes an action plugin on one active bot.'),
        pluginId,
        profileKey: profileKeyInput,
        account: z.string().max(64).optional().describe('Required for action mode: active bot account name.'),
        args: z.array(z.unknown()).max(50).optional().describe('Optional positional arguments passed only to an action plugin.'),
        optionOverrides: z.record(z.string(), z.unknown()).optional().describe('Optional option values applied only to this run; saved settings are not changed.'),
        requestKey,
      }).strict(),
      (args) => manager.runPlugin(client, args),
    ),

    // ---------------------------------------------------------------------------
    // Execution Run Inspection & Control
    // ---------------------------------------------------------------------------
    read(
      'get_run',
      'Get run',
      'Read one plugin run’s status. Set logs to true to include bounded, redacted logs for that profile.',
      z.object({
        profileKey: profileKeyInput,
        runId: z.number().int().positive().describe('Run ID returned by get_jnbot_context or run_plugin.'),
        logs: z.boolean().optional().describe('Include redacted log entries. Defaults to false.'),
        limit: z.number().int().min(1).max(500).optional().describe('Maximum log entries when logs is true. Defaults to 200.'),
      }).strict(),
      (args) => manager.getRun(client, args),
    ),

    write(
      'stop_run',
      'Stop run',
      'Stop one active plugin run in a profile. Returns an operation immediately; poll get_operation until terminal.',
      'plugins',
      z.object({
        profileKey: profileKeyInput,
        runId: z.number().int().positive().describe('Active run ID to stop.'),
        requestKey,
      }).strict(),
      (args) => manager.stopRun(client, args),
    ),

    // ---------------------------------------------------------------------------
    // Documentation & Reference Tools
    // ---------------------------------------------------------------------------
    read(
      'get_jnbot_reference',
      'Get JNbot reference section',
      'Fetch one complete generated JNbot API reference section. Use it when the authoring guide lacks an API detail; do not guess undocumented members.',
      z.object({
        section: z.enum(JNBOT_REFERENCE_SECTION_IDS).describe(`Reference section to return: ${JNBOT_REFERENCE_SECTION_IDS.join(', ')}.`),
      }).strict(),
      (args) => manager.getReference(String(args.section)),
    ),
  ];

  return tools.filter((tool) => isPackPermitted(client.permissions, tool.pack));
}
