import path from 'path';
import fs from 'fs';
import { freshUserData, bootElectron, cleanupUserData } from './helpers';
import Statistics from '../../src/main/src/functions/Stats';

jest.mock('axios', () => ({
  __esModule: true,
  default: { get: jest.fn(async () => null), post: jest.fn(async () => null) },
  get: jest.fn(async () => null),
  post: jest.fn(async () => null),
}));

describe('Statistics', () => {
  let tmpDir: string;
  let mockSettings: any;
  let stats: Statistics;

  beforeEach(() => {
    tmpDir = freshUserData();
    bootElectron(tmpDir);
    (global as any).send = jest.fn();
    (global as any).broadcast = jest.fn();

    mockSettings = {
      bootstrapProfileKey: 'jartexnetwork',
      JNdata: {
        serverList: ['jartexnetwork', 'pikanetwork'],
        servers: {
          jartexnetwork: {
            skyblock: {
              gkits: { kit1: 100 },
              ranks: { vip: { price: 500 } },
            },
          },
        },
      },
      getAltsWithData: jest.fn(() => []),
      NO_SETTINGS_MODE: false,
    };

    stats = new Statistics(mockSettings);
  });

  afterAll(() => {
    cleanupUserData();
  });

  describe('initialization & storage validation', () => {
    it('initializes default stats with empty alts and scripts', () => {
      expect(stats.stats.alts).toEqual({});
      expect(stats.stats.scripts).toEqual({});
    });

    it('populates serverList entries with accountWorth 0 on readStats', () => {
      stats.readStats();
      expect(stats.stats.jartexnetwork).toEqual({ accountWorth: 0 });
      expect(stats.stats.pikanetwork).toEqual({ accountWorth: 0 });
    });
  });

  describe('accounts & bot tracking', () => {
    it('addAccount creates new alt entry with default fields', () => {
      stats.addAccount('Player1');
      expect(stats.stats.alts.Player1).toBeDefined();
      expect(stats.stats.alts.Player1.joinCount).toBe(0);
      expect(stats.stats.alts.Player1.playTime).toBe(0);
      expect(stats.stats.alts.Player1.lastJoined).toBeNull();
      expect(typeof stats.stats.alts.Player1.createdOn).toBe('number');
    });

    it('addAccount is idempotent and does not overwrite existing alt', () => {
      stats.addAccount('Player1', false, { joinCount: 5 });
      stats.addAccount('Player1', false, { joinCount: 10 });
      expect(stats.stats.alts.Player1.joinCount).toBe(5);
    });

    it('incrementBotCount creates account if missing and increments count', () => {
      stats.incrementBotCount('NewBot');
      expect(stats.stats.alts.NewBot.joinCount).toBe(1);
      expect(stats.stats.alts.NewBot.lastJoined).toBeGreaterThan(0);

      stats.incrementBotCount('NewBot');
      expect(stats.stats.alts.NewBot.joinCount).toBe(2);
    });

    it('stopPlayTime adds elapsed time to playTime', () => {
      stats.addAccount('Player1');
      stats.stats.alts.Player1.lastJoined = Date.now() - 5000;
      stats.stopPlayTime('Player1');

      expect(stats.stats.alts.Player1.playTime).toBeGreaterThanOrEqual(4900);

      // Unknown user is a no-op
      expect(() => stats.stopPlayTime('NonExistent')).not.toThrow();
    });
  });

  describe('scripts tracking', () => {
    it('addScript initializes activeCount and runTime to 0', () => {
      stats.addScript('autoFarm');
      expect(stats.stats.scripts.autoFarm).toBeDefined();
      expect(stats.stats.scripts.autoFarm.activeCount).toBe(0);
      expect(stats.stats.scripts.autoFarm.runTime).toBe(0);
      expect(stats.stats.scripts.autoFarm.lastActive).toBeNull();
    });

    it('incrementScriptCount increments activeCount and sets lastActive', () => {
      stats.incrementScriptCount('autoMine');
      expect(stats.stats.scripts.autoMine.activeCount).toBe(1);
      expect(stats.stats.scripts.autoMine.lastActive).toBeGreaterThan(0);
    });

    it('stopRunTime accumulates runTime without producing NaN', () => {
      stats.addScript('autoFish');
      stats.stats.scripts.autoFish.lastActive = Date.now() - 2000;
      stats.stopRunTime('autoFish');

      expect(stats.stats.scripts.autoFish.runTime).toBeGreaterThanOrEqual(1900);
      expect(Number.isFinite(stats.stats.scripts.autoFish.runTime)).toBe(true);
    });
  });

  describe('setStats & validation guards', () => {
    it('rejects update if stats object is missing alts or scripts', () => {
      const initial = stats.stats;
      stats.setStats({} as any);
      expect(stats.stats).toBe(initial);

      stats.setStats({ alts: {} } as any);
      expect(stats.stats).toBe(initial);
    });

    it('rejects update if scripts count decreased', () => {
      stats.addScript('script1');
      stats.addScript('script2');
      expect(Object.keys(stats.stats.scripts)).toHaveLength(2);

      // Attempt update with fewer scripts
      stats.setStats({
        alts: {},
        scripts: { script1: { activeCount: 1, lastActive: null, runTime: 0 } },
      } as any);

      // Remains with 2 scripts
      expect(Object.keys(stats.stats.scripts)).toHaveLength(2);
    });
  });

  describe('mobileActivity', () => {
    it('aggregates joins, scripts, and onlineTime cleanly', () => {
      stats.stats.alts = {
        bot1: { joinCount: 3, playTime: 60000, lastJoined: null, createdOn: 1 },
        bot2: { joinCount: 2, playTime: 30000, lastJoined: null, createdOn: 2 },
      };
      stats.stats.scripts = {
        s1: { activeCount: 4, lastActive: null, runTime: 1000 },
        s2: { activeCount: 1, lastActive: null, runTime: 500 },
      };

      const activity = stats.mobileActivity();
      expect(activity.botsJoined).toBe(5);
      expect(activity.scriptsStarted).toBe(5);
      expect(activity.onlineTime).toBe(90000);
    });

    it('sanitizes negative, NaN, or non-numeric counters in mobileActivity', () => {
      stats.stats.alts = {
        badAlt: { joinCount: -5 as any, playTime: NaN as any, lastJoined: null, createdOn: 1 },
      };
      stats.stats.scripts = {
        badScript: { activeCount: 'invalid' as any, lastActive: null, runTime: 0 },
      };

      const activity = stats.mobileActivity();
      expect(activity.botsJoined).toBe(0);
      expect(activity.scriptsStarted).toBe(0);
      expect(activity.onlineTime).toBe(0);
    });
  });

  describe('calculateAccountWorth', () => {
    it('calculates worth based on alts and server pricing table', () => {
      const alts = [
        {
          username: 'VIPPlayer',
          data: {
            ranks: { skyblock: 'vip' },
            gkits: { skyblock: ['kit1'] },
          },
        },
      ];

      stats.calculateAccountWorth(alts as any, false);
      // ranks.vip (500) + gkits.kit1 (100) = 600
      expect(stats.stats.jartexnetwork.accountWorth).toBe(600);
    });

    it('handles empty alts and missing data without crashing', () => {
      stats.calculateAccountWorth([], false);
      expect(stats.stats.jartexnetwork.accountWorth).toBe(0);
    });
  });
});
