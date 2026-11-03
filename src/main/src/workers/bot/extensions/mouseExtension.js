/**
 * Mouse button emulation (1.8 – 26.x).
 *
 * Mirrors the vanilla client tick (Minecraft#handleKeybinds + MultiPlayerGameMode):
 * - left:  attacks the entity under the crosshair, mines the targeted block
 *          (holding keeps mining and moves on to the next block after 5 ticks),
 *          or swings at air (10 tick miss cooldown in survival).
 * - right: interacts with the targeted entity/block, places the held block or
 *          uses the held item (eat, draw a bow, raise a shield, ...) with the
 *          main hand, then the off hand. Holding repeats every 4 ticks and
 *          releasing stops using the item.
 *
 * API:
 *   bot.mouse.click('left' | 'right')    press for a single tick
 *   bot.mouse.press('left' | 'right')    hold down until released
 *   bot.mouse.release('left' | 'right')
 *   bot.mouse.isDown('left' | 'right')
 */
const { Vec3 } = require('vec3');
const { RaycastIterator } = require('prismarine-world').iterators;

const MAIN_HAND = 0;
const OFF_HAND = 1;
const MISS_DELAY = 10;
const USE_DELAY = 4;
const DESTROY_DELAY = 5;
const FINISHED_USING_ITEM = 9; // entity_status
const DIG = { START: 0, ABORT: 1, STOP: 2 };
const DOWN = 0;
const FULL_CUBE = [[0, 0, 0, 1, 1, 1]];
// Outlines of flat blocks without a collision box; they must not hide what stands on them (minecart on a rail).
const RAIL_OUTLINE = [[0, 0, 0, 1, 2 / 16, 1]];
const FLAT_OUTLINE = [[0, 0, 0, 1, 1 / 16, 1]];
const FLAT_BLOCK = /^(redstone_wire|tripwire)$|pressure_plate$/;

// Blocks without an outline the crosshair can stop on.
const UNTARGETABLE_BLOCKS = new Set([
  'air',
  'cave_air',
  'void_air',
  'water',
  'flowing_water',
  'lava',
  'flowing_lava',
  'bubble_column',
  'light',
  'structure_void',
  'moving_piston',
  'piston_extension',
]);
// Entities that are not pickable (the crosshair goes through them). 1.8 uses CamelCase names.
const UNPICKABLE_ENTITY =
  /^(item|xp_orb|experience_orb|(spectral_)?arrow|trident|snowball|(thrown)?egg|(thrown)?ender_?pearl|eye_?of_?ender(_?signal)?|(thrown|splash_|lingering_)?potion|(thrown)?(xp|exp|experience)_?bottle|fireworks?_?rocket(entity)?|fishing.*|area_effect_cloud|marker|lightning_bolt|llama_spit|evo\w*_fangs|\w+_display|ominous_item_spawner|(breeze_)?wind_charge)$/i;
// Blocks that react to right click on their own (open a screen, toggle, ...).
const INTERACTIVE_BLOCK =
  /chest|barrel|shulker_box|furnace|smoker|crafting_table|workbench|crafter|enchant|anvil|brewing_stand|hopper|dispenser|dropper|beacon|^(?!iron_)\w*door$|fence_gate|lever|button|repeater|comparator|note_?block|(^|_)bed$|loom|cartography_table|grindstone|stonecutter|smithing_table|bell|daylight_detector|dragon_egg|command_block|structure_block|jigsaw/;
const INTERACTIVE_ENTITY =
  /^(villager|wandering_trader|\w*horse|donkey|mule|\w*llama|camel|\w*boat|\w*raft|\w*minecart\w*|(glow_)?item_?frame|armor_?stand|allay)$/i;
