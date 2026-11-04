/** Bot imports */
const mineflayer = require('mineflayer');
const usserPlugin = require('./usserPlugin.js');
const botActions = require('./botActions');
const botProxy = require('./botProxy');
const assert = require('assert');
const addPathFinder = require('./pathFinderPlugin');
const transferItems = require('./itemTransferV2');
const { workerData } = require('worker_threads');
const { parseRawNbt } = require('./extensions/nbtParser');
const botController = require('../lib/botController').default;
const workerScript = require('../lib/workerScript').default;
const { BotMessenger } = require('../lib/BotMessenger');
const { createBotExtension } = require('./extensions/botExtension.js');
const {
  parseProxy,
  createConnect,
  describeProxy,
} = require('./proxyConnect.js');
const resourceFixPlugin = require('./extensions/resourceFixExtension.js');
const installProxyKeepAlive = require('./proxyKeepAlive.js');
const {
  applyChunkRenderDistanceFilter,
} = require('./extensions/chunkFilterExtension.js');
const realisticMotionExtension = require('./extensions/realisticMotionExtension.js');
const mouseExtension = require('./extensions/mouseExtension.js');
const abilitiesExtension = require('./extensions/abilitiesExtension.js');
const packetThreadExtension = require('./extensions/packetThreadExtension.js');

/** Built-in plugins applied to every bot. Built once so we don't recreate it
 *  on every join. The profile's bot extension is appended LAST at join time
 *  (see `loadPlugins` below) so it can see / override everything the built-in
 *  plugins installed.
 */
const BOT_PLUGINS = [packetThreadExtension, usserPlugin, botActions, botProxy, transferItems, mouseExtension, abilitiesExtension, realisticMotionExtension];

function nextBotId() {
  if (!workerData?.sharedArray) return 1;
  for (let attempt = 0; attempt < 8191; attempt++) {
    const raw = Atomics.add(workerData.sharedArray, 0, 1);
    const id = (raw % 8191) + 1;
    if (!botController.bots[id]) {
      return id;
    }
  }
  const raw = Atomics.add(workerData.sharedArray, 0, 1);
  return (raw % 8191) + 1;
}
/**
 *
 * @param {*} options
 * @param {{stopOnEnd?: boolean, gamemode?: string, joinGamemode?: boolean, login?: boolean, retryOnLoginFail?: boolean, onKick?: function, onEnd?: function, joinServerTimeout?: number, verbose?: boolean, requiresConfirmation?: boolean, signal?: AbortSignal}} scriptOptions
 * @return {Promise<Bot>} bot instance if join was successful, null if not
 * @returns
 */
