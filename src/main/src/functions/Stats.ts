import { ipcMain } from 'electron';
import { portablePath } from './storage/portablePaths';
import { AltWithData, Origin, Stats } from '../types';
import Settings from './Settings';
import StorageModule from './storage/Storage';
//import { Socket } from "socket.io";
import calcAccountWorth from '../../../renderer/validators/calculateAccountWorth';
import  EventEmitter from 'node:events';
import type { MobileActivityStats } from '../../../common/mobileClientContract';
import { recordWeekly } from '../../../common/statsHistory';

type HistoryKey = keyof NonNullable<Stats['history']>;

class Statistics extends EventEmitter {
  stats: Stats = {
    alts: {},
    scripts: {},
  };
  needsUpdate: boolean = false;
  path: string;
  settings: Settings;
  statsStorage: StorageModule<Stats>;

  constructor(settings: Settings) {
    super();
    this.path = portablePath('stats.json');
    this.settings = settings;
    this.statsStorage = new StorageModule<Stats>(this.path, defaultStats, {
      validate: (stats: Stats) =>
        !!(!!stats && typeof stats === 'object' && stats.alts && stats.scripts),
      afterRead: (stats: Stats) => {
        for (const id of this.settings?.JNdata?.serverList ?? []) {
          if (!stats[id] || typeof stats[id] !== 'object') {
            stats[id] = { accountWorth: 0 };
          }
        }
        return stats;
      },
    });


    this.events();
  }

  events() {
    ipcMain.on('stats', (e) => {
      e.reply('stats', this.stats);
    });
  }

  setStats(
    stats: Stats,
    clientUpdate: boolean = false,
    origin: Origin | null = { sockets: false, socket: null },
  ) {
    if (!stats?.alts || !stats.scripts)
      return console.error('Invalid stats ', stats);

    if (Object.values(this.stats.scripts).length > Object.values(stats.scripts).length) {
      console.warn('Stats scripts count decreased, this should not happen. Skipping update ');
      return;
    }

    const safeOrigin: Origin = origin ?? { sockets: false, socket: null };

    this.stats = stats;
    this.statsStorage.set(this.stats);
    this.emit('change', this.stats);
    
    if (safeOrigin.sockets) {
      safeOrigin.socket?.broadcast('stats', stats);
      global.send('stats', this.stats);
    } else {
      global.broadcast('stats', stats);
    }
    if (clientUpdate) {
      this.send();
    }
  }

  readStats() {
    this.stats = this.statsStorage.get();
    for (const id of this.settings.JNdata?.serverList ?? []) {
      if (!this.stats[id] || typeof this.stats[id] !== 'object') {
        this.stats[id] = { accountWorth: 0 };
      }
    }
  }

  mobileActivity(): MobileActivityStats {
    return {
      botsJoined: Object.values(this.stats.alts).reduce(
        (total, alt) => total + Math.max(0, Number(alt.joinCount) || 0),
        0,
      ),
      scriptsStarted: Object.values(this.stats.scripts).reduce(
        (total, script) => total + Math.max(0, Number(script.activeCount) || 0),
        0,
      ),
      onlineTime: Object.values(this.stats.alts).reduce(
        (total, alt) => total + Math.max(0, Number(alt.playTime) || 0),
        0,
      ),
      history: this.stats.history,
    };
  }

  calculateAccountWorth(
    alts: AltWithData[] = this.settings.getAltsWithData(),
    needUpdate: boolean = true,
  ) {
    let total = 0;

    const server = this.settings.bootstrapProfileKey;
    this.stats[server] ??= { accountWorth: 0 };

    try {
      for (const alt of alts) {
        total += calcAccountWorth(
          alt.data?.gkits,
          alt.data?.ranks,
          this.settings.JNdata.servers[server],
        );
      }
    } catch (err) {
      console.error('Error calculating account worth:', err);
    }
    console.info('Total account worth:', total);
    if (this.stats[server].accountWorth === total) return;
    this.stats[server].accountWorth = total;
    this.setStats(this.stats, needUpdate);
  }

  addScript(
    scriptName: string,
    update: boolean = false,
    defaultProps: any = {},
  ) {
    if (!(scriptName in this.stats.scripts)) {
      this.stats.scripts[scriptName] = {
        activeCount: 0,
        lastActive: null,
        runTime: 0,
        ...defaultProps,
      };
      this.setStats(this.stats, update);
    }
  }

  addAccount(username: string, update = false, defaultProp: any = {}) {
    if (!(username in this.stats.alts)) {
      this.stats.alts[username] = {
        joinCount: 0,
        lastJoined: null,
        playTime: 0,
        createdOn: Date.now(),
        ...defaultProp,
      };
      this.setStats(this.stats, update);
    }
  }

  checkBot(username: string) {
    if (!(username in this.stats.alts)) {
      this.addAccount(username, false);
    }
  }

  checkScript(scriptName: string) {
    
    if (!(scriptName in this.stats.scripts)) {
      this.addScript(scriptName, false);
    }
  }

  incrementBotCount(username: string) {
    this.checkBot(username);
    this.stats.alts[username].joinCount++;
    this.stats.alts[username].lastJoined = Date.now();
    this.addToHistory('botsJoined', 1);
    this.setStats(this.stats, true);
  }

  incrementScriptCount(scriptName: string) {
    this.checkScript(scriptName);
    this.stats.scripts[scriptName].activeCount++;
    this.stats.scripts[scriptName].lastActive = Date.now();
    this.addToHistory('scriptsStarted', 1);
    this.setStats(this.stats, true);
  }

  /**
   * When bot left the server
   */
  stopPlayTime(username: string) {
    if (!(username in this.stats.alts)) return;
    const u = this.stats.alts[username];
    if (u.lastJoined){
      const played = Date.now() - new Date(u.lastJoined).getTime();
      this.stats.alts[username].playTime += played;
      this.addToHistory('onlineTime', played);
    }
    this.setStats(this.stats, true);
  }

  stopRunTime(scriptName: string) {
    if (!(scriptName in this.stats.scripts)) return;
    const s = this.stats.scripts[scriptName];
    if (s.lastActive)
      this.stats.scripts[scriptName].runTime =
        (this.stats.scripts[scriptName].runTime || 0) +
        (Date.now() - new Date(s.lastActive).getTime());
    console.info(`Script ${scriptName} run time updated to ${this.stats.scripts[scriptName].runTime} ms`);
    this.setStats(this.stats, true);
  }

  private addToHistory(key: HistoryKey, amount: number) {
    this.stats.history ??= {};
    this.stats.history[key] = recordWeekly(this.stats.history[key], (v) => v + amount);
  }

  send() {
    global.send('stats', this.stats);
  }

  writeStats() {
    if (this.stats?.alts && this.stats?.scripts) {
      this.statsStorage.save();
    }
  }
}

function defaultStats(): Stats {
  return {
    alts: {},
    scripts: {},
  };
}

export default Statistics;

/*
interface stats {
  stats: {
    alts: { [username: string]: number };
    totalPrice: number;
    scripts: { [script: string]: number };
  };
}


*/
