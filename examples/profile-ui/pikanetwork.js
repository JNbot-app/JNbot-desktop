// ────────────────────────────────────────────────────────────────────────
//  Piaknetwork — Profile UI action
// ────────────────────────────────────────────────────────────────────────
//
//  Paste this into a `profileUi` plugin and wire it up as the
//  "Profile UI action" for the pikanetwork server. It runs in a sandbox
//  every time the player drawer opens.
//
//  Data sources (both public, no auth):
//    • https://stats.pika-network.net/api/profile/<user>
//        → ranks, friends, network level, verification flags, clan, lastSeen
//    • https://stats.pika-network.net/api/profile/<user>/leaderboard
//        ?type=<gamemode>&interval=total&mode=ALL_MODES
//
//  Local data (from jnbot, not the API):
//    • args.serverAltInfo.ranks  → the rank jnbot is CONFIGURED to use, per
//                                   gamemode. These can differ from the API.
//    • args.serverAltInfo.gkits  → the gkits jnbot owns, per gamemode.
//
//  `args.profile` carries the active server's JNdata (rank/gkit catalog) —
//  used here to order the server's featured gamemodes first in the stats card.
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
  // https://stats.pika-network.net/api/profile/usserwout
  const BASE =
    'https://stats.pika-network.net/api/profile/' + encodeURIComponent(username);

  // type → display label, emoji icon, accent colour for the stats tiles.
  const GAMEMODES = [
    { type: 'opfactions',        label: 'OP Factions',      icon: '⚔️', accent: '#e0533d' },
    { type: 'opprison',          label: 'OP Prison',        icon: '⛏️', accent: '#b08968' },
    { type: 'opskyblock',        label: 'OP Skyblock',      icon: '🏝️', accent: '#33c2c2' },
    { type: 'oneblock',          label: 'OneBlock',         icon: '🧱', accent: '#c08a3e' },
    { type: 'survival',          label: 'Survival',         icon: '🌳', accent: '#5cb85c' },
    { type: 'kitpvp',            label: 'KitPvP',           icon: '🗡️', accent: '#f0a23b' },
    { type: 'unrankedpractice',  label: 'Practice',         icon: '🎯', accent: '#5fb3ff' },
    { type: 'bedwars',           label: 'BedWars',          icon: '🛏️', accent: '#ef5da8' },
    { type: 'oplifesteal',       label: 'OP LifeSteal',     icon: '❤️', accent: '#e23d5b' },
    { type: 'skypvp',            label: 'SkyPvP',           icon: '🌌', accent: '#7c6cf0' },
    { type: 'skymines',          label: 'SkyMines',         icon: '💣', accent: '#9b7bf0' },
    { type: 'genpvp',            label: 'GenPvP',           icon: '💎', accent: '#3ddc97' },
    { type: 'dungeons',          label: 'Dungeons',         icon: '🛡️', accent: '#a1a1a1' }
  ];

  // GAMEMODES indexed by simplified `type`, so we can translate jnbot's
  // gamemode keys (e.g. "opfactions") into a nice label + icon.
  const GM_BY_KEY = {};
  GAMEMODES.forEach((g) => { GM_BY_KEY[simplify(g.type)] = g; });
  const gmLabel = (key) => {
    const gm = GM_BY_KEY[simplify(key)];
    return gm ? gm.label : (prettyServer(key) || String(key));
  };

  // ---- jnbot's CONFIGURED ranks (the source of truth for "what jnbot uses")
  // serverAltInfo.ranks is keyed by jnbot's gamemode id while the API's ranks
  // use a different id space (e.g. "opfac" vs "opfactions"). Index every jnbot
  // rank under both its raw key and the gamemode's display label so we can
  // loosely match an API rank back to it.
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
  const ranks = Array.isArray(data.ranks) ? data.ranks : [];
  const friends = Array.isArray(data.friends) ? data.friends : [];
  const net = data.rank || {};

  // ---- gamemodes the player actually has stats for ----------------------
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
  if (data.clan)             id.badge('Clan ' + data.clan.name, 'amber');
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


/** Pick up to 6 of the most interesting stat rows for a gamemode. */
function pickRows(flat) {
  const PRIORITY = [
    'Kills', 'Deaths', 'Wins', 'Final kills', 'Beds destroyed', 'Nexus broken',
    'Games played', 'Highest Killstreak', 'Highest winstreak reached',
    'Current Killstreak', 'Prestige', 'Player Level', 'Level', 'Balance',
    'Tokens Obtained', 'Money Made', 'Mobs Killed', 'Souls', 'Blocks Broken',
  ];
  const chosen = [];
  const used = {};
  const push = (label) => {
    if (used[label] || !(label in flat)) return;
    used[label] = true;
    chosen.push({ label: label, value: fmtStat(label, flat[label]) });
  };

  push('Kills');
  push('Deaths');
  if ('Kills' in flat && 'Deaths' in flat) {
    const k = flat.Kills, d = flat.Deaths;
    chosen.push({ label: 'K/D', value: d > 0 ? (k / d).toFixed(2) : String(k) });
  }
  PRIORITY.forEach(push);
  // Fill any remaining slots with the biggest leftover stats.
  Object.keys(flat)
    .filter((l) => !used[l])
    .sort((a, b) => flat[b] - flat[a])
    .forEach(push);

  return chosen.slice(0, 6);
}

function fmtStat(label, n) {
  if (/balance|money|coins|tokens|sold|made/i.test(label)) return '$' + fmtNum(n);
  return fmtNum(n);
}

function fmtNum(n) {
  if (typeof n !== 'number' || !isFinite(n)) return '0';
  const abs = Math.abs(n);
  if (abs >= 1e6) {
    const m = n / 1e6;
    return (abs >= 1e8 ? Math.round(m) : Math.round(m * 10) / 10) + 'M';
  }
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** Strip Minecraft colour codes (&a, §b) and bracket wrappers. */
function stripColors(s) {
  return String(s == null ? '' : s)
    .replace(/[§&][0-9a-fk-or]/gi, '')
    .replace(/[[\]]/g, '')
    .trim();
}

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
  global: 'Global',
  opprison: 'OP Prison',
  kitpvp: 'KitPvP',
  opfac: 'OP Factions',
  opsb: 'OP Skyblock',
  games: 'Minigames', // Handles BedWars, Practice, SkyPvP, etc.
  survival: 'Survival',
  oplifesteal: 'OP LifeSteal',
  oneblock: 'OneBlock',
  skymines: 'SkyMines',
  genpvp: 'GenPvP',
  dungeons: 'Dungeons'
};

function prettyServer(s) {
  if (SERVER_LABELS[s]) return SERVER_LABELS[s];
  if (!s) return undefined;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const SERVER_TONES = {
  global: 'emerald',
  opprison: 'slate',
  kitpvp: 'amber',
  opfac: 'red',
  opsb: 'cyan',
  games: 'sky',
  survival: 'emerald',
  oplifesteal: 'rose',
  oneblock: 'amber',
  skymines: 'purple',
  genpvp: 'emerald',
  dungeons: 'zinc'
};
function toneFor(s) {
  return SERVER_TONES[s] || 'indigo';
}