const ENTITY_ITEM = /^(name_tag|lead|saddle|shears)$/;
// Items that are used on the clicked block (placing it or something else).
const USED_ON_BLOCK_ITEM =
  /seeds$|^redstone$|^string$|sign$|^repeater$|^comparator$|^reeds$|^skull$|banner$|^flower_pot$|flint_and_steel|fire_charge|spawn_egg|minecart|armor_stand|item_frame|painting|end_crystal|firework|bone_meal/;
// Items that keep being used while the button is held.
const HELD_USE_ITEM =
  /^(trident|shield|spyglass|goat_horn|milk_bucket|honey_bottle|ominous_bottle|potion|brush)$/;
const INSTANT_USE_ITEM =
  /^(snowball|egg|ender_pearl|ender_eye|eye_of_ender|experience_bottle|splash_potion|lingering_potion|fishing_rod|wind_charge|written_book|writable_book|elytra)$|_(helmet|chestplate|leggings|boots)$/;
const ALWAYS_EDIBLE = /golden_apple|chorus_fruit|suspicious_stew/;
// Items that can't break blocks in creative.
const CREATIVE_NO_BREAK = /_sword$|^trident$|^mace$|^debug_stick$/;

function mouseExtension(bot) {
  const Item = require('prismarine-item')(bot.registry);
  const legacy = bot.supportFeature('armAnimationBeforeUse'); // 1.8: swing before acting, no off hand
  const hands = legacy ? [MAIN_HAND] : [MAIN_HAND, OFF_HAND];
  const pickInflate = bot.registry.version['<']('1.9') ? 0.1 : 0;
  const cursorScale = bot.supportFeature('blockPlaceHasIntCursor') ? 16 : 1;

  const down = { left: false, right: false };
  const clicks = { left: 0, right: 0 };
  const releaseAfterTick = { left: false, right: false };
  let missTime = 0;
  let rightClickDelay = 0;
  let destroyDelay = 0;
  let destroying = null; // { pos, itemType, progress }
  let using = null; // { hand, itemType }

  const mode = () => bot.game.gameMode;
  const itemInHand = (hand) =>
    (hand === MAIN_HAND ? bot.heldItem : bot.inventory.slots[45]) ?? null;
  const swing = (hand = MAIN_HAND) =>
    bot.swingArm(hand === OFF_HAND ? 'left' : 'right');

  // ---- Packets ----------------------------------------------------------

  function sendDig(status, location, face, predicted = false) {
    bot._client.write('block_dig', {
      status,
      location,
      face,
      sequence: predicted ? bot._nextSequence() : 0,
    });
  }

  function sendUseItemOn({ block, face, point, inside }, hand) {
    const cursor = point.minus(block.position).scaled(cursorScale);
    const intCursor = cursorScale !== 1;
    bot._client.write('block_place', {
      location: block.position,
      direction: face,
      hand,
      heldItem: Item.toNotch(itemInHand(hand)),
      cursorX: intCursor ? Math.floor(cursor.x) : cursor.x,
      cursorY: intCursor ? Math.floor(cursor.y) : cursor.y,
      cursorZ: intCursor ? Math.floor(cursor.z) : cursor.z,
      insideBlock: inside,
      worldBorderHit: false,
      sequence: bot._nextSequence(),
    });
  }

  function sendInteract({ entity, point }, hand, at) {
    const rel = point.minus(entity.position);
    bot._client.write('use_entity', {
      target: entity.id,
      mouse: at ? 2 : 0,
      x: rel.x,
      y: rel.y,
      z: rel.z,
      location: rel,
      hand,
      sneaking: bot.getControlState('sneak'),
    });
  }

  // ---- Crosshair --------------------------------------------------------

  function rayBoxDistance(origin, dir, min, max) {
    let tMin = -Infinity;
    let tMax = Infinity;
    for (const axis of ['x', 'y', 'z']) {
      if (dir[axis] === 0) {
        if (origin[axis] < min[axis] || origin[axis] > max[axis]) return null;
        continue;
      }
      const t1 = (min[axis] - origin[axis]) / dir[axis];
      const t2 = (max[axis] - origin[axis]) / dir[axis];
      tMin = Math.max(tMin, Math.min(t1, t2));
      tMax = Math.min(tMax, Math.max(t1, t2));
    }
    return tMax >= Math.max(tMin, 0) ? Math.max(tMin, 0) : null;
  }

  function outline(block) {
    if (block.shapes.length) return block.shapes;
    if (block.name.endsWith('rail')) return RAIL_OUTLINE;
    return FLAT_BLOCK.test(block.name) ? FLAT_OUTLINE : FULL_CUBE;
  }

  function pickBlock(eye, dir, range) {
    const iter = new RaycastIterator(eye, dir, range);
    const eyeBlock = eye.floored();
    for (let pos = eyeBlock; pos; pos = iter.next()) {
      const block = bot.blockAt(new Vec3(pos.x, pos.y, pos.z), false);
      if (!block || UNTARGETABLE_BLOCKS.has(block.name)) continue;
      const hit = iter.intersect(outline(block), block.position);
      if (hit) {
        return {
          block,
          face: hit.face,
          point: hit.pos,
          inside: block.position.equals(eyeBlock),
        };
      }
    }
    return null;
  }

  function pickEntity(eye, dir, range) {
    let best = null;
    for (const entity of Object.values(bot.entities)) {
      if (
        entity === bot.entity ||
        entity === bot.vehicle ||
        !entity.height ||
        UNPICKABLE_ENTITY.test(entity.name ?? '')
      )
        continue;
      if (
        entity.position.distanceSquared(eye) >
        (range + entity.width + entity.height) ** 2
      )
        continue;
      const w = entity.width / 2 + pickInflate;
      const min = entity.position.offset(-w, -pickInflate, -w);
      const max = entity.position.offset(w, entity.height + pickInflate, w);
      const distance = rayBoxDistance(eye, dir, min, max);
      if (
        distance !== null &&
        distance <= range &&
        (!best || distance < best.distance)
      ) {
        best = { entity, distance, point: eye.plus(dir.scaled(distance)) };
      }
    }
    return best;
  }

  /** Vanilla GameRenderer#pick: the closest of block/entity, then filtered by its own reach. */
  function pick() {
    const creative = mode() === 'creative';
    const blockRange = creative ? 5 : 4.5;
    const entityRange = creative ? 5 : 3;
    const { position, yaw, pitch, eyeHeight } = bot.entity;
    const eye = position.offset(0, eyeHeight, 0);
    const dir = new Vec3(
      -Math.sin(yaw) * Math.cos(pitch),
      Math.sin(pitch),
      -Math.cos(yaw) * Math.cos(pitch),
    );

    const block = pickBlock(eye, dir, Math.max(blockRange, entityRange));
    const blockDistance = block
      ? eye.distanceTo(block.point)
      : Math.max(blockRange, entityRange);
    const entity = pickEntity(eye, dir, blockDistance);
    if (entity) return entity.distance <= entityRange ? entity : null;
    return block && blockDistance <= blockRange ? block : null;
  }

  // ---- Left click (MultiPlayerGameMode destroy logic) -------------------

  function destroyProgress(block) {
    const ms = bot.digTime(block);
    return ms === 0 ? 1 : 50 / ms;
  }

  function destroyLocally(pos) {
    if (
      mode() === 'creative' &&
      CREATIVE_NO_BREAK.test(bot.heldItem?.name ?? '')
    )
      return;
    bot._updateBlockState(pos, 0);
  }

  function startDestroyBlock({ block, face }) {
    if (mode() === 'adventure' || mode() === 'spectator') return false;
    const pos = block.position;
    if (mode() === 'creative') {
      sendDig(DIG.START, pos, face, true);
      destroyLocally(pos);
      destroyDelay = DESTROY_DELAY;
      return true;
    }
    if (isDestroying(pos)) return true;
    if (destroying) sendDig(DIG.ABORT, destroying.pos, face);
    sendDig(DIG.START, pos, face, true);
    if (destroyProgress(block) >= 1) {
      destroying = null;
      destroyLocally(pos);
    } else {
      destroying = { pos, itemType: bot.heldItem?.type, progress: 0 };
    }
    return true;
  }

  function continueDestroyBlock(hit) {
    if (destroyDelay > 0) {
      destroyDelay--;
      return true;
    }
    if (mode() === 'creative') return startDestroyBlock(hit);
    if (!isDestroying(hit.block.position)) return startDestroyBlock(hit);

    destroying.progress += destroyProgress(hit.block);
    if (destroying.progress >= 1 - 1e-9) {
      sendDig(DIG.STOP, destroying.pos, hit.face, true);
      destroyLocally(destroying.pos);
      destroying = null;
      destroyDelay = DESTROY_DELAY;
    }
    return true;
  }

  function stopDestroyBlock() {
    if (!destroying) return;
    sendDig(DIG.ABORT, destroying.pos, DOWN);
    destroying = null;
  }

  function isDestroying(pos) {
    return (
      destroying?.pos.equals(pos) && destroying.itemType === bot.heldItem?.type
    );
  }

  /** @returns true when the targeted block broke instantly */
  function startAttack(hit) {
    if (missTime > 0) return false;
    if (legacy) swing();
    if (hit?.entity) bot.attack(hit.entity, false);
    else if (hit?.block) startDestroyBlock(hit);
    else if (mode() !== 'creative') missTime = MISS_DELAY;
    if (!legacy) swing();
    return (
      Boolean(hit?.block) &&
      UNTARGETABLE_BLOCKS.has(bot.blockAt(hit.block.position, false)?.name)
    );
  }

  function continueAttack(held, hit) {
    if (!held) missTime = 0;
    if (missTime > 0 || using) return;
    if (held && hit?.block) {
      if (continueDestroyBlock(hit)) swing();
    } else {
      stopDestroyBlock();
    }
  }

  // ---- Right click (Minecraft#startUseItem) -----------------------------

  function interactsWithBlock(block) {
    const sneakBypass =
      bot.getControlState('sneak') && hands.some((hand) => itemInHand(hand));
    return !sneakBypass && INTERACTIVE_BLOCK.test(block.name);
  }

  function placesOnBlock(item) {
    if (!item || mode() === 'adventure' || mode() === 'spectator') return false;
    return (
      Boolean(bot.registry.blocksByName[item.name]) ||
      USED_ON_BLOCK_ITEM.test(item.name)
    );
  }

  function performUseItemOn(hit, hand) {
    sendUseItemOn(hit, hand);
    return interactsWithBlock(hit.block) || placesOnBlock(itemInHand(hand));
  }

  function interactWithEntity(hit, hand) {
    if (bot.supportFeature('attackUsesOwnPacket')) {
      sendInteract(hit, hand, true); // 26.1+: one interact packet carrying the hit location
    } else {
      sendInteract(hit, hand, true);
      if (!/armor_?stand/i.test(hit.entity.name))
        sendInteract(hit, hand, false);
    }
    return (
      INTERACTIVE_ENTITY.test(hit.entity.name) ||
      ENTITY_ITEM.test(itemInHand(hand)?.name ?? '')
    );
  }

  /** @returns 'hold' (keeps being used), 'instant' or 'pass' (nothing happens) */
  function predictItemUse(item) {
    const { name } = item;
    const creative = mode() === 'creative';
    if (bot.registry.foodsByName[name]) {
      return creative || bot.food < 20 || ALWAYS_EDIBLE.test(name)
        ? 'hold'
        : 'pass';
    }
    if (name === 'bow' || name === 'crossbow') {
      return creative ||
        bot.inventory.items().some((i) => i.name.endsWith('arrow'))
        ? 'hold'
        : 'pass';
    }
    if (HELD_USE_ITEM.test(name) || (legacy && name.endsWith('_sword')))
      return 'hold';
    return INSTANT_USE_ITEM.test(name) ? 'instant' : 'pass';
  }

  function performUseItem(hand, item) {
    const result = predictItemUse(item);
    bot.activateItem(hand === OFF_HAND);
    if (result === 'hold') using = { hand, itemType: item.type };
    else if (result === 'instant' && !legacy) swing(hand);
    return result !== 'pass';
  }

  function startUseItem(hit) {
    if (destroying) return;
    rightClickDelay = USE_DELAY;
    for (const hand of hands) {
      if (hit?.entity && interactWithEntity(hit, hand)) {
        if (!legacy) swing(hand);
        return;
      }
      if (hit?.block && performUseItemOn(hit, hand)) {
        swing(hand);
        return;
      }
      const item = itemInHand(hand);
      if (item && performUseItem(hand, item)) return;
    }
  }

  function releaseUsingItem() {
    bot.deactivateItem();
    using = null;
  }

  // ---- Tick -------------------------------------------------------------

  function isIdle() {
    return (
      !down.left &&
      !down.right &&
      !clicks.left &&
      !clicks.right &&
      !destroying &&
      !using
    );
  }

  function handleKeybinds(hit) {
    let brokeInstantly = false;
    if (using) {
      if (!down.right) releaseUsingItem();
      clicks.left = clicks.right = 0;
    } else {
      for (; clicks.left > 0; clicks.left--)
        brokeInstantly = startAttack(hit) || brokeInstantly;
      for (; clicks.right > 0; clicks.right--) startUseItem(hit);
    }
    if (down.right && rightClickDelay === 0 && !using) startUseItem(hit);
    continueAttack(down.left && !brokeInstantly, hit);
  }

  function tick() {
    if (rightClickDelay > 0) rightClickDelay--;
    if (!isIdle() && !bot.currentWindow && bot.health > 0)
      handleKeybinds(pick());
    if (missTime > 0) missTime--;
    for (const button of ['left', 'right']) {
      if (releaseAfterTick[button])
        down[button] = releaseAfterTick[button] = false;
    }
  }

  function reset() {
    down.left = down.right = false;
    clicks.left = clicks.right = 0;
    destroying = using = null;
    missTime = rightClickDelay = destroyDelay = 0;
  }

  bot.on('physicsTick', tick);
  // Physics (and so physicsTick) is skipped while riding, the vehicle carries the bot.
  bot.on('physicsTickEnd', () => {
    if (bot.vehicle) tick();
  });
  bot.on('death', reset);
  // Opening a screen releases every key in vanilla.
  bot.on('windowOpen', () => {
    down.left = false;
    down.right = false;
  });
  bot.on('heldItemChanged', (item) => {
    if (using?.hand === MAIN_HAND && item?.type !== using.itemType)
      using = null;
  });
  bot._client.on('entity_status', (packet) => {
    if (
      packet.entityId === bot.entity?.id &&
      packet.entityStatus === FINISHED_USING_ITEM
    )
      using = null;
  });

  // ---- API --------------------------------------------------------------

  function assertButton(button) {
    if (button !== 'left' && button !== 'right')
      throw new Error(
        `Unknown mouse button "${button}", expected "left" or "right"`,
      );
  }

  bot.mouse = {
    press(button) {
      assertButton(button);
      releaseAfterTick[button] = false;
      if (down[button]) return;
      down[button] = true;
      clicks[button]++;
    },
    release(button) {
      assertButton(button);
      down[button] = false;
    },
    click(button) {
      bot.mouse.press(button);
      releaseAfterTick[button] = true;
    },
    /** A click is a press, not a hold, so it doesn't count as held down. */
    isDown(button) {
      assertButton(button);
      return down[button] && !releaseAfterTick[button];
    },
  };
}

module.exports = mouseExtension;
