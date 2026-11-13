import type { RecipeValueType } from './recipeV3';

export type RecipeInputDefinition = {
  id: string;
  label: string;
  type: RecipeValueType;
  required?: boolean;
  placeholder?: string;
  defaultValue?: string | number | boolean;
  choices?: Array<
    | { label: string; value: string | number | boolean }
    | {
        label: string;
        options: Array<{
          label: string;
          value: string | number | boolean;
        }>;
      }
  >;
  accepts?: RecipeValueType[];
  control?: 'gamemode' | 'scriptAction';
};

export type RecipeOutputDefinition = {
  id: string;
  label: string;
  type: RecipeValueType;
};

export type RecipeActionDefinition = {
  id: string;
  name: string;
  description: string;
  category: 'Bot' | 'Data' | 'Timing' | 'Other';
  sentence: string;
  requiresBot?: boolean;
  inputs: RecipeInputDefinition[];
  outputs?: RecipeOutputDefinition[];
};

const input = (
  id: string,
  label: string,
  type: RecipeValueType,
  extra: Partial<RecipeInputDefinition> = {},
): RecipeInputDefinition => ({ id, label, type, ...extra });

const coordinates = () =>
  (['x', 'y', 'z'] as const).map((axis) =>
    input(axis, axis.toUpperCase(), 'number', { required: true }),
  );

const coordinateOutputs = () =>
  (['x', 'y', 'z'] as const).map((id) => ({
    id,
    label: id.toUpperCase(),
    type: 'number' as const,
  }));