async function joinServer(options = {}, scriptOptions = {}) {
  let {
    stopOnEnd = false,
    gamemode = null,
    joinGamemode = true,
    login = false,
    verbose = false,
    retryOnLoginFail = global.appSettings.retryOnLoginFail ?? true, // Rejoin when bot doesn't receive login packet (else you get kicked for 'ReadTimeoutException : null')
    onKick = null,
    onEnd = null,
    joinServerTimeout = global.appSettings.joinServerTimeout || 10_000,
    requiresConfirmation = false, // Waits until the server sends a confirmation transaction back after clicking on a slot
    resolveOnSpawn = true,
    signal = null, // AbortSignal: cancels an in-flight join (e.g. skip during the join-delay queue)
    chunkLoadLimit = null, // If enabled, the bot will discard any chunks 

    // proxy: {  url: "http://username:password@ip:port" }
  } = scriptOptions;

  assert('username' in options, 'username is required');

  const opt = {
    version: global.appSettings?.version || '1.8.9',
    checkTimeoutInterval: global.appSettings?.checkTimeoutInterval || 30000,
    hideErrors: !verbose,
    ...options,
    host: options.host,
  };

  // Set microsoft auth function
  if (!opt.onMsaCode) {
    opt.onMsaCode = (c) => onMicrosoftAuth(c, opt.username);
  }

  // Find the profile-specific alt data and check if the account is premium.
  let sharedAltData = global.sharedSettings?.alts?.find(
    (a) => a.username === opt.username,
  );
  const altData = sharedAltData
    ? workerData.settings?.altData?.[sharedAltData.username]
    : undefined;

  if (altData?.premium && opt.auth !== 'mojang') {
    opt.auth = 'microsoft';

    // Share one prismarine-auth token cache with the Minecraft launcher.
    // The cache key is `opt.username` (the in-game name) and the folder is the
    // app-wide auth dir — both must match what MinecraftAccountService uses so
    // a login done in either place is reused by the other. We intentionally do
    // NOT override opt.username with the email: prismarine-auth's device-code
    // flow doesn't need it, and using the IGN keeps the cache key consistent.
    if (workerData?.paths?.minecraftAuth) {
      opt.profilesFolder = workerData.paths.minecraftAuth;
    }
  } else {
    if (opt.password) delete opt.password;
    if (opt.premiumPassword) delete opt.premiumPassword;
  }

  // // Change minecraft version depending on gamemode
  // if ((global.appSettings.auto_version ?? true) && gamemode) {
  //   let version = null;
  //   switch (gamemode.toLowerCase()) {
  //     case 'sbf':
  //     case 'skyblockfantasy':
  //       version = '1.17.1';
  //       break;
  //     case 'survival':
  //     case 'spawnworld':
  //     case 'lifesteal':
  //       version = '1.19.3';
  //       break;
  //   }
  //   if (version) {
  //     const v = Number(opt.version.split('.')[1]);
  //     if (v <= parseInt(version.split('.')[1])) {
  //       debug('Changing minecraft version to ' + version);
  //       opt.version = version;
  //     }
  //   }
  // }

  let result = { bot: null, retry: true };
  const username = sharedAltData?.username ?? opt.username;

  const botId = nextBotId();
  await workerScript.sendAsync('BOT_JOINED', {
    botId,
    username,
    version: opt.version ?? '1.8.9',
    host: opt.host,
    port: opt.port,
    uid: sharedAltData?.uid,
    status: 'queued',
    paused: false,
  });

  while (result.retry) {
    // Skipped / aborted before (or between) attempts: drop the placeholder bot
    // from the UI and stop — no point waiting in the join queue for it.
    if (signal?.aborted) {
      send('BOT_LEFT', {
        username,
        botId,
        reason: 'skipped',
        kicked: false,
        send: false,
      });
      return null;
    }

    if (result.bot) {
      // Properly cleanup old bot instance to prevent memory leaks
      botController.unregisterBot(result.bot.botId);
      result.bot._client?.removeAllListeners?.();
      result.bot.removeAllListeners?.();
      result.bot.end?.();
      result.bot = null;
    }

    let joinResponse;
    try {
      joinResponse = await botController.requestForBotJoin(
        botId,
        signal,
        !!options.proxy?.url,
        opt.auth === 'microsoft',
      );
    } catch (error) {
      const message = error instanceof Error ? (error.stack || error.message) : String(error);
      global.log(
        `[${username}] failed to request a server join: ${message}`,
        'error',
      );
      send('BOT_STATUS_UPDATE', { botId, status: 'failed' });
      return null;
    }
    if (!joinResponse || joinResponse.cancelled || signal?.aborted) {
      // The user skipped this alt while it waited in the join-delay queue.
      send('BOT_LEFT', {
        username,
        botId,
        reason: 'skipped',
        kicked: false,
        send: false,
      });
      return null;
    }
    if (!joinResponse.granted) {
      global.log(
        joinResponse.error ||
          `Bot join request for [${username}] was denied by the main process`,
        'error',
      );
      send('BOT_STATUS_UPDATE', { botId, status: 'failed' });
      return null;
    }

    if (joinResponse.viaProxy) {
      // The JNbot proxy is running: force this bot through it (localhost,
      // offline auth — the proxy authenticates to the real server itself and
      // forwards to the configured upstream). Overrides any explicit host so
      // routing is unconditional while the proxy is active.
      opt.host = joinResponse.host;
      opt.port = joinResponse.port;
      opt.__proxyControlToken = joinResponse.proxyControlToken;
      if (!joinResponse.onlineMode) opt.auth = 'offline';
      opt.__viaProxy = true;
      // ProxySession owns upstream liveness. Disable minecraft-protocol's
      // combined responder/watchdog and install a responder without a timeout.
      opt.keepAlive = false;
      if (!joinResponse.onlineMode) {
        delete opt.profilesFolder;
        delete opt.password;
      }
    } else {
      if (!options.host) {
        opt.host = joinResponse.host;
      }

      if (!options.port) {
        opt.port = joinResponse.port;
      }
      if (joinResponse.proxyUrl) {
        opt.proxy = {
          enabled: true,
          url: joinResponse.proxyUrl,
          assigned: true,
        };
      }
    }

    // Plugins may own a Minecraft proxy without starting the built-in proxy
    // script. Marking the route explicitly enables the proxy keepalive model.
    const proxyTakeover = options.minecraftProxy?.takeover === true;
    if (options.minecraftProxy) {
      opt.host = options.minecraftProxy.host ?? '127.0.0.1';
      opt.port = Number(options.minecraftProxy.port ?? 25565);
      opt.__viaProxy = true;
      opt.keepAlive = false;
      if (options.minecraftProxy.onlineMode !== true) {
        opt.auth = 'offline';
        delete opt.profilesFolder;
        delete opt.password;
      }
    }
    if (opt.host) {
      opt.host = opt.host.trim()
    }

    if (
      !workerData?.scriptOptions?.ips?.includes(opt.host) &&
      opt.host !== '0.0.0.0' && opt.host !== "127.0.0.1" &&
      workerData?.scriptOptions?.ips?.length > 0
    ) {
      global.log(
        `You are trying to join an unsupported IP (${opt.host})! The IP may not work, please change the ip to one of the following ips: ${workerData?.scriptOptions?.ips.join(',\n')}`,
        'warning',
      );
    }
    result = await joinWithBot(
      opt,
      {...sharedAltData, data: altData},
      {
        joinGamemode: proxyTakeover ? false : joinGamemode,
        login: proxyTakeover ? false : login,
        gamemode: proxyTakeover ? null : gamemode,
        onKick,
        onEnd,
        stopOnEnd,
        retryOnLoginFail,
        joinServerTimeout,
        verbose,
        requiresConfirmation,
        resolveOnSpawn: proxyTakeover ? false : resolveOnSpawn,
        chunkLoadLimit,
      },
      botId,
    );
    if (result.failed) {
      send('BOT_STATUS_UPDATE', {
        botId: botId,
        status: 'failed',
      });
    }
  }
  return result.bot;
}

