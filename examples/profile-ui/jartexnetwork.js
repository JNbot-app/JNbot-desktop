// ────────────────────────────────────────────────────────────────────────
//  JartexNetwork — Profile UI action
// ────────────────────────────────────────────────────────────────────────
//
//  Paste this into a `profileUi` plugin and wire it up as the
//  "Profile UI action" for the jartexnetwork server. It runs in a sandbox
//  every time the player drawer opens.
//
//  Data sources (both public, no auth):
//    • https://stats.jartexnetwork.com/api/profile/<user>
//        → ranks, friends, network level, verification flags, clan, lastSeen
//    • https://stats.jartexnetwork.com/api/profile/<user>/leaderboard
//        ?type=<gamemode>&interval=total&mode=ALL_MODES
//
//  Local data (from jnbot, not the API):
//    • args.serverAltInfo.ranks  → the rank jnbot is CONFIGURED to use, per
//                                   gamemode. These can differ from the API.
//    • args.serverAltInfo.gkits  → the gkits jnbot owns, per gamemode.
//
//  IMPORTANT: the rank pills come from the public API and are NOT the same
//  thing as jnbot's configured rank. To stop people confusing the two, ranks
//  that are ALSO set in jnbot are drawn filled (emphasis 'high') while ranks
//  that live only on the profile API are drawn muted/outlined (emphasis
//  'low') — see the ranks section below.
//
//  NOTE: the sandbox gives the whole action ~5s. Every leaderboard below is
//  fetched in parallel and failures are swallowed, so a slow/own gamemode
//  never blocks the rest of the page.
// ────────────────────────────────────────────────────────────────────────

