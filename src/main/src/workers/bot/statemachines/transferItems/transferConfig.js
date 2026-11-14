// Default item-transfer config. Servers tweak it from their bot extension with
// `bot.transfer.configure({ gift: { command: '/send {username}' } })`.
//
// Texts are matched case-insensitively with color codes stripped. A window
// title or item matcher is a list (any entry may match), a single string, a
// RegExp or a function. Item matchers check the item id, display name and lore.

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
    // Used with `sendKeys`; servers with virtual keys use a different trade window.
    /** Button that opens / cycles the virtual key page. */
    keyButton: ['cycle through', 'click to manage crate key'],
    keySlot: 36,
    keyItem: 'tripwire_hook',
    /** Accept slot used when no accept button is found while sending keys. */
    keyAcceptSlot: 27,
  },
  gift: {
    command: '/gift {username}',
    windowTitle: ['{username}'],
    confirmWindowTitle: ['are you sure'],
    confirmButton: ['green_terracotta', 'confirm', (item) => item.metadata === 13],
    /** Used when no confirm button is found. */
    confirmSlot: 11,
    depositWindowTitle: ['select items to send'],
    /** Deposit window item that opens the key page (used when sending keys). */
    keyButton: 'send crate keys',
    /** Key page: lore with the number of keys you own; the first group captures the number. */
    keysOwnedLore: /keys own(?:ed)?:?\s*(\d+)/i,
    /** Key page: lore with the number of keys already added to the gift. */
    keysSendingLore: /keys being sent:?\s*(\d+)/i,
  },
  trash: {
    command: '/trash',
    windowTitle: ['trash', 'disposal'],
    confirmButton: 'delete all items',
  },
  /** Extra names a key type may show up as, e.g. vote keys called "voting". */
  keyAliases: { vote: ['voting'] },
};

// toString instead of a prototype check: plugin objects come from another VM context.
const isPlainObject = (value) => Object.prototype.toString.call(value) === '[object Object]';

/** Deep-merges `overrides` into `config`; arrays, RegExps and functions are replaced. */
function mergeConfig(config, overrides) {
  for (const [key, value] of Object.entries(overrides ?? {})) {
    config[key] = isPlainObject(value) ? mergeConfig({ ...config[key] }, value) : value;
  }
  return config;
}

const cloneConfig = () => mergeConfig({}, defaultTransferConfig);

module.exports = { defaultTransferConfig, cloneConfig, mergeConfig, isGreenGlass };
