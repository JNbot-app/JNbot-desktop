/**
 * Movement & tick synchronization extension.
 *
 * Resolves modern anti-cheat flags (such as GrimAC on 1.21+) when moving:
 * 1. Emits `player_input` packets before physics movement whenever inputs change.
 * 2. Emits `tick_end` packets after each physics tick (including catch-up ticks).
 * 3. Keeps a 20Hz fallback `tick_end` active when physics is idle or terrain is loading.
 * 4. Never sends more ticks than real time allows. After a stall both the
 *    fallback and physics' catch-up would cover the missed ticks; that puts the
 *    bot ahead, and timer checks set it back (which also closes the open window).
 */

const TICK_MS = 50;
/** Vanilla runs at most 10 catch-up ticks per frame; older missed ticks are dropped. */
const MAX_BACKLOG = 10;

function realisticMotionExtension(bot) {
  const client = bot._client;
  if (!client) return;

  const sendsTickEnd = Boolean(bot.supportFeature?.('sendsClientTickEndPacket'));
  const hasPlayerInput = Boolean(bot.supportFeature?.('newPlayerInputPacket'));

  if (!sendsTickEnd && !hasPlayerInput) return;

  let lastTickEndTime = 0;
  let lastPhysicsTickTime = 0;
  let lastInputMask = null;
  let fallbackInterval = null;
  let clockStart = Date.now();
  let ticksSent = 0;

  /** Whether real time allows another tick. */
  function tickDue() {
    const due = Math.floor((Date.now() - clockStart) / TICK_MS);
    ticksSent = Math.max(ticksSent, due - MAX_BACKLOG);
    return ticksSent < due;
  }

  function getCurrentInputMask() {
    return {
      forward: Boolean(bot.getControlState?.('forward')),
      backward: Boolean(bot.getControlState?.('back')),
      left: Boolean(bot.getControlState?.('left')),
      right: Boolean(bot.getControlState?.('right')),
      jump: Boolean(bot.getControlState?.('jump')),
      shift: Boolean(bot.getControlState?.('sneak')),
      sprint: Boolean(bot.getControlState?.('sprint')),
    };
  }

  function inputsEqual(a, b) {
    if (!a || !b) return false;
    return (
      a.forward === b.forward &&
      a.backward === b.backward &&
      a.left === b.left &&
      a.right === b.right &&
      a.jump === b.jump &&
      a.shift === b.shift &&
      a.sprint === b.sprint
    );
  }

  function sendPlayerInputIfNeeded() {
    if (!hasPlayerInput || client.state !== 'play') return;
    const current = getCurrentInputMask();
    if (!inputsEqual(lastInputMask, current)) {
      lastInputMask = current;
      try {
        client.write('player_input', { inputs: current });
      } catch {}
    }
  }

  function sendTickEnd() {
    if (!sendsTickEnd || client.state !== 'play' || !tickDue()) return;
    ticksSent++;
    lastTickEndTime = Date.now();
    try {
      client.write('tick_end', {});
    } catch {}
  }

  bot.on('physicsTick', sendPlayerInputIfNeeded);
  bot.on('physicsTickEnd', () => {
    lastPhysicsTickTime = Date.now();
    sendTickEnd();
  });

  function startFallbackTickEnd() {
    if (fallbackInterval || !sendsTickEnd) return;
    fallbackInterval = setInterval(() => {
      const now = Date.now();
      if (client.state === 'play' && now - lastPhysicsTickTime >= 100 && now - lastTickEndTime >= 50) {
        sendPlayerInputIfNeeded();
        sendTickEnd();
      }
    }, 50);
  }

  client.on('login', () => {
    lastInputMask = null;
    lastTickEndTime = Date.now();
    lastPhysicsTickTime = lastTickEndTime;
    clockStart = lastTickEndTime;
    ticksSent = 0;
    startFallbackTickEnd();
  });

  client.on('start_configuration', () => {
    lastInputMask = null;
  });

  bot.on('end', () => {
    if (fallbackInterval) {
      clearInterval(fallbackInterval);
      fallbackInterval = null;
    }
    lastInputMask = null;
  });
}

module.exports = realisticMotionExtension;