async function main(args) {
  const { username, profile, stats, fetch, serverAltInfo } = args;
  const BASE =
    'https://stats.jartexnetwork.com/api/profile/' + encodeURIComponent(username);

  // type → display label, emoji icon, accent colour for the stats tiles.
  const GAMEMODES = [
    { type: 'factions_immortal', label: 'Factions',       icon: '⚔️', accent: '#e0533d' },
    { type: 'kitpvp',            label: 'KitPvP',          icon: '🗡️', accent: '#f0a23b' },
    { type: 'skyblock_dream',    label: 'Skyblock Dream',  icon: '🏝️', accent: '#33c2c2' },
    { type: 'lifesteal',         label: 'LifeSteal',       icon: '❤️', accent: '#e23d5b' },
    { type: 'prison',            label: 'Prison',          icon: '⛏️', accent: '#b08968' },
    { type: 'gens',              label: 'Gens',            icon: '💎', accent: '#3ddc97' },
    { type: 'oneblock',          label: 'OneBlock',        icon: '🧱', accent: '#c08a3e' },
    { type: 'survival',          label: 'Survival',        icon: '🌳', accent: '#5cb85c' },
    { type: 'bedwars',           label: 'BedWars',         icon: '🛏️', accent: '#ef5da8' },
    { type: 'skywars',           label: 'SkyWars',         icon: '🌌', accent: '#7c6cf0' },
    { type: 'practice',          label: 'Practice',        icon: '🎯', accent: '#5fb3ff' },
    { type: 'thebridge',         label: 'TheBridge',       icon: '🌉', accent: '#9b7bf0' },
  ];

  // GAMEMODES indexed by simplified `type`, so we can translate jnbot's
  // gamemode keys (e.g. "skyblockdream") into a nice label + icon.
  const GM_BY_KEY = {};
  GAMEMODES.forEach((g) => { GM_BY_KEY[simplify(g.type)] = g; });
  const gmLabel = (key) => {
    const gm = GM_BY_KEY[simplify(key)];
    return gm ? gm.label : (prettyServer(key) || String(key));
  };

  // ---- jnbot's CONFIGURED ranks (the source of truth for "what jnbot uses")
  // serverAltInfo.ranks is keyed by jnbot's gamemode id (e.g. "factionsimmortal")
  // while the API's ranks use a different id space (e.g. "factions"). Index
  // every jnbot rank under both its raw key and the gamemode's display label
  // so we can loosely match an API rank back to it.
  const jnbotRanks = {}; // alias -> configured rank name
  Object.entries((serverAltInfo && serverAltInfo.ranks) || {}).forEach(([key, name]) => {
    if (!name) return;
    const aliases = [simplify(key)];
    const gm = GM_BY_KEY[simplify(key)];
    if (gm) aliases.push(simplify(gm.label));
    aliases.forEach((a) => { jnbotRanks[a] = name; });
  });
  const hasJnbotRanks = Object.keys(jnbotRanks).length > 0;

  // Aliases an API rank's server could match a jnbot rank under.
  const rankAliases = (server) => {
    const out = [simplify(server)];
    const pretty = prettyServer(server);
    if (pretty) out.push(simplify(pretty));
    return out.filter(Boolean);
  };
  // The jnbot rank name an API rank corresponds to, or null if jnbot isn't
  // set to this rank for that gamemode.
  const jnbotRankFor = (rk) => {
    const target = simplify(rk.displayName || rk.name);
    for (const a of rankAliases(rk.server)) {
      if (jnbotRanks[a] && simplify(jnbotRanks[a]) === target) return jnbotRanks[a];
    }
    return null;
  };

  const lbUrl = (type) =>
    BASE + '/leaderboard?type=' + type + '&interval=total&mode=ALL_MODES';

  // Profile + every leaderboard, all at once. Per-request .catch keeps one
  // failure from rejecting the whole batch.
  const [profileRes, ...lbRes] = await Promise.all([
    fetch(BASE).catch(() => null),
    ...GAMEMODES.map((g) =>
      fetch(lbUrl(g.type))
        .then((r) => ({ g, json: r ? r.json : null }))
        .catch(() => null),
    ),
  ]);

  const data = profileRes && profileRes.json ? profileRes.json : {};
  const ranks =  Array.isArray(data.ranks) ? data.ranks : [];
  const friends = Array.isArray(data.friends) ? data.friends : [];
  const net = data.rank || {};

  // ---- gamemodes the player actually has stats for ----------------------
  // For each gamemode we list EVERY stat the API returns — value is always
  // No curation, no derived/synthetic rows: exactly what the API reports.
  const played = [];
  for (const item of lbRes) {
    if (!item) continue;
    const rows = statRows(item.json);
    if (!rows.some((r) => r.total !== 0)) continue; // hide untouched gamemodes
    played.push({
      g: item.g,
      rows: rows.slice(0, 12).map((r) => ({ label: r.label, value: fmtNum(r.total) })),
    });
  }
  // Surface the server's own featured gamemodes (from JNdata) first.
  const featured = (profile && profile.data && profile.data.gamemodes) || [];
  const featuredKeys = featured.map(simplify);
  const rankOf = (g) => {
    const key = simplify(g.label);
    const i = featuredKeys.findIndex((m) => m.includes(key) || key.includes(m));
    return i === -1 ? 999 : i;
  };
  played.sort((a, b) => rankOf(a.g) - rankOf(b.g));

  // ---- jnbot gkits ------------------------------------------------------
  // serverAltInfo.gkits is keyed by jnbot's gamemode id; map each key to a
  // friendly label for the section header.
  const gkitEntries = Object.entries((serverAltInfo && serverAltInfo.gkits) || {})
    .filter(([, items]) => Array.isArray(items) && items.length);
  const totalGkits = gkitEntries.reduce((n, [, items]) => n + items.length, 0);

  // ---- compose the page -------------------------------------------------
  const p = new ProfileBuilder().player({
    username,
    displayName: username,
    displayRank: stripColors(net.rankDisplay) || undefined,
    skinUrl: 'https://crafthead.net/armor/body/' + encodeURIComponent(username),
  });

  // Identity — verification badges + headline counts.
  const id = p.identity('left');
  if (data.email_verified)   id.badge('Email verified', 'emerald');
  if (data.discord_verified) id.badge('Discord linked', 'sky');
  if (data.discord_boosting) id.badge('Nitro booster', 'purple');
  const clanName =
    typeof data.clan === 'string' ? data.clan : data.clan && data.clan.name;
  if (clanName)              id.badge('Clan ' + clanName, 'amber');
  id.count('level', net.level != null ? net.level : '—')
    .count('ranks', ranks.length)
    .count('friends', friends.length);
  if (totalGkits) id.count('gkits', totalGkits);

  // KPI strip — network numbers, plus your local alt stats when this is
  // one of your alts (`stats` is null for everyone else).
  const kpi = p.kpis('right')
    .item('network level', 'Lvl ' + (net.level != null ? net.level : '—'),
      { icon: 'star',   tone: 'amber'   })
    .item('to next level', (net.percentage != null ? net.percentage : 0) + '%',
      { icon: 'bolt',   tone: 'sky'     })
    .item('gamemodes', String(played.length),
      { icon: 'trophy', tone: 'rose'    });
  if (stats) {
    kpi.item('play time', formatDuration(stats.playTime),
        { icon: 'clock', tone: 'cyan'    })
       .item('times joined', String(stats.joinCount != null ? stats.joinCount : 0),
        { icon: 'hash',  tone: 'emerald' });
  }
  kpi.item('last seen', relTime(data.lastSeen),
    { icon: 'clock', tone: 'slate' });

  // Stats — one tile per played gamemode, each with its own breakdown.
  if (played.length) {
    const s = p.stats('right');
    played.forEach(({ g, rows }) => {
      const gm = s.gamemode(g.type, g.label, { icon: g.icon, accent: g.accent });
      rows.forEach((row) => gm.add(row.label, row.value));
    });
    s.selected(played[0].g.type);
  }

  // Ranks — every per-gamemode rank the API reports. Ranks that are ALSO
  // configured in jnbot get high emphasis (filled); ranks that exist only on
  // the profile API get low emphasis (muted/outlined), so the two are never
  // confused. Any jnbot rank the API didn't surface is appended (also high)
  // so "what jnbot uses" is never missing.
  if (ranks.length || hasJnbotRanks) {
    const r = p.ranks('right');
    const seen = {}; // jnbot aliases already shown as a high-emphasis pill

    ranks.forEach((rk) => {
      const name = rk.displayName || rk.name;
      const inBot = !!jnbotRankFor(rk);
      if (inBot) rankAliases(rk.server).forEach((a) => { seen[a] = true; });
      r.add(name, prettyServer(rk.server), toneFor(rk.server), {
        emphasis: inBot ? 'high' : 'low',
      });
    });

    Object.entries((serverAltInfo && serverAltInfo.ranks) || {}).forEach(([gm, name]) => {
      if (!name) return;
      if (rankAliases(gm).some((a) => seen[a])) return;
      r.add(name, gmLabel(gm), toneFor(gm), { emphasis: 'high' });
      rankAliases(gm).forEach((a) => { seen[a] = true; });
    });
  }

  // Gkits — straight from jnbot's config (serverAltInfo), grouped by gamemode.
  if (gkitEntries.length) {
    const gk = p.gkits('left');
    gkitEntries.forEach(([gm, items]) => gk.group(gmLabel(gm), items));
  }

  // Friends — clickable list (opens that player's drawer).
  if (friends.length) {
    const fl = p.userList('Friends · ' + friends.length, 'left');
    friends.forEach((f) => fl.add(f.username));
  }

  return p.build();
}

