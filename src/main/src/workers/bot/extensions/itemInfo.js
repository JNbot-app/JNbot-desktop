const nbt = require('prismarine-nbt');
const { parseItemText2 } = require('./nbtParser');

const NAME_KEYS = [
  'ViaVersion|Protocol1_13To1_12_2|Name',
  'VV|Protocol1_13To1_12_2|Name',
  'VV|Protocol1_12_2To1_13|Name',
  'Name',
];
const LORE_KEYS = [
  'ViaVersion|Protocol1_14To1_13_2|Lore',
  'VV|Protocol1_14To1_13_2|Lore',
  'VV|Protocol1_13_2To1_14|Lore',
  'Lore',
];

// Legacy text may be JSON ('{"text":...,"extra":[...]}'), one component per line.
function flattenJsonText(text) {
  if (!text.startsWith('{"')) return text;
  try {
    return text
      .split('\n')
      .map(JSON.parse)
      .map((t) => (t.text ?? '') + (t.extra?.map((e) => e.text ?? '').join('') ?? ''))
      .join('\n');
  } catch (err) {
    console.error(err);
    return text;
  }
}

// Reads the first present display key (the name/lore as a string, lore lines joined).
function readDisplay(item, keys) {
  if (!item?.nbt) return '';
  const display = nbt.simplify(item.nbt).display;
  for (const key of keys) {
    let value = display?.[key];
    if (!value) continue;
    if (Array.isArray(value)) value = value.join('\n');
    return flattenJsonText(value);
  }
  return '';
}

function itemName(item) {
  if (!item) return '';
  if (item.componentMap) {
    const name = item.componentMap.get('custom_name')?.data;
    return typeof name === 'object' ? parseItemText2(nbt.simplify(name)) || '' : name || '';
  }
  return readDisplay(item, NAME_KEYS);
}

function itemLore(item) {
  if (!item) return '';
  if (item.componentMap) {
    const lore = item.componentMap.get('lore')?.data;
    return Array.isArray(lore) ? parseItemText2(lore.map(nbt.simplify)) : lore || '';
  }
  return readDisplay(item, LORE_KEYS);
}

/** bot.itemInfo(item) -> { name, info }. Use .name(item) / .lore(item) when you need only one. */
function itemInfo(item) {
  return { name: itemName(item), info: itemLore(item) };
}

// Function#name is read-only, so it has to be redefined.
Object.defineProperty(itemInfo, 'name', { value: itemName });
itemInfo.lore = itemLore;

module.exports = itemInfo;