export const recipeActionCatalog: RecipeActionDefinition[] = [
  {
    id: 'botJoin',
    name: 'Join server',
    description: 'Create a bot and connect it to a Minecraft server.',
    category: 'Bot',
    sentence: 'Join as {username} using {version}',
    inputs: [
      input('username', 'Username', 'string', { required: true }),
      input('version', 'Minecraft version', 'string', {
        required: true,
        defaultValue: '1.8.9',
      }),
      input('login', 'Log in after joining', 'boolean', {
        defaultValue: true,
      }),
    ],
    outputs: [{ id: 'bot', label: 'Connected bot', type: 'object' }],
  },
  {
    id: 'botJoinGamemode',
    name: 'Join gamemode',
    description: 'Move the bot into a gamemode.',
    category: 'Bot',
    sentence: 'Join gamemode {gamemode}',
    requiresBot: true,
    inputs: [
      input('gamemode', 'Gamemode', 'string', {
        required: true,
        control: 'gamemode',
      }),
    ],
  },
  {
    id: 'botChat',
    name: 'Send chat message',
    description: 'Send a message in Minecraft chat.',
    category: 'Bot',
    sentence: 'Send chat message {message}',
    requiresBot: true,
    inputs: [input('message', 'Message', 'string', { required: true })],
  },
  {
    id: 'botMovement',
    name: 'Move bot',
    description: 'Start or stop a bot movement control.',
    category: 'Bot',
    sentence: 'Move {movement} for {duration} ms',
    requiresBot: true,
    inputs: [
      input('movement', 'Direction', 'string', {
        required: true,
        defaultValue: 'forward',
        choices: [
          { label: 'Forward', value: 'forward' },
          { label: 'Backward', value: 'back' },
          { label: 'Left', value: 'left' },
          { label: 'Right', value: 'right' },
        ],
      }),
      input('duration', 'Duration in milliseconds', 'number', {
        defaultValue: 0,
      }),
      input('jump', 'Jump', 'boolean', { defaultValue: false }),
      input('sprint', 'Sprint', 'boolean', { defaultValue: false }),
      input('sneak', 'Sneak', 'boolean', { defaultValue: false }),
      input('state', 'Active', 'boolean', { defaultValue: true }),
    ],
  },
  {
    id: 'botLook',
    name: 'Look in a direction',
    description: 'Turn the bot using yaw and pitch in degrees.',
    category: 'Bot',
    sentence: 'Look at yaw {yaw}° and pitch {pitch}°',
    requiresBot: true,
    inputs: [
      input('yaw', 'Yaw in degrees', 'number', { defaultValue: 0 }),
      input('pitch', 'Pitch in degrees', 'number', { defaultValue: 0 }),
      input('mode', 'Direction mode', 'string', {
        defaultValue: 'absolute',
        choices: [
          { label: 'Absolute direction', value: 'absolute' },
          { label: 'Turn from current direction', value: 'relative' },
        ],
      }),
    ],
  },
  {
    id: 'botBreakBlock',
    name: 'Break block',
    description: 'Break the block at a world position.',
    category: 'Bot',
    sentence: 'Break block at {x}, {y}, {z}',
    requiresBot: true,
    inputs: coordinates(),
  },
  {
    id: 'botPlaceBlock',
    name: 'Place held block',
    description: 'Place the held block at a world position.',
    category: 'Bot',
    sentence: 'Place held block at {x}, {y}, {z}',
    requiresBot: true,
    inputs: [
      ...coordinates(),
      input('face', 'Attach from', 'string', {
        defaultValue: 'down',
        choices: [
          { label: 'Block below', value: 'down' },
          { label: 'Block above', value: 'up' },
          { label: 'North side', value: 'north' },
          { label: 'South side', value: 'south' },
          { label: 'East side', value: 'east' },
          { label: 'West side', value: 'west' },
        ],
      }),
    ],
  },
  {
    id: 'botPathfind',
    name: 'Pathfind to position',
    description: 'Walk to a position and wait until the bot arrives.',
    category: 'Bot',
    sentence: 'Pathfind to {x}, {y}, {z}',
    requiresBot: true,
    inputs: [
      ...coordinates(),
      input('radius', 'Arrival distance', 'number', { defaultValue: 1 }),
    ],
  },
  {
    id: 'botStopPathfinding',
    name: 'Stop pathfinding',
    description: 'Cancel the bot current path.',
    category: 'Bot',
    sentence: 'Stop pathfinding',
    requiresBot: true,
    inputs: [],
  },
  {
    id: 'botSetHotbar',
    name: 'Select hotbar slot',
    description: 'Select a slot from one to nine.',
    category: 'Bot',
    sentence: 'Select hotbar slot {slot}',
    requiresBot: true,
    inputs: [
      input('slot', 'Hotbar slot', 'number', {
        defaultValue: 1,
        choices: Array.from({ length: 9 }, (_, index) => ({
          label: `Slot ${index + 1}`,
          value: index + 1,
        })),
      }),
    ],
  },
  {
    id: 'botActivateItem',
    name: 'Use held item',
    description: 'Right-click with the currently held item.',
    category: 'Bot',
    sentence: 'Use the held item for {ticks} ticks',
    requiresBot: true,
    inputs: [input('ticks', 'Hold for ticks', 'number', { defaultValue: 2 })],
  },
  {
    id: 'botSwingArm',
    name: 'Swing arm',
    description: 'Visually swing one of the bot arms.',
    category: 'Bot',
    sentence: 'Swing {hand} arm',
    requiresBot: true,
    inputs: [
      input('hand', 'Hand', 'string', {
        defaultValue: 'right',
        choices: [
          { label: 'Right hand', value: 'right' },
          { label: 'Left hand', value: 'left' },
        ],
      }),
    ],
  },
  {
    id: 'botDropHeldItem',
    name: 'Drop held item',
    description: 'Drop one item or the entire held stack.',
    category: 'Bot',
    sentence: 'Drop the held item',
    requiresBot: true,
    inputs: [
      input('entireStack', 'Drop entire stack', 'boolean', {
        defaultValue: false,
      }),
    ],
  },
  {
    id: 'botEat',
    name: 'Eat held food',
    description: 'Consume the food currently held by the bot.',
    category: 'Bot',
    sentence: 'Eat held food',
    requiresBot: true,
    inputs: [],
  },
  {
    id: 'botRespawn',
    name: 'Respawn bot',
    description: 'Respawn the bot after death.',
    category: 'Bot',
    sentence: 'Respawn the bot',
    requiresBot: true,
    inputs: [],
  },
  {
    id: 'botCloseWindow',
    name: 'Close inventory window',
    description: 'Close the currently open inventory window.',
    category: 'Bot',
    sentence: 'Close the open window',
    requiresBot: true,
    inputs: [],
  },
  {
    id: 'botFindBlock',
    name: 'Find nearby block',
    description: 'Find the nearest block with a Minecraft block name.',
    category: 'Bot',
    sentence: 'Find {blockName} within {maxDistance} blocks',
    requiresBot: true,
    inputs: [
      input('blockName', 'Block name', 'string', { required: true }),
      input('maxDistance', 'Search distance', 'number', { defaultValue: 32 }),
    ],
    outputs: [
      { id: 'found', label: 'Block found', type: 'boolean' },
      ...coordinateOutputs(),
    ],
  },
  {
    id: 'botAttackNearest',
    name: 'Attack nearest entity',
    description: 'Attack the nearest matching entity or player.',
    category: 'Bot',
    sentence: 'Attack nearest {entityName}',
    requiresBot: true,
    inputs: [
      input('entityName', 'Entity name or type', 'string'),
      input('maxDistance', 'Maximum distance', 'number', { defaultValue: 4 }),
    ],
  },
  {
    id: 'botInteractNearest',
    name: 'Interact with nearest entity',
    description: 'Right-click the nearest matching entity or player.',
    category: 'Bot',
    sentence: 'Interact with nearest {entityName}',
    requiresBot: true,
    inputs: [
      input('entityName', 'Entity name or type', 'string'),
      input('maxDistance', 'Maximum distance', 'number', { defaultValue: 4 }),
    ],
  },
  {
    id: 'botEquipItem',
    name: 'Equip inventory item',
    description: 'Equip the first matching inventory item.',
    category: 'Bot',
    sentence: 'Equip {itemName} to {destination}',
    requiresBot: true,
    inputs: [
      input('itemName', 'Item name', 'string', { required: true }),
      input('destination', 'Destination', 'string', {
        defaultValue: 'hand',
        choices: [
          { label: 'Main hand', value: 'hand' },
          { label: 'Off hand', value: 'off-hand' },
          { label: 'Head', value: 'head' },
          { label: 'Torso', value: 'torso' },
          { label: 'Legs', value: 'legs' },
          { label: 'Feet', value: 'feet' },
        ],
      }),
    ],
  },
  {
    id: 'botOpenInventory',
    name: 'Open inventory',
    description: 'Open the bot inventory as a window.',
    category: 'Bot',
    sentence: 'Open inventory',
    requiresBot: true,
    inputs: [],
  },
  {
    id: 'botClearMovement',
    name: 'Stop all movement',
    description: 'Release every movement control.',
    category: 'Bot',
    sentence: 'Stop all movement',
    requiresBot: true,
    inputs: [],
  },
  {
    id: 'botWindowClick',
    name: 'Click inventory slot',
    description: 'Click a slot in the open window or inventory.',
    category: 'Bot',
    sentence: 'Click slot {slotId}',
    requiresBot: true,
    inputs: [
      input('slotId', 'Slot number or item name', 'any', { required: true }),
      input('button', 'Mouse button', 'number', {
        defaultValue: 0,
        choices: [
          { label: 'Left click', value: 0 },
          { label: 'Right click', value: 1 },
        ],
      }),
      input('mode', 'Shift click', 'number', {
        defaultValue: 0,
        choices: [
          { label: 'No', value: 0 },
          { label: 'Yes', value: 1 },
        ],
      }),
    ],
  },
  {
    id: 'botTransferItems',
    name: 'Transfer items',
    description: 'Transfer inventory items to a player or window.',
    category: 'Bot',
    sentence: 'Transfer items using {mode} to {username}',
    requiresBot: true,
    inputs: [
      input('mode', 'Transfer mode', 'string', {
        defaultValue: 'gift',
        choices: [
          { label: 'Trade', value: 'trade' },
          { label: 'Gift', value: 'gift' },
          { label: 'Window', value: 'window' },
          { label: 'Trash', value: 'trash' },
        ],
      }),
      input('username', 'Player or command (empty for trash)', 'string'),
    ],
  },
  {
    id: 'botWait',
    name: 'Wait for bot ticks',
    description: 'Pause using Minecraft ticks.',
    category: 'Timing',
    sentence: 'Wait {ticks} bot ticks',
    requiresBot: true,
    inputs: [
      input('ticks', 'Ticks', 'number', { required: true, defaultValue: 20 }),
    ],
  },
  {
    id: 'delay',
    name: 'Wait',
    description: 'Pause before continuing.',
    category: 'Timing',
    sentence: 'Wait {delay} milliseconds',
    inputs: [
      input('delay', 'Milliseconds', 'number', {
        required: true,
        defaultValue: 1000,
      }),
    ],
  },
  {
    id: 'botLeave',
    name: 'Leave server',
    description: 'Disconnect the active bot.',
    category: 'Bot',
    sentence: 'Leave the server',
    requiresBot: true,
    inputs: [],
  },
  {
    id: 'log',
    name: 'Log message',
    description: 'Write a value to the plugin console.',
    category: 'Other',
    sentence: 'Log {message}',
    inputs: [input('message', 'Message', 'any', { required: true })],
  },
  {
    id: 'runScriptAction',
    name: 'Run script action',
    description: 'Run an installed script action using the active bot.',
    category: 'Other',
    sentence: 'Run action {actionId}',
    requiresBot: true,
    inputs: [
      input('actionId', 'Script action', 'string', {
        required: true,
        control: 'scriptAction',
      }),
      input('argument', 'Argument', 'any'),
    ],
    outputs: [{ id: 'result', label: 'Action result', type: 'any' }],
  },
  {
    id: 'notification',
    name: 'Show notification',
    description: 'Show an application notification.',
    category: 'Other',
    sentence: 'Show {type} notification {title}',
    inputs: [
      input('type', 'Type', 'string', {
        defaultValue: 'info',
        choices: [
          { label: 'Information', value: 'info' },
          { label: 'Success', value: 'success' },
          { label: 'Warning', value: 'warning' },
          { label: 'Error', value: 'error' },
        ],
      }),
      input('title', 'Title', 'string', { required: true }),
      input('message', 'Message', 'string'),
    ],
  },
  {
    id: 'snackbar',
    name: 'Show short message',
    description: 'Show a temporary message inside the application.',
    category: 'Other',
    sentence: 'Show {type} message {title}',
    inputs: [
      input('type', 'Type', 'string', {
        defaultValue: 'info',
        choices: [
          { label: 'Information', value: 'info' },
          { label: 'Success', value: 'success' },
          { label: 'Warning', value: 'warning' },
          { label: 'Error', value: 'error' },
        ],
      }),
      input('title', 'Message', 'string', { required: true }),
    ],
  },
  {
    id: 'prompt',
    name: 'Ask for text',
    description: 'Pause and ask the user to enter a value.',
    category: 'Other',
    sentence: 'Ask {title}',
    inputs: [
      input('title', 'Title', 'string', { required: true }),
      input('label', 'Field label', 'string', { required: true }),
      input('placeholder', 'Placeholder', 'string'),
      input('defaultValue', 'Default value', 'string'),
      input('description', 'Description', 'string'),
    ],
    outputs: [{ id: 'response', label: 'Response', type: 'string' }],
  },
  {
    id: 'updateProgress',
    name: 'Update progress',
    description: 'Update the progress shown for this plugin.',
    category: 'Other',
    sentence: 'Set progress to {current} of {total}',
    inputs: [
      input('current', 'Current', 'number', { required: true }),
      input('total', 'Total', 'number', { required: true }),
    ],
  },
  {
    id: 'startPlugin',
    name: 'Start plugin',
    description: 'Start another installed plugin.',
    category: 'Other',
    sentence: 'Start plugin {pluginId}',
    inputs: [
      input('pluginId', 'Plugin ID', 'string', { required: true }),
      input('name', 'Plugin name', 'string'),
    ],
  },
  {
    id: 'stopPlugin',
    name: 'Stop plugin',
    description: 'Stop all running instances of another plugin.',
    category: 'Other',
    sentence: 'Stop plugin {pluginId}',
    inputs: [input('pluginId', 'Plugin ID', 'string', { required: true })],
  },
  {
    id: 'randomNumber',
    name: 'Random number',
    description: 'Create a random whole or decimal number.',
    category: 'Data',
    sentence: 'Random number from {minimum} to {maximum}',
    inputs: [
      input('minimum', 'Minimum', 'number', { defaultValue: 0 }),
      input('maximum', 'Maximum', 'number', { defaultValue: 100 }),
      input('wholeNumber', 'Whole number', 'boolean', { defaultValue: true }),
    ],
    outputs: [{ id: 'value', label: 'Random number', type: 'number' }],
  },
  {
    id: 'currentTime',
    name: 'Current time',
    description: 'Get the current timestamp and readable time.',
    category: 'Data',
    sentence: 'Get current time',
    inputs: [],
    outputs: [
      { id: 'timestamp', label: 'Timestamp', type: 'number' },
      { id: 'iso', label: 'ISO time', type: 'string' },
    ],
  },
  {
    id: 'discordEmbed',
    name: 'Send Discord embed',
    description: 'Send an embed through a Discord webhook.',
    category: 'Other',
    sentence: 'Send Discord embed {title}',
    inputs: [
      input('webhookUrl', 'Webhook URL', 'string', { required: true }),
      input('title', 'Title', 'string', { required: true }),
      input('description', 'Description', 'string'),
    ],
  },
];