// ─── helpers ──────────────────────────────────────────────────────────────

/**
 * Every stat the leaderboard reports, in API order. `value` is always
 * dropped. Nothing is curated, derived, or invented.
 */
function statRows(json) {
  const out = [];
  for (const key of Object.keys(json)) {
    const entry = json[key];
    let total = entry?.entries?.[0]?.value
    if(!total) continue
    if (typeof total !== 'number') total = Number(total)
    out.push({ label: key, total: total });
  }
  return out;
}

/** Thousands-separated integer — same value, just readable. */
function fmtNum(n) {
  if (typeof n !== 'number' || !isFinite(n)) return '0';
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** Strip Minecraft colour codes (&a, §b) and bracket wrappers. */
function stripColors(s) {
  return String(s == null ? '' : s)
    .replace(/[§&][0-9a-fk-or]/gi, '')
    .replace(/[[\]]/g, '')
    .trim();
}

function formatDuration(ms) {
  if (!ms || ms < 0) return '0m';
  const m = Math.floor(ms / 60000);
  const h = Math.floor(m / 60);
  const d = Math.floor(h / 24);
  if (d > 0) return d + 'd ' + (h % 24) + 'h';
  if (h > 0) return h + 'h ' + (m % 60) + 'm';
  return m + 'm';
}

function relTime(ts) {
  if (!ts) return 'unknown';
  const diff = Date.now() - ts;
  if (diff < 0) return 'now';
  const m = Math.floor(diff / 60000);
  const h = Math.floor(m / 60);
  const d = Math.floor(h / 24);
  if (d > 0) return d + 'd ago';
  if (h > 0) return h + 'h ago';
  if (m > 0) return m + 'm ago';
  return 'just now';
}

/** Lowercase, letters only — for loose gamemode-name matching. */
function simplify(s) {
  return String(s == null ? '' : s).toLowerCase().replace(/[^a-z]/g, '');
}

const SERVER_LABELS = {
  global: 'Global', prison: 'Prison', kitpvp: 'KitPvP', factions: 'Factions',
  sb_fan: 'Skyblock Fantasy', sb_dream: 'Skyblock Dream', games: 'Games',
  creative: 'Creative', survival: 'Survival', lifesteal: 'LifeSteal',
  gens: 'Gens', oneblock: 'OneBlock',
};
function prettyServer(s) {
  if (SERVER_LABELS[s]) return SERVER_LABELS[s];
  if (!s) return undefined;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const SERVER_TONES = {
  kitpvp: 'amber', prison: 'slate', factions: 'red', sb_dream: 'cyan',
  sb_fan: 'purple', games: 'sky', global: 'emerald', survival: 'emerald',
  lifesteal: 'rose', gens: 'emerald', oneblock: 'amber',
};
function toneFor(s) {
  return SERVER_TONES[s] || 'indigo';
}
