// Default item-transfer config. Servers tweak it from their bot extension with
// `bot.transferItems.configure({ gift: { command: '/send {username}' } })`.
//
// Texts are matched case-insensitively with color codes stripped. A window
// title or item matcher is a list (any entry may match), a single string or
// a function. Item matchers check the item id, display name and lore.

const isGreenGlass = (item) =>
  item.name === 'green_stained_glass_pane' ||
  item.name === 'lime_stained_glass_pane' ||
  (item.name.includes('glass') && (item.metadata === 5 || item.metadata === 13));

const defaultTransferConfig = {
  trade: {
    command: '/trade {username}',
    windowTitle: ['{username}'],
    /** Your accept button; searched in your side of the trade window. */
    acceptButton: 'glass',
    /** Used when no accept button is found. */
    acceptSlot: 45,
    /** An accept button showing this means that side accepted. */
    acceptedButton: isGreenGlass,
    /** Columns (from the left) that form your side of the trade. */
    offerColumns: 4,
    /** Slots between your accept button and the partner's. */
    partnerAcceptOffset: 6,
  },
  tradeWithKeys: {
    /** Button that opens / cycles the virtual key page. */
    keyButton: ['cycle through', 'click to manage crate key'],
    keySlot: 36,
    keyItem: 'tripwire_hook',
    acceptSlot: 27,
    /** Extra names a key type may show up as, e.g. vote keys called "voting". */
    keyAliases: { vote: ['voting'] },
  },
  gift: {
    command: '/gift {username}',
    windowTitle: ['{username}'],
    confirmWindowTitle: ['are you sure'],
    confirmButton: ['green_terracotta', 'confirm', (item) => item.metadata === 13],
    /** Used when no confirm button is found. */
    confirmSlot: 11,
    depositWindowTitle: ['select items to send'],
  },
  trash: {
    command: '/trash',
    windowTitle: ['trash', 'disposal'],
    confirmButton: 'delete all items',
  },
};

/** Deep-merges `overrides` into `config`; arrays and functions are replaced. */
function mergeConfig(config, overrides) {
  for (const [key, value] of Object.entries(overrides ?? {})) {
    const isObject = value && typeof value === 'object' && !Array.isArray(value);
    config[key] = isObject ? mergeConfig({ ...config[key] }, value) : value;
  }
  return config;
}

const cloneConfig = () => mergeConfig({}, defaultTransferConfig);

module.exports = { defaultTransferConfig, cloneConfig, mergeConfig, isGreenGlass };