export type RecipeEventDefinition = {
  id: string;
  name: string;
  description: string;
  nodeType: string;
  runtimeEvent: string;
  outputs: RecipeOutputDefinition[];
};

export const recipeEventCatalog: RecipeEventDefinition[] = [
  {
    id: 'chat',
    name: 'When chat message arrives',
    description: 'Runs when the bot receives chat.',
    nodeType: 'botOnChat',
    runtimeEvent: 'messagestr',
    outputs: [{ id: 'message', label: 'Chat message', type: 'string' }],
  },
  {
    id: 'move',
    name: 'When the bot moves',
    description: 'Runs when the bot moves.',
    nodeType: 'botOnMove',
    runtimeEvent: 'move',
    outputs: ['x', 'y', 'z'].map((id) => ({
      id,
      label: id.toUpperCase(),
      type: 'number',
    })),
  },
  {
    id: 'spawn',
    name: 'When the bot spawns',
    description: 'Runs when the bot spawns.',
    nodeType: 'botOnSpawn',
    runtimeEvent: 'spawn',
    outputs: [],
  },
  {
    id: 'kicked',
    name: 'When the bot is kicked',
    description: 'Runs when the bot is kicked.',
    nodeType: 'botOnKicked',
    runtimeEvent: 'kicked',
    outputs: [{ id: 'reason', label: 'Reason', type: 'string' }],
  },
  {
    id: 'end',
    name: 'When the bot ends',
    description: 'Runs when the bot disconnects.',
    nodeType: 'botOnEnd',
    runtimeEvent: 'end',
    outputs: [],
  },
  {
    id: 'health',
    name: 'When health changes',
    description: 'Runs when health changes.',
    nodeType: 'botOnHealthChange',
    runtimeEvent: 'health',
    outputs: [{ id: 'health', label: 'Health', type: 'number' }],
  },
  {
    id: 'death',
    name: 'When the bot dies',
    description: 'Runs when the bot dies.',
    nodeType: 'botOnDeath',
    runtimeEvent: 'death',
    outputs: [],
  },
  {
    id: 'playerJoin',
    name: 'When a player joins',
    description: 'Runs when a player joins.',
    nodeType: 'botOnPlayerJoin',
    runtimeEvent: 'playerJoined',
    outputs: [
      { id: 'username', label: 'Username', type: 'string' },
      ...['x', 'y', 'z'].map((id) => ({
        id,
        label: id.toUpperCase(),
        type: 'number' as const,
      })),
    ],
  },
  {
    id: 'playerLeave',
    name: 'When a player leaves',
    description: 'Runs when a player leaves.',
    nodeType: 'botOnPlayerLeave',
    runtimeEvent: 'playerLeft',
    outputs: [{ id: 'username', label: 'Username', type: 'string' }],
  },
  {
    id: 'windowOpen',
    name: 'When a window opens',
    description: 'Runs when a window opens.',
    nodeType: 'botOnWindowOpen',
    runtimeEvent: 'windowOpen',
    outputs: [
      { id: 'windowType', label: 'Window type', type: 'string' },
      { id: 'windowTitle', label: 'Window title', type: 'string' },
    ],
  },
  {
    id: 'windowClose',
    name: 'When a window closes',
    description: 'Runs when a window closes.',
    nodeType: 'botOnWindowClose',
    runtimeEvent: 'windowClose',
    outputs: [],
  },
  {
    id: 'blockUpdate',
    name: 'When a block changes',
    description: 'Runs when a block changes.',
    nodeType: 'botOnBlockUpdate',
    runtimeEvent: 'blockUpdate',
    outputs: [
      { id: 'blockType', label: 'Block type', type: 'number' },
      { id: 'blockName', label: 'Block name', type: 'string' },
      ...['x', 'y', 'z'].map((id) => ({
        id,
        label: id.toUpperCase(),
        type: 'number' as const,
      })),
    ],
  },
  {
    id: 'entitySpawn',
    name: 'When an entity spawns',
    description: 'Runs when an entity spawns.',
    nodeType: 'botOnEntitySpawn',
    runtimeEvent: 'entitySpawn',
    outputs: [
      { id: 'entityType', label: 'Entity type', type: 'string' },
      ...['x', 'y', 'z'].map((id) => ({
        id,
        label: id.toUpperCase(),
        type: 'number' as const,
      })),
    ],
  },
  {
    id: 'forcedMove',
    name: 'When the bot is force-moved',
    description: 'Runs when the server moves the bot.',
    nodeType: 'botOnForceMove',
    runtimeEvent: 'forcedMove',
    outputs: ['x', 'y', 'z'].map((id) => ({
      id,
      label: id.toUpperCase(),
      type: 'number',
    })),
  },
];

