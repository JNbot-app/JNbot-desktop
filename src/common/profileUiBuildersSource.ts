/**
 * Source for the Builder API exposed to profile-UI actions. This file
 * exports the JS as a string so we can run it inside the sandboxed VM
 * context before the user's code (`vm.runInContext`).
 *
 * Keep this source self-contained — no imports, no closures over module
 * scope. Anything it touches must be available in the bare sandbox.
 *
 * The matching TypeScript declarations live in
 * `src/renderer/assets/autoComplete/profileUiTypes.txt` so the editor's
 * autocomplete describes the same surface area.
 */
export const PROFILE_UI_BUILDERS_SOURCE = `
(function () {
  function pushSection(parent, type, column) {
    var section = {
      id: 's_' + (parent._sections.length + 1),
      type: type,
      column: column === 'left' || column === 'right' ? column : 'left',
      data: {},
    };
    parent._sections.push(section);
    return section;
  }

  class IdentityBuilder {
    constructor(section) {
      this._section = section;
      section.data.badges = [];
      section.data.counts = [];
    }
    badge(label, tone, icon) {
      this._section.data.badges.push({ label: String(label), tone: tone, icon: icon });
      return this;
    }
    count(label, value) {
      this._section.data.counts.push({ label: String(label), value: value });
      return this;
    }
  }

  class KpiBuilder {
    constructor(section) {
      this._section = section;
      section.data.items = [];
    }
    item(label, value, opts) {
      opts = opts || {};
      this._section.data.items.push({
        label: String(label),
        value: String(value),
        icon: opts.icon,
        tone: opts.tone,
      });
      return this;
    }
  }

  class RanksBuilder {
    constructor(section) {
      this._section = section;
      section.data.items = [];
    }
    add(name, server, tone, opts) {
      opts = opts || {};
      this._section.data.items.push({
        name: String(name),
        server: server,
        tone: tone,
        emphasis: opts.emphasis,
      });
      return this;
    }
  }

  class StatsGamemodeBuilder {
    constructor(gamemode) {
      this._gm = gamemode;
      gamemode.breakdown = [];
    }
    /** Add a stat row to this gamemode's breakdown. */
    add(label, value, opts) {
      opts = opts || {};
      this._gm.breakdown.push({
        label: String(label),
        value: String(value),
        rank: opts.rank,
        delta: opts.delta,
      });
      return this;
    }
  }

  class StatsBuilder {
    constructor(section) {
      this._section = section;
      section.data.gamemodes = [];
      section.data.breakdown = [];
    }
    /**
     * Add a gamemode tile. Returns a sub-builder whose .add() writes stat
     * rows specific to this gamemode — they only show up when the tile
     * is the active one.
     */
    gamemode(id, label, opts) {
      opts = opts || {};
      var gm = {
        id: String(id),
        label: String(label),
        icon: opts.icon,
        accent: opts.accent,
      };
      this._section.data.gamemodes.push(gm);
      return new StatsGamemodeBuilder(gm);
    }
    selected(id) {
      this._section.data.selected = String(id);
      return this;
    }
    /**
     * Fallback stat row, used only when the active gamemode has no rows
     * of its own. Prefer attaching rows directly via .gamemode(...).add(...).
     */
    add(label, value, opts) {
      opts = opts || {};
      this._section.data.breakdown.push({
        label: String(label),
        value: String(value),
        rank: opts.rank,
        delta: opts.delta,
      });
      return this;
    }
  }

  class UserListBuilder {
    constructor(section) {
      this._section = section;
      section.data.items = [];
    }
    title(t) { this._section.data.title = String(t); return this; }
    icon(i) { this._section.data.icon = String(i); return this; }
    add(username, opts) {
      opts = opts || {};
      this._section.data.items.push({
        username: String(username),
        online: opts.online === true,
        extra: opts.extra,
      });
      return this;
    }
  }

  class GkitsBuilder {
    constructor(section) {
      this._section = section;
      section.data.groups = [];
    }
    group(gamemode, items) {
      if (!Array.isArray(items)) items = [];
      this._section.data.groups.push({
        gamemode: String(gamemode),
        items: items.map(String),
      });
      return this;
    }
  }

  class ProfileBuilder {
    constructor() {
      this._player = { username: '' };
      this._sections = [];
    }
    player(data) { Object.assign(this._player, data || {}); return this; }
    identity(column) { return new IdentityBuilder(pushSection(this, 'identity', column)); }
    kpis(column)     { return new KpiBuilder(pushSection(this, 'kpiStrip', column)); }
    ranks(column)    { return new RanksBuilder(pushSection(this, 'ranks', column)); }
    stats(column)    { return new StatsBuilder(pushSection(this, 'stats', column)); }
    userList(title, column) {
      var b = new UserListBuilder(pushSection(this, 'userList', column));
      if (title) b.title(title);
      return b;
    }
    gkits(column)    { return new GkitsBuilder(pushSection(this, 'gkits', column)); }
    build() {
      return { player: this._player, sections: this._sections };
    }
  }

  // Expose into the sandbox global.
  this.ProfileBuilder = ProfileBuilder;
  this.IdentityBuilder = IdentityBuilder;
  this.KpiBuilder = KpiBuilder;
  this.RanksBuilder = RanksBuilder;
  this.StatsBuilder = StatsBuilder;
  this.StatsGamemodeBuilder = StatsGamemodeBuilder;
  this.UserListBuilder = UserListBuilder;
  this.GkitsBuilder = GkitsBuilder;
}).call(this);
`;
