/**
 * Player abilities (1.8 – 26.x).
 *
 * Mineflayer ignores the clientbound `abilities` packet. This keeps the
 * abilities on the bot entity (`flying`, `mayFly`, `flyingSpeed`) for the
 * physics, which simulates creative flight like vanilla: double tapping jump
 * toggles it, jump and sneak move up and down, landing ends it. Whenever the
 * physics changes `flying`, the server is told, like the vanilla client does.
 * Anti-bot checks (e.g. "Verifying your Minecraft client...") rely on this:
 * they set flying with a fly speed of 0 and expect the client to hover.
 */
const FLYING = 0x02;
const MAY_FLY = 0x04;

function abilitiesPlugin(bot) {
  let flags = 0;
  let flyingSpeed = 0.05;
  let walkingSpeed = 0.1;
  const onlyFlyingBit = bot.registry.version['>=']('1.16');

  bot._client.on('abilities', (packet) => {
    ({ flags, flyingSpeed, walkingSpeed } = packet);
    if (!bot.entity) return;
    bot.entity.flying = (flags & FLYING) !== 0;
    bot.entity.mayFly = (flags & MAY_FLY) !== 0;
    bot.entity.flyingSpeed = flyingSpeed;
  });

  // Runs before the tick's player_input (realisticMotionExtension), like vanilla's aiStep.
  bot.on('physicsTick', () => {
    const flying = Boolean(bot.entity.flying);
    if (flying === ((flags & FLYING) !== 0)) return;
    flags = flying ? flags | FLYING : flags & ~FLYING;
    // Since 1.16 the client only reports the flying bit.
    const sent = onlyFlyingBit ? flags & FLYING : flags;
    bot._client.write('abilities', { flags: sent, flyingSpeed, walkingSpeed });
  });
}

module.exports = abilitiesPlugin;