export type RecipeCollectionDefinition = {
  id: string;
  name: string;
  outputs: RecipeOutputDefinition[];
};

export const recipeCollectionCatalog: RecipeCollectionDefinition[] = [
  {
    id: 'bots',
    name: 'Bots from my alt accounts',
    outputs: [
      { id: 'username', label: 'Username', type: 'string' },
      { id: 'bot', label: 'Bot', type: 'object' },
    ],
  },
  {
    id: 'alts',
    name: 'Alt accounts',
    outputs: [{ id: 'username', label: 'Username', type: 'string' }],
  },
  {
    id: 'players',
    name: 'Online players',
    outputs: [
      { id: 'username', label: 'Username', type: 'string' },
      ...['x', 'y', 'z'].map((id) => ({
        id,
        label: id.toUpperCase(),
        type: 'number' as const,
      })),
    ],
  },
  {
    id: 'entities',
    name: 'Nearby entities',
    outputs: [
      { id: 'mobType', label: 'Entity type', type: 'string' },
      ...['x', 'y', 'z'].map((id) => ({
        id,
        label: id.toUpperCase(),
        type: 'number' as const,
      })),
    ],
  },
  {
    id: 'inventory',
    name: 'Inventory items',
    outputs: [
      { id: 'name', label: 'Item name', type: 'string' },
      { id: 'count', label: 'Count', type: 'number' },
      { id: 'slotId', label: 'Slot', type: 'number' },
    ],
  },
  {
    id: 'windowItems',
    name: 'Window items',
    outputs: [
      { id: 'name', label: 'Item name', type: 'string' },
      { id: 'count', label: 'Count', type: 'number' },
      { id: 'slotId', label: 'Slot', type: 'number' },
    ],
  },
  {
    id: 'items',
    name: 'All visible items',
    outputs: [
      { id: 'name', label: 'Item name', type: 'string' },
      { id: 'count', label: 'Count', type: 'number' },
      { id: 'slotId', label: 'Slot', type: 'number' },
    ],
  },
];

