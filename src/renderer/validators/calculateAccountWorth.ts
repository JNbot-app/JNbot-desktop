import type { JNdataServer } from "../../main/src/types";

function calcAccountWorth(
  gkits: Record<string, string[]> = {},
  rank: Record<string, string> = {},
  JNdata: JNdataServer,
) {
  let worth = 0;

  for (const [modeKey, kits] of Object.entries(gkits)) {
    if (!modeKey || !kits?.length) continue;
    const gamemode = modeKey.toLowerCase();
    const gkitsData = JNdata[gamemode]?.gkits;
    if (!gkitsData) continue;
    for (const gkit of kits) {
      worth += gkitsData[gkit] ?? 0;
    }
  }

  for (const [modeKey, rankName] of Object.entries(rank)) {
    if (!rankName) continue;
    const gamemode = modeKey.toLowerCase();
    const price = JNdata[gamemode]?.ranks?.[rankName.toLowerCase()]?.price;
    worth += price ?? 0;
  }

  return worth;
}

export default calcAccountWorth;
