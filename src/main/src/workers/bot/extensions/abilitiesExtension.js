/**
 * Player abilities (1.8 – 26.x).
 *
 * Mineflayer ignores the clientbound `abilities` packet, so the bot keeps
 * falling when the server makes it fly. Vanilla stops applying gravity while
 * flying and turns flying off (telling the server) once it touches the ground.
 * Anti-bot checks (e.g. "Verifying your Minecraft client...") rely on this:
 * they set flying with a fly speed of 0 and expect the client to hover.
 */
const FLYING = 0x02;

function abilitiesPlugin(bot) {
  let flags = 0;
  let flyingSpeed = 0.05;
  let walkingSpeed = 0.1;
  let normalGravity;

  function setFlying(flying) {
    if (flying === (normalGravity !== undefined)) return;
    if (flying) {
      normalGravity = bot.physics.gravity;
      bot.physics.gravity = 0;
    } else {
      bot.physics.gravity = normalGravity;
      normalGravity = undefined;
    }
  }

  bot._client.on('abilities', (packet) => {
    ({ flags, flyingSpeed, walkingSpeed } = packet);
    setFlying((flags & FLYING) !== 0);
  });

  bot.on('physicsTick', () => {
    if (
      normalGravity === undefined ||
      !bot.entity.onGround ||
      bot.game?.gameMode === 'spectator'
    )
      return;
    flags &= ~FLYING;
    setFlying(false);
    bot._client.write('abilities', { flags, flyingSpeed, walkingSpeed });
  });
}

module.exports = abilitiesPlugin;