export type RecipeBotPropertyDefinition = RecipeOutputDefinition & {
  description: string;
};

/** Safe, stable bot values exposed to codeless recipes. */
export const recipeBotPropertyCatalog: RecipeBotPropertyDefinition[] = [
  {
    id: 'username',
    label: 'Username',
    type: 'string',
    description: 'The connected account name.',
  },
  {
    id: 'health',
    label: 'Health',
    type: 'number',
    description: 'The bot current health.',
  },
  {
    id: 'food',
    label: 'Food level',
    type: 'number',
    description: 'The bot current food level.',
  },
  {
    id: 'oxygen',
    label: 'Oxygen level',
    type: 'number',
    description: 'The bot remaining oxygen.',
  },
  {
    id: 'positionX',
    label: 'Position X',
    type: 'number',
    description: 'The bot X coordinate.',
  },
  {
    id: 'positionY',
    label: 'Position Y',
    type: 'number',
    description: 'The bot Y coordinate.',
  },
  {
    id: 'positionZ',
    label: 'Position Z',
    type: 'number',
    description: 'The bot Z coordinate.',
  },
  {
    id: 'gamemode',
    label: 'Current gamemode',
    type: 'string',
    description: 'The JNbot gamemode identifier.',
  },
  {
    id: 'online',
    label: 'Connected',
    type: 'boolean',
    description: 'Whether the bot is currently online.',
  },
  {
    id: 'experienceLevel',
    label: 'Experience level',
    type: 'number',
    description: 'The bot experience level.',
  },
];

export const getRecipeAction = (id: string) =>
  recipeActionCatalog.find((action) => action.id === id);

export const getRecipeEvent = (id: string) =>
  recipeEventCatalog.find((event) => event.id === id);

export const getRecipeCollection = (id: string) =>
  recipeCollectionCatalog.find((collection) => collection.id === id);

export const getRecipeBotProperty = (id: string) =>
  recipeBotPropertyCatalog.find((property) => property.id === id);
