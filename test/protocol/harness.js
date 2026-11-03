/* eslint-disable no-console */
/**
 * Local, deterministic Minecraft protocol fixture for worker integration
 * tests. It deliberately speaks only to a Mineflayer client on loopback; the
 * scenario language contains no executable callbacks so fixtures stay small
 * and reviewable.
 */
const path = require('path');
const fs = require('fs');
const { Worker } = require('worker_threads');
const mc = require('minecraft-protocol');

const ROOT = path.resolve(__dirname, '..', '..');
const DIST_MAIN = path.join(ROOT, 'release', 'app', 'dist', 'main');
const WORKER_PATH = path.join(DIST_MAIN, 'src', 'workers', 'main.worker.js');
const MC_DATA_PATH = path.join(DIST_MAIN, 'src', 'workers');

const VERSION_ALIASES = { '1.8.9': '1.8.8' };
const PASSIVE_CLIENT_PACKETS = new Set([
  'settings',
  'keep_alive',
  'teleport_confirm',
  'client_command',
  'custom_payload',
  'position_look',
]);

function protocolVersion(version) {
  return VERSION_ALIASES[version] || version;
}

function assertScenario(scenario) {
  if (!scenario || typeof scenario !== 'object')
    throw new TypeError('Scenario must be an object');
  if (!scenario.name || !scenario.version || !scenario.script)
    throw new TypeError('Scenario requires name, version, and script');
  if (!Array.isArray(scenario.steps))
    throw new TypeError('Scenario steps must be an array');
  for (const step of scenario.steps) {
    if (!step || typeof step !== 'object')
      throw new TypeError('Every scenario step must be an object');
    if (!step.send && !step.expect)
      throw new TypeError('Every scenario step requires send or expect');
    if (step.send && step.expect)
      throw new TypeError('A scenario step cannot send and expect simultaneously');
    if (step.send && !['spawn', 'kick'].includes(step.send))
      throw new TypeError(`Unsupported server step: ${step.send}`);
    if (step.expect === 'held_item_slot' && !Number.isInteger(step.slot))
      throw new TypeError('held_item_slot expectations require an integer slot');
    if (step.expect === 'chat' && typeof step.message !== 'string')
      throw new TypeError('chat expectations require a message');
    if (step.expect && !['held_item_slot', 'chat'].includes(step.expect))
      throw new TypeError(`Unsupported client expectation: ${step.expect}`);
  }
}

function workerDataFor(scenario) {
  const address = 2 * 2 ** 40 + 2 ** 26 + 2 ** 13;
  return {
    scriptName: 'macro',
    script: scenario.name,
    id: `${scenario.name}-0`,
    instanceId: 1,
    scriptId: `test-${scenario.name}`,
    pluginId: `test-${scenario.name}`,
    messaging: { address, profileId: 1, scriptId: 1 },
    data: {
      isMacro: true,
      devMode: true,
      macroInfo: {
        name: scenario.name,
        description: 'Offline protocol fixture',
        pluginId: `test-${scenario.name}`,
        language: 'js',
        scriptType: 'script',
        type: 'private',
        flags: 0,
      },
      components: { code: scenario.script },
    },
    appSettings: {
      version: scenario.version,
      max_memory_usage: 512,
      retryOnLoginFail: false,
      joinServerTimeout: 5_000,
    },
    settings: { scripts: {}, altData: {}, alts: [], devices: [], ...scenario.settings },
    sharedSettings: { alts: [], devices: [], ...scenario.sharedSettings },
    profile: { gamemodes: scenario.gamemodes || {} },
    paths: {
      plugins: DIST_MAIN,
      recordings: DIST_MAIN,
      minecraftAuth: DIST_MAIN,
    },
    scriptOptions: {
      startTime: Date.now(),
      ips: ['127.0.0.1'],
      disableConsolePrints: true,
    },
    actions: [],
    appVersion: 'test',
    isMobileRuntime: false,
    testHarness: { http: true },
  };
}

function spawnPackets(client) {
  client.write('login', {
    entityId: 1,
    gameMode: 0,
    dimension: 0,
    difficulty: 1,
    maxPlayers: 20,
    levelType: 'default',
    reducedDebugInfo: false,
  });
  client.write('position', {
    x: 0,
    y: 64,
    z: 0,
    yaw: 0,
    pitch: 0,
    flags: 0,
  });
  client.write('update_health', { health: 20, food: 20, foodSaturation: 5 });
}

function reply(worker, envelope, data) {
  worker.postMessage({
    __messenger: true,
    frame: {
      envelope: {
        version: 1,
        type: 'response',
        event: envelope.event,
        to: envelope.from,
        from: 0,
        correlationId: envelope.correlationId,
        data,
      },
    },
  });
}

/**
 * Execute a plugin body in the built worker against a loopback protocol
 * server. Supported declarative steps are currently `send: 'spawn'`,
 * `send: 'kick'`, and `expect: 'held_item_slot'`; extending the switch is the
 * only place packet details belong.
 */
