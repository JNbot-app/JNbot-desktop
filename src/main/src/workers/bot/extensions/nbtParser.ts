import type { Item } from 'prismarine-item';
import nbt from 'prismarine-nbt';

const colorsToAscii: Record<string, string> = {
  dark_red: '§4',
  red: '§c',
  gold: '§6',
  yellow: '§e',
  dark_green: '§2',
  green: '§a',
  aqua: '§b',
  dark_aqua: '§3',
  dark_blue: '§1',
  blue: '§9',
  light_purple: '§d',
  dark_purple: '§5',
  white: '§f',
  gray: '§7',
  dark_gray: '§8',
  black: '§0',

  // Bedrock only \\
  minecoin_gold: '§g',
  material_quartz: '§h',
  material_iron: '§i',
  material_netherite: '§j',
  material_redstone: '§m',
  material_copper: '§n',
  material_gold: '§p',
  material_emerald: '§q',
  material_diamond: '§s',
  material_lapis: '§t',
  material_amethyst: '§u',
};

const toAnsiColors: Record<string, string> = {
  '§0': '\x1b[30m',
  '§1': '\x1b[34m',
  '§2': '\x1b[32m',
  '§3': '\x1b[36m',
  '§4': '\x1b[31m',
  '§5': '\x1b[35m',
  '§6': '\x1b[33m',
  '§7': '\x1b[37m',
  '§8': '\x1b[90m',
  '§9': '\x1b[94m',
  '§a': '\x1b[92m',
  '§b': '\x1b[96m',
  '§c': '\x1b[91m',
  '§d': '\x1b[95m',
  '§e': '\x1b[93m',
  '§f': '\x1b[97m',
  '§k': '\x1b[8m',
  '§l': '\x1b[1m',
  '§m': '\x1b[9m',
  '§n': '\x1b[4m',
  '§o': '\x1b[3m',
  '§r': '\x1b[0m',
};


function customNbtToStr(
  json: Record<string, any>,
  list: string[] = [],
): string[] {
  const {
    bold,
    italic,
    underlined,
    strikethrough,
    obfuscated,
    color,
    text,
    extra,
  } = json;

  if (bold) list.push('§l');
  if (italic) list.push('§o');
  if (underlined) list.push('§n');
  if (strikethrough) list.push('§m');
  if (obfuscated) list.push('§k');
  if (color) list.push(colorsToAscii[color] ?? '');
  if (text) {
    if (typeof text === 'string') list.push(text);
    else if (Array.isArray(text)) {
      for (const t of text) {
        customNbtToStr(t, list);
      }
    } else customNbtToStr(text, list);
  }

  if (extra) {
    if (Array.isArray(extra)) {
      for (const e of extra) {
        customNbtToStr(e, list);
      }
    } else {
      customNbtToStr(extra, list);
    }
  }

  return list;
}

function parseJSON(str: string): Record<string, any> | null {
  if (typeof str !== 'string') {
    return null;
  }

  if (
    !str.trim().startsWith('{') &&
    !str.trim().startsWith('[') &&
    str !== '""'
  ) {
    return null;
  }

  try {
    return JSON.parse(str);
  } catch (e) {
    return { text: str };
  }
}

function getItemText(item: Item): { name: string; lore: string } {
  let result = { name: '', lore: '' };
  if (item?.componentMap) {
    result.name = item.componentMap.get('custom_name')?.data || '';
    result.lore = item.componentMap.get('lore')?.data || [];

    if (typeof result.name === 'object') {
      result.name = parseItemText2(nbt.simplify(result.name)) || '';
    }

    if (Array.isArray(result.lore)) {
      result.lore = parseItemText2(result.lore.map(nbt.simplify));
    }
    return result;
  }
  item = item.nbt;
  if (!item?.value?.display) return result;

  const simplified = nbt.simplify(item.value.display);
  if (simplified.Name) result.name = parseItemText(simplified.Name);
  if (simplified.Lore) result.lore = parseItemText(simplified.Lore);
  return result;
}

function getItemName(item: Item['nbt']): string {
  if (!item?.value?.display) return '';

  const simplified = nbt.simplify(item.value.display);
  return simplified.Name ? parseItemText(simplified.Name) : '';
}

function parseItemText2(
  text: string | Record<string, any> | (string | Record<string, any>)[],
): string {
  if (!text) return '';
  if (typeof text === 'string') return text;
  if (Array.isArray(text)) {
    return text.map((t) => parseItemText2(t)).join('\n');
  }
  return customNbtToStr(text).join('');
}

function parseItemText(text: string | string[] | Record<string, any>): string {
  
  
  if (typeof text === 'string') {
    if (!text?.length) return '';
    let json = parseJSON(text);
    if (json === null) return text;
    return customNbtToStr(json).join('');
  }

  if (Array.isArray(text)) {
    if (!text?.length) return '';
    const json = parseJSON(text[0]);
    if (json === null) {
      return text.join('\n');
    }
    let arr = `[${text.join(',')}]`;
    let parsed = parseJSON(arr);
    if (parsed === null) return text.join('\n');
    let lines: string[] = [];
    for (let i = 0; i < parsed.length; i++) {
      lines.push(customNbtToStr(parsed[i]).join(''));
    }
    return lines.join('\n');
  }

  if (typeof text === 'object') {
    return customNbtToStr(text).join('');
  }

  return '';
}

function toAnsi(text: string): string {
  if (!text) return text;
  return text.replace(/§[0-9a-fklmnor]/g, (match) => toAnsiColors[match] ?? '');
}

function parseRawNbt(nbtData: any) {
  if (!nbtData) return '';

  if (nbtData.value) {
    nbtData = nbt.simplify(nbtData);
  }
  return parseItemText(nbtData);
}

// Not for items, but for other nbt data like sidebar header
function nbtToStr(nbtData: nbt.Tags['string']) {
  if (!nbtData) return '';
  if (typeof nbtData === 'string') return nbtData;
  const simplified = nbt.simplify(nbtData);
  return customNbtToStr(simplified).join('');
}

export {
  getItemName,
  parseItemText,
  getItemText,
  toAnsi,
  parseRawNbt,
  customNbtToStr,
  nbtToStr,
  parseItemText2,
};
