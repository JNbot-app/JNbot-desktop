import { Alt, AltWithData } from "main/src/types";

/**
 * Apply the standard alt filtering pipeline shared by every script.
 *
 * Stages, in order:
 *   1. Reorder by `tags` (if any) — concatenate alts from each selected tag in
 *      the order the user picked them, deduplicating across tags. When no tags
 *      are selected, the original alt order is preserved.
 *   2. Slice by `startWith` (inclusive).
 *   3. Slice by `endsWith` (inclusive). Logs a warning if the username is not
 *      present in the (already tag-ordered) list.
 *   4. Drop usernames listed in `ignoreAlts`.
 *   5. Apply the script-specific `altFilter` callback (e.g. "skip alts with no
 *      gkits"). Use a callback because the criterion differs per script.
 *
 * Returns the filtered alts plus `altsBeforeFilter` — the count right before
 * the ignore/altFilter pass. Scripts use this to detect "user filtered out
 * every alt" and show a popup.
 *
 */
function filterAlts( allAlts: AltWithData[], opts: {gamemode?:string,alts?:string[] | string, altRange?: [string|null, string|null]; ignoreAlts?: string[]; withTags?: string[]; withoutTags?: string[]; altFilter?: (alt: Alt) => boolean; withRanks?: boolean | string[]; withGkits?: boolean | string[]; }) {
  const {
    gamemode,
    alts,
    altRange: [startWith, endsWith] = [null, null],
    ignoreAlts = [],
    withTags = [],
    withoutTags = [],
    withRanks = false,
    withGkits = false,
    altFilter,
  } = opts;

  const canonicalGamemode = typeof gamemode === 'string' ? gamemode.toLowerCase(): "";

  let selectedAlts: AltWithData[];

  if (alts) {
    if (typeof alts === 'string') {
      return allAlts.filter((a) => a.username === alts);
    } else {
      const altsSet = new Set(alts.map((s) => s.toLowerCase()));
      return allAlts.filter((a) => altsSet.has(a.username.toLowerCase()));
    }
  }

  if (withTags && withTags.length > 0) {
    // Tags drive both inclusion AND ordering: first tag's alts come first,
    // then the second tag's alts (minus duplicates), and so on. Each tag's
    // internal alt order is preserved.
    // altTags is now flat (settings already scoped to the active server).
    const allTags = global.settings?.altTags ?? [];
    const tagsById = new Map(allTags.map((t) => [t.id, t]));
    const altsByUsername = new Map(allAlts.map((a) => [a.username, a]));
    const seen = new Set();
    selectedAlts = [];
    for (const tagId of withTags) {
      const tag = tagsById.get(tagId);
      if (!tag) continue;
      for (const username of tag.alts) {
        if (seen.has(username)) continue;
        const alt = altsByUsername.get(username);
        if (!alt) continue;
        seen.add(username);
        selectedAlts.push(alt);
      }
    }
  } else {
    selectedAlts = [...allAlts];
  }

  
  if (startWith) {
    const idx = selectedAlts.findIndex((a) => a.username === startWith);
    if (idx !== -1) selectedAlts = selectedAlts.slice(idx);
  }
  
  if (endsWith) {
    const idx = selectedAlts.findIndex((a) => a.username === endsWith);
    if (idx !== -1) selectedAlts = selectedAlts.slice(0, idx + 1);
    else global.log(`${endsWith} not found to end with`, 'warning');
  }

  if (withRanks && gamemode) {
    const ranksOnlySet = typeof withRanks === 'boolean' ? null : withRanks.map(String).map((s) => s.toLowerCase());
    if (ranksOnlySet) {
      selectedAlts = selectedAlts.filter((a) => a.data.ranks?.[canonicalGamemode] && ranksOnlySet.includes(a.data.ranks[canonicalGamemode].toLowerCase()));
    } else {
      selectedAlts = selectedAlts.filter((a) => !!a.data.ranks?.[canonicalGamemode])
    }
  }


  if (withGkits && gamemode) {
    const gkitsOnlySet = typeof withGkits === 'boolean' ? null : withGkits.map(String).map((s) => s.toLowerCase());
    if (gkitsOnlySet) {
      selectedAlts = selectedAlts.filter((a) => a.data.gkits?.[canonicalGamemode] &&  a.data.gkits[canonicalGamemode].some((gk) => gkitsOnlySet.includes(gk.toLowerCase())));
    } else {
      selectedAlts = selectedAlts.filter((a) => !!a.data.gkits?.[canonicalGamemode]?.length)
    }
  }


  if (withoutTags.length) {
    const allTags = global.settings?.altTags ?? [];
    const excluded = new Set(
      allTags
        .filter((t) => withoutTags.includes(t.id) || withoutTags.includes(t.name))
        .flatMap((t) => t.alts ?? []),
    );
    selectedAlts = selectedAlts.filter((a) => !excluded.has(a.username));
  }

  if (ignoreAlts.length) {
    const ignoreSet = new Set(ignoreAlts);
    selectedAlts = selectedAlts.filter((a) => !ignoreSet.has(a.username));
  }

  if (altFilter) selectedAlts = selectedAlts.filter(altFilter);
  return selectedAlts;
}

export default filterAlts;