async function runSemanticScenario(scenario) {
  assertScenario(scenario);
  if (!fs.existsSync(WORKER_PATH)) {
    throw new Error(
      `Worker bundle is missing at ${WORKER_PATH}. Run npm run build:main first.`,
    );
  }

  const result = {
    name: scenario.name,
    connections: 0,
    errors: [],
    logs: [],
    remainingSteps: [],
  };
  const steps = scenario.steps.map((step) => ({ ...step }));
  const clients = new Set();
  let worker;
  let timer;
  let settled = false;

  const server = mc.createServer({
    'online-mode': false,
    version: protocolVersion(scenario.version),
    keepAlive: false,
    host: '127.0.0.1',
    port: 0,
  });

  const complete = (resolve, reject) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    result.remainingSteps = steps;
    try {
      worker?.removeAllListeners();
      void worker?.terminate();
      for (const connectedClient of clients) {
        connectedClient.end?.();
        connectedClient.socket?.destroy?.();
      }
      server.close();
    } catch (error) {
      result.errors.push(error instanceof Error ? error.message : String(error));
    }
    if (result.errors.length || result.remainingSteps.length) {
      reject(
        new Error(
          `${scenario.name} failed: ${result.errors.join('; ') || 'unconsumed steps: ' + JSON.stringify(result.remainingSteps)}`,
        ),
      );
      return;
    }
    resolve(result);
  };

  return new Promise((resolve, reject) => {
    const progress = () => {
      while (steps[0]?.send) {
        const step = steps.shift();
        const activeClient = [...clients].at(-1);
        if (step.send === 'spawn') spawnPackets(activeClient);
        else if (step.send === 'kick') activeClient.end(step.reason || 'fixture kick');
      }
    };

    const onClientPacket = (data, meta) => {
      const step = steps[0];
      if (!step?.expect || meta.name !== step.expect) {
        if (!PASSIVE_CLIENT_PACKETS.has(meta.name))
          result.errors.push(`Unexpected client packet: ${meta.name}`);
        return;
      }
      if (
        step.expect === 'held_item_slot' &&
        Number(data.slotId ?? data.slot) !== Number(step.slot)
      ) {
        result.errors.push(
          `Expected held item slot ${step.slot}, received ${data.slotId ?? data.slot}`,
        );
        return;
      }
      if (step.expect === 'chat' && data.message !== step.message) {
        result.errors.push(`Expected chat ${JSON.stringify(step.message)}, received ${JSON.stringify(data.message)}`);
        return;
      }
      steps.shift();
      progress();
    };

    server.on('login', (connectedClient) => {
      clients.add(connectedClient);
      connectedClient.once('end', () => clients.delete(connectedClient));
      result.connections++;
      connectedClient.on('packet', onClientPacket);
      progress();
    });
    server.on('error', (error) => result.errors.push(`server: ${error.message}`));

    const startWorker = () => {
      const port = server.socketServer.address().port;
      worker = new Worker(WORKER_PATH, {
        workerData: workerDataFor(scenario),
        env: { ...process.env, MC_DATA_PATH },
        execArgv: ['--no-deprecation'],
      });
      worker.on('message', (message) => {
        const envelope = message?.frame?.envelope;
        if (!envelope) return;
        if (envelope.type === 'request' && envelope.event === 'worker:action') {
          const action = envelope.data;
          if (action?.event === 'BOT_JOIN_REQUEST') {
            reply(worker, envelope, { granted: true, host: '127.0.0.1', port });
            return;
          }
          if (action?.event === 'BOT_JOINED') {
            reply(worker, envelope, { ok: true });
            return;
          }
          if (action?.event === 'TEST_HTTP_REQUEST') {
            const fixture = scenario.http?.find(
              (entry) => entry.method === action.data?.method && entry.url === action.data?.url,
            );
            reply(
              worker,
              envelope,
              fixture
                ? { ok: true, data: fixture.data, status: fixture.status, headers: fixture.headers }
                : { ok: false, error: `No HTTP fixture for ${action.data?.method} ${action.data?.url}` },
            );
            return;
          }
          result.errors.push(`Unhandled worker action: ${action?.event}`);
          reply(worker, envelope, { ok: true });
          return;
        }
        if (envelope.type === 'send' && envelope.event === 'worker:event') {
          const event = envelope.data;
          if (event?.event === 'ERROR') result.errors.push(event.data?.message || 'worker error');
          if (event?.event === 'LOG') result.logs.push(...(event.data || []));
        }
      });
      worker.on('error', (error) => result.errors.push(`worker: ${error.message}`));
      worker.on('exit', (code) => {
        if (code !== 0) result.errors.push(`worker exited with code ${code}`);
        worker = undefined;
        complete(resolve, reject);
      });
      timer = setTimeout(() => {
        result.errors.push(`timed out after ${scenario.timeoutMs || 15_000}ms`);
        complete(resolve, reject);
      }, scenario.timeoutMs || 15_000);
    };
    // minecraft-protocol starts its net server during createServer(). Its
    // listening event may already have fired by the time this harness attaches
    // listeners, so inspect the socket on the next turn instead of racing it.
    setImmediate(() => {
      if (server.socketServer.address()) startWorker();
      else server.socketServer.once('listening', startWorker);
    });
  });
}

module.exports = { protocolVersion, runSemanticScenario };
