import Script_ from '../../src/main/src/functions/Script';
import { workerDataPath, workerEntryPath } from '../../src/main/src/functions/workerPaths';
import '../../src/main/src/messaging';
import { workerScriptAddress } from '../../src/common/messaging';

jest.mock('../../src/main/src/messaging', () => ({
  backendMessaging: {
    messenger: {
      send: jest.fn(),
      publishToProfile: jest.fn(),
    },
    registerWorker: jest.fn(),
  },
}));

describe('Script_ lifecycle and state methods', () => {
  let script: Script_;
  let mockScriptHandler: any;
  let mockProfile: any;

  beforeEach(() => {
    mockScriptHandler = {
      settings: {
        getProfileSettings: jest.fn(() => ({})),
        shared: {},
        getProfileAppSettings: jest.fn(() => ({})),
        getProfile: jest.fn(() => ({})),
      },
      minecraftBridgeManager: {},
      emit: jest.fn(),
    };

    mockProfile = {
      profileId: 1,
      profileKey: 'jartexnetwork',
      activeBots: { removeBotByScript: jest.fn(), cancelBotJoinRequestsByScript: jest.fn() },
      activeScripts: {
        mainWindow: {},
        send: jest.fn(),
        getProgress: jest.fn((id) => ({ instanceId: id, current: 10, total: 100 })),
        removeScript: jest.fn(),
      },
      workingIps: ['127.0.0.1'],
    };

    script = new Script_(
      { script: 'miner', scriptId: 'plugin-miner', scriptName: 'MinerScript', arguments: {} } as any,
      mockScriptHandler,
      mockProfile,
      { instanceId: 42 },
      new Uint16Array(10),
    );
  });

  describe('constructor initialization', () => {
    it('initializes name, instanceId, id, and messagingAddress', () => {
      expect(script.name).toBe('miner');
      expect(script.instanceId).toBe(42);
      expect(script.runtimeScriptId).toBe(42);
      expect(script.runtimeProfileId).toBe(1);
      expect(script.id).toBe('miner-42');
      expect(script.messagingAddress).toBe(workerScriptAddress(1, 42));
    });

    it('toString formats script status string', () => {
      expect(script.toString()).toBe('Script(name="miner", id="miner-42", running=false)');
    });
  });

  describe('setControls', () => {
    it('sets controls value and notifies activeScripts.send()', () => {
      script.setControls(7);
      expect(script.controls).toBe(7);
      expect(mockProfile.activeScripts.send).toHaveBeenCalled();
    });

    it('sanitizes non-finite controls to 0', () => {
      script.setControls(NaN);
      expect(script.controls).toBe(0);

      script.setControls(Infinity);
      expect(script.controls).toBe(0);

      script.setControls('invalid' as any);
      expect(script.controls).toBe(0);
    });
  });

  describe('updateProgress', () => {
    it('updates progress and updates startCount when progress.current is numeric', () => {
      script.updateProgress({ current: 50, total: 200 } as any);
      expect(script.progress).toEqual({ current: 50, total: 200 });
      expect(script.startCount).toBe(50);
      expect(mockScriptHandler.emit).toHaveBeenCalledWith(
        'PROGRESS_UPDATE',
        { instanceId: 42, current: 10, total: 100 },
        script,
      );
    });

    it('preserves startCount when progress.current is not numeric', () => {
      script.startCount = 15;
      script.updateProgress({ current: undefined, total: 200 } as any);
      expect(script.startCount).toBe(15);
    });
  });

  describe('worker paths', () => {
    const originalEnv = { ...process.env };

    afterEach(() => {
      process.env = { ...originalEnv };
    });

    it('uses JNBOT_WORKER_ROOT environment variable when set', () => {
      process.env.JNBOT_WORKER_ROOT = '/custom/workers/root';
      expect(workerEntryPath()).toBe('/custom/workers/root/main.worker.js');
      expect(workerDataPath()).toBe('/custom/workers/root');
    });
  });
});
