import ActiveScripts_ from '../../src/main/src/functions/ActiveScripts';
import { backendMessaging } from '../../src/main/src/messaging';

jest.mock('../../src/main/src/messaging', () => ({
  backendMessaging: {
    messenger: {
      publishToProfile: jest.fn(),
    },
  },
}));

describe('ActiveScripts_', () => {
  let activeScripts: ActiveScripts_;
  let mockScriptHandler: any;
  let mockQuitScript: jest.Mock;

  beforeEach(() => {
    mockQuitScript = jest.fn();
    mockScriptHandler = {
      publishRuntimeSummary: jest.fn(),
      getRuntime: jest.fn(() => ({
        scriptActionHandler: {
          quitScript: mockQuitScript,
        },
      })),
    };

    activeScripts = new ActiveScripts_(
      {} as any,
      {} as any,
      mockScriptHandler,
      1,
      'jartexnetwork',
    );
  });

  const makeMockScript = (instanceId: number, name = 'test-script', scriptId = 'script-id'): any => ({
    instanceId,
    name,
    scriptId,
    pluginId: scriptId,
    runtimeProfileId: 1,
    runtimeScriptId: instanceId,
    messagingAddress: { type: 'worker', profileId: 1, scriptId: instanceId },
    controls: 3,
    progress: null,
    toString: () => `Script(${name}, ${instanceId})`,
    send: jest.fn(),
  });

  describe('addScript & removeScript', () => {
    it('adds script, emits script-started, and broadcasts activeScripts', () => {
      const scriptStartedSpy = jest.fn();
      activeScripts.on('script-started', scriptStartedSpy);

      const script = makeMockScript(10);
      activeScripts.prepare(script);
      expect(activeScripts.queue.has(script)).toBe(true);

      activeScripts.addScript(script);

      expect(activeScripts.scripts[10]).toBe(script);
      expect(activeScripts.queue.has(script)).toBe(false);
      expect(scriptStartedSpy).toHaveBeenCalledWith(script);
      expect(backendMessaging.messenger.publishToProfile).toHaveBeenCalledWith(
        1,
        'activeScripts',
        expect.objectContaining({ 10: expect.any(Object) }),
      );
    });

    it('removeScript calls quitScript, emits script-ended, and broadcasts update', () => {
      const scriptEndedSpy = jest.fn();
      activeScripts.on('script-ended', scriptEndedSpy);

      const script = makeMockScript(20);
      activeScripts.addScript(script);

      activeScripts.removeScript(script);

      expect(activeScripts.scripts[20]).toBeUndefined();
      expect(mockQuitScript).toHaveBeenCalledWith(20);
      expect(scriptEndedSpy).toHaveBeenCalledWith(20);
      expect(activeScripts.isActiveScript(20)).toBe(false);
    });

    it('removeScript is no-op if script was not active', () => {
      const script = makeMockScript(999);
      activeScripts.removeScript(script);
      expect(mockQuitScript).not.toHaveBeenCalled();
    });
  });

  describe('queries: getScript, isActiveScript, getScriptName, getScriptsByName', () => {
    it('queries scripts by ID and name', () => {
      const scriptA1 = makeMockScript(1, 'miner', 'plugin-a');
      const scriptA2 = makeMockScript(2, 'miner', 'plugin-a');
      const scriptB = makeMockScript(3, 'farmer', 'plugin-b');

      activeScripts.addScript(scriptA1);
      activeScripts.addScript(scriptA2);
      activeScripts.addScript(scriptB);

      expect(activeScripts.getScript(1)).toBe(scriptA1);
      expect(activeScripts.getScript(999)).toBeNull();

      expect(activeScripts.isActiveScript(2)).toBe(true);
      expect(activeScripts.isActiveScript(99)).toBe(false);

      expect(activeScripts.getScriptName(3)).toBe('farmer');
      expect(activeScripts.getScriptName(99)).toBeNull();

      expect(activeScripts.getScriptsByName('miner')).toEqual([scriptA1, scriptA2]);
      expect(activeScripts.getScriptsByScriptId('plugin-b')).toEqual([scriptB]);
    });

    it('supports Symbol.iterator across active scripts', () => {
      const s1 = makeMockScript(1);
      const s2 = makeMockScript(2);
      activeScripts.addScript(s1);
      activeScripts.addScript(s2);

      const iterated = [...activeScripts];
      expect(iterated).toEqual([s1, s2]);
    });
  });

  describe('getProgress', () => {
    it('returns null when script has no progress or total is 0', () => {
      const script = makeMockScript(5);
      script.progress = null;
      activeScripts.addScript(script);
      expect(activeScripts.getProgress(5)).toBeNull();

      script.progress = { current: 10, total: 0 };
      expect(activeScripts.getProgress(5)).toBeNull();
    });

    it('returns ExtendedProgress for a valid script with total > 0', () => {
      const script = makeMockScript(5);
      script.progress = { current: 25, total: 100, eta: '2m' };
      activeScripts.addScript(script);

      const progress = activeScripts.getProgress(5);
      expect(progress).toEqual({
        current: 25,
        total: 100,
        eta: '2m',
        instanceId: 5,
      });
    });

    it('handles instanceId 0 correctly without falling back to all progresses', () => {
      const script0 = makeMockScript(0);
      script0.progress = { current: 5, total: 50 };
      activeScripts.addScript(script0);

      const progress = activeScripts.getProgress(0);
      expect(progress).toEqual({
        current: 5,
        total: 50,
        eta: undefined,
        instanceId: 0,
      });
    });

    it('returns all progresses dictionary when instanceId is omitted', () => {
      const s1 = makeMockScript(1);
      s1.progress = { current: 10, total: 20 };
      const s2 = makeMockScript(2);
      s2.progress = { current: 5, total: 10 };
      activeScripts.addScript(s1);
      activeScripts.addScript(s2);

      const all = activeScripts.getProgress();
      expect(all).toEqual({
        1: { current: 10, total: 20, eta: undefined, instanceId: 1 },
        2: { current: 5, total: 10, eta: undefined, instanceId: 2 },
      });
    });
  });

  describe('minecraft instance integration', () => {
    it('upserts and removes Minecraft instances with deterministic negative IDs', () => {
      activeScripts.upsertMinecraftInstance({
        instanceId: 'mc-1',
        requestedVersion: '1.20.4',
        status: 'running',
      });

      const obj = activeScripts.toObject();
      const mcKey = 'minecraft:mc-1';
      expect(obj[mcKey]).toBeDefined();
      expect(obj[mcKey].origin).toBe('minecraft');
      expect(obj[mcKey].instanceId).toBeLessThan(0);
      expect(obj[mcKey].minecraft?.requestedVersion).toBe('1.20.4');

      activeScripts.removeMinecraftInstance('mc-1');
      const updated = activeScripts.toObject();
      expect(updated[mcKey]).toBeUndefined();
    });
  });

  describe('onExit & toString', () => {
    it('cleans up all scripts on exit', () => {
      activeScripts.addScript(makeMockScript(1));
      activeScripts.addScript(makeMockScript(2));
      expect(Object.keys(activeScripts.scripts)).toHaveLength(2);

      activeScripts.onExit();
      expect(Object.keys(activeScripts.scripts)).toHaveLength(0);
    });

    it('toString formats script list', () => {
      activeScripts.addScript(makeMockScript(1, 'miner'));
      expect(activeScripts.toString()).toContain('miner');
    });
  });
});