/**
 *
 * @returns {Promise<{bot?:Bot, retry:boolean, failed: boolean, joinOptions:{}}>}
 */
function joinWithBot(botOptions, alt, joinOptions, botId) {
  return new Promise((resolve) => {
    // 0 -> connecting
    // 1 -> online
    // 2 -> disconnected
    let status = 0;
    let settled = false;
    let timeoutdelay;
    let bot;

    function finish(result) {
      if (settled) return;
      settled = true;
      resolve(result);
    }

    function errorMessage(error) {
      if (error instanceof Error) {
        return error.stack || error.message;
      }
      return String(error);
    }

    function failSetup(error) {
      if (status === 2) return;
      status = 2;
      clearTimeout(timeoutdelay);

      const message = errorMessage(error);
      try {
        botController.unregisterBot(bot);
        bot?._client?.removeAllListeners?.();
        bot?.removeAllListeners?.();
        bot?.end?.();
      } catch (cleanupError) {
        global.log(
          `[${botOptions.username}] failed to clean up a join: ${errorMessage(cleanupError)}`,
          'error',
        );
      }

      global.log(
        `[${botOptions.username}] failed while starting the join: ${message}`,
        'error',
      );
      finish({
        bot: null,
        retry: false,
        failed: true,
        message,
      });
    }

    try {
      applyProxyToBotOptions(botOptions);

      botOptions.plugins = botOptions.plugins || {};
      botOptions.plugins.resource_pack = resourceFixPlugin;

      const isMobile = Boolean(
        global.isMobileRuntime ||
          workerData?.isMobileRuntime ||
          workerData?.scriptOptions?.isMobileRuntime,
      );

      const renderDistance =
        joinOptions.chunkLoadLimit ??
        global.appSettings?.render_distance ??
        (isMobile ? 2 : 12);
      botOptions.viewDistance = renderDistance;
      const reducedEvents =
        global.appSettings?.reduced_events ?? isMobile;
      if (reducedEvents) {
        botOptions.plugins.particle = false;
        botOptions.plugins.sound = false;
        botOptions.plugins.explosion = false;
      }

      if (typeof botOptions.username !== 'string') {
        throw new Error('Username must be a string');
      }

      if (typeof botOptions.port === 'string') {
        botOptions.port = parseInt(botOptions.port);
      }
      bot = mineflayer.createBot(botOptions);
      if (botOptions.__viaProxy) installProxyKeepAlive(bot._client);
      if (typeof joinOptions.chunkLoadLimit === 'number' && joinOptions.chunkLoadLimit > 0) {
        applyChunkRenderDistanceFilter(bot, joinOptions.chunkLoadLimit);
      }
      if (reducedEvents) {
        bot._client?.removeAllListeners?.('update_light');
      }
      bot.setMaxListeners?.(1000);
      bot._client?.setMaxListeners?.(1000);
      bot.alt = alt;
      bot.botId = botId;
      bot.proxyControlToken = botOptions.__proxyControlToken;
      bot.messenger = new BotMessenger(
        workerData.messaging.profileId,
        workerData.messaging.scriptId,
        bot,
      );

      // Dev-only inbound packet parse-failure tracer. Loaded as early as possible
      // (right after createBot, before the socket connects) so it also covers the
      // login state. Opt-in: verbose run, the `debugPackets` app setting, or the
      // NMP_PACKET_DEBUG env var. See extensions/packetDebugger.js.
      // if (
      //   joinOptions.verbose ||
      //   global.appSettings.debugPackets === true ||
      //   process.env.NMP_PACKET_DEBUG === '1'
      // ) {
      //   try {
      //     injectPacketDebugger(bot);
      //   } catch (e) {
      //     global.log('Could not install packetDebugger: ' + e.message, 'warning');
      //   }
      // }

      function startTimeout() {
        if (!joinOptions.joinServerTimeout || status !== 0) return;
        clearTimeout(timeoutdelay);
        timeoutdelay = setTimeout(() => {
          if (status === 0) {
            global.log(
              'join timeout, bot took too long to join (if you get this too often, increase join server timeout)',
              'warning',
            );
            stopBot();
          }
        }, joinOptions.joinServerTimeout);
      }

      if (joinOptions.joinServerTimeout) {
        if (botOptions.auth === 'microsoft' && !bot._client?.session) {
          bot._client?.once('session', startTimeout);
        } else {
          startTimeout();
        }
        bot.once('connect', startTimeout);
      }

      bot.once('kicked', (reason) => {
        (async () => {
          try {
            let formattedReason = formatKick(reason);
            const rawReason =
              typeof reason === 'object' ? JSON.stringify(reason) : reason;
            if (typeof formattedReason === 'object') {
              formattedReason = JSON.stringify(formattedReason);
            }
            formattedReason = String(
              formattedReason ?? rawReason ?? 'unknown reason',
            );

            global.log(
              `[${botOptions.username}] kicked: ${rawReason}`,
              'warning',
            );
            if (formattedReason.includes('https://v4g.to')) {
              const url = formattedReason.match(
                /https:\/\/v4g\.to\/[a-zA-Z0-9]+/,
              )?.[0];
              if (url && global.appSettings.auto_v4guard === false) {
                global.log(
                  `V4Guard detected, but auto_v4guard is disabled. URL: ${url}`,
                  'error',
                );

                await sleep(5_000);
              } else if (url) {
                global.log(
                  `V4Guard detected, sending challenge to user: ${url}`,
                  'error',
                );

                send(
                  'V4GUARD_VERIFY',
                  { url, username: botOptions.username },
                  false,
                );
              }

              global.log(
                'Getting v4guard too often? Increase bot join delay in settings (script > bot delay). You can set it to 30000.',
                'info',
              );
            }
            stopBot(formattedReason);
            if (typeof joinOptions.onKick === 'function')
              joinOptions.onKick(formattedReason, {
                username: botOptions.username,
                botId,
              });
          } catch (error) {
            const message = errorMessage(error);
            global.log(
              `[${botOptions.username}] failed while handling a kick: ${message}`,
              'error',
            );
            stopBot(message);
          }
        })();
      });

      bot.on('end', () => {
        botController.unregisterBot(bot);

        setTimeout(() => {
          // global.log(`[${botOptions.username}]: bot ended ${e? ("("+e+")"):""}`)
          stopBot();

          if (typeof joinOptions.onEnd === 'function') joinOptions.onEnd();
        }, 10);
      });

      bot.once('spawn', () => {
        (async () => {
          try {
            clearTimeout(timeoutdelay);
            status = 1;
            bot.inventory.requiresConfirmation =
              joinOptions.requiresConfirmation;
            bot.on(
              'windowOpen',
              (win) =>
                (win.requiresConfirmation = joinOptions.requiresConfirmation),
            );

            botController.registerBot(bot);

            send('BOT_STATUS_UPDATE', {
              botId,
              status: 'connected',
            });
            if (joinOptions.login) {
              await bot.__login?.();

              await bot.waitForTicks(3);
            }

            if (joinOptions.joinGamemode && joinOptions.gamemode) {
              await bot.join(joinOptions.gamemode);
            }
            success();
          } catch (error) {
            const message = errorMessage(error);
            global.log(
              `[${botOptions.username}] failed after joining: ${message}`,
              'error',
            );
            stopBot(message);
          }
        })();
      });

      const profileBotExtension = createBotExtension(workerData?.botExtension);

      bot.once('inject_allowed', () => {
        bot.loadPlugins(
          profileBotExtension
            ? [...BOT_PLUGINS, profileBotExtension]
            : BOT_PLUGINS,
        );

        addPathFinder(bot);
        // botActions is installed during inject_allowed, so forward the
        // completed readiness point after every built-in plugin can observe it.
        bot.emit('jnbot:inject_allowed');
      });

      if (global.appSettings.autoResourcePackAccept !== false) {
        bot.on('resourcePack', () => {
          bot.acceptResourcePack?.();
        });
      }

      bot._client.once('microsoft-login', (c) =>
        onMicrosoftAuth(c, botOptions.username),
      );

      bot.on('error', (err) => {
        global.log(
          `[${botOptions.username} error]: ${err?.stack || err?.toString()}`,
          'error',
        );
        if (status === 0) {
          stopBot(err?.message || String(err));
        }
      });

      function success() {
        clearTimeout(timeoutdelay);
        finish({
          bot,
          retry: false,
          failed: false,
        });

        global.send('ADD_ACTIVITY', {
          username: botOptions.username,
          server: botOptions.host,
        });
      }

      function stopBot(kickreason) {
        if (status === 2) return; // already stopped
        const wasConnecting = status === 0;
        status = 2;
        botController.unregisterBot(bot);
        clearTimeout(timeoutdelay);

        bot?.end?.();
        bot?._client?.socket?.destroy?.();

        send('BOT_LEFT', {
          username: botOptions.username,
          botId,
          reason: kickreason || 'unknown reason',
          kicked: !!kickreason,
          send: true,
        });

        if (joinOptions.stopOnEnd) {
          global.log(
            `[${botOptions.username}]` +
              ` ending script because ${botOptions.username} left the server`,
            'success',
          );
          setTimeout(() => {
            process.exit(0);
          }, 250);
          return;
        }

        if (wasConnecting) {
          // disconnected during connecting
          global.log(
            `[${botOptions.username}] bot disconnected during connecting. (${kickreason})  ${
              joinOptions.retryOnLoginFail
                ? 'Retrying...'
                : 'not retrying because retry on login fail is set to false'
            }`,
            'error',
          );
          finish({
            bot: null,
            retry: joinOptions.retryOnLoginFail,
            failed: true,
            message: kickreason,
          });
        } else {
          finish({
            bot: null,
            retry: false,
            failed: false,
            message: kickreason,
          });
        }
      }

      if (
        !joinOptions.login &&
        !joinOptions.gamemode &&
        !joinOptions.resolveOnSpawn
      ) {
        success();
      }
    } catch (error) {
      failSetup(error);
    }
  });
}

