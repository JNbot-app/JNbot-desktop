

const nbt = require('prismarine-nbt');
const { customNbtToStr, parseItemText2, getItemText } = require('./nbtParser');


function itemInfo(item) {
    const result = { name: '', info: '' };

    if (!item) return result;
    if (item.componentMap) {
      const res = getItemText(item)
      return {
        name: res.name,
        info: res.lore,
      };
    } else {
      if (!item.nbt) return result;
      const itemNbt = nbt.simplify(item.nbt);
      result.name =
        itemNbt.display?.['ViaVersion|Protocol1_13To1_12_2|Name'] ||
        itemNbt.display?.['VV|Protocol1_13To1_12_2|Name'] ||
        itemNbt.display?.['VV|Protocol1_12_2To1_13|Name'] ||
        itemNbt.display?.Name ||
        '';
      result.info =
        itemNbt.display?.['ViaVersion|Protocol1_14To1_13_2|Lore']?.join('\n') ||
        itemNbt.display?.['VV|Protocol1_14To1_13_2|Lore']?.join('\n') ||
        itemNbt.display?.['VV|Protocol1_13_2To1_14|Lore']?.join('\n') ||
        itemNbt.display?.Lore?.join('\n') ||
        '';
    }

    
      try {
      if (Array.isArray(result.name)) {
        result.name  = result.name.join('\n');
      }
        if (result.name.startsWith('{"')) {
          result.name = result.name
            .split('\n')
            .map(JSON.parse)
            .map(
              (item) =>
                (item.text ?? '') + (item.extra?.map((t) => t.text??"").join('')??""),
            )
            .join('\n');
        }
    } catch (err) {
      console.error(err);
    }

    if (result.info.startsWith('{"')) {
        try {
        result.info = result.info
          .split('\n')
          .map(JSON.parse)
          .map(
            (item) =>
              (item.text ?? '') + (item.extra?.map((t) => t.text ?? '').join('') ??""),
          )
          .join('\n');
        } catch (err) {
          console.error(err);
        }
      }
    return result;
  }

module.exports = itemInfo;