function onMicrosoftAuth(auth, username) {
  // Required to authenticate with a Microsoft account. mineflayer uses the
  // prismarine-auth `live` flow, so `auth` carries the device-code response
  // (snake_case fields). Emit the same unified event the launcher uses so the
  // single app-wide login modal handles both paths.
  if (!auth) return;
  global.sendToClients('MC_MICROSOFT_DEVICE_CODE', {
    message: auth.message,
    userCode: auth.user_code ?? auth.userCode,
    verificationUri: auth.verification_uri ?? auth.verificationUri,
    expiresIn: auth.expires_in ?? auth.expiresIn,
    username,
  });
}

function formatKick(msg) {
  return parseRawNbt(msg);
}

function applyProxyToBotOptions(botOptions) {
  // Routing through the local JNbot proxy is a direct localhost TCP connection;
  // never tunnel that through a SOCKS proxy.
  if (botOptions?.__viaProxy) return;

  const cfg = botOptions?.proxy || global.appSettings?.proxy;

  if (botOptions?.proxy?.url) {
    cfg.enabled = true;
  }
  if (!cfg || !cfg.enabled || !cfg.url) return;
  const proxy = parseProxy(cfg.url);
  if (!proxy) {
    global.log('Invalid proxy URL. Connection attempt aborted.', 'warning');
    throw new Error('Invalid proxy URL');
  }
  const target = { host: botOptions.host, port: botOptions.port || 25565 };
  botOptions.connect = createConnect(proxy, target);
  global.log(
    `Routing ${botOptions.username} through proxy ${describeProxy(proxy)}`,
    'info',
  );
}

function sleep(x) {
  return new Promise((resolve) => setTimeout(() => resolve(true), x));
}

module.exports = joinServer;
