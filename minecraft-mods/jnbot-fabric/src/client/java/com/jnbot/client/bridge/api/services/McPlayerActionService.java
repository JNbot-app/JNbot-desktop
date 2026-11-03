package com.jnbot.client.bridge.api.services;

import com.jnbot.client.compat.ClientCompat;
import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonNull;
import com.google.gson.JsonObject;
import com.jnbot.client.bridge.api.McBridgeApiUtils;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.screens.DeathScreen;
import net.minecraft.core.BlockPos;
import net.minecraft.core.Direction;
import net.minecraft.network.protocol.game.ServerboundPlayerActionPacket;
import net.minecraft.world.InteractionHand;
import net.minecraft.world.entity.player.Inventory;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.level.ClipContext;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.phys.BlockHitResult;
import net.minecraft.world.phys.HitResult;
import net.minecraft.world.phys.Vec3;
import com.jnbot.client.bridge.api.ItemStackJson;

/**
 * Player actions beyond raw input — drop items, swing arm, dig a specific
 * block, place a block by world position. All bounded by reach distance,
 * so the server still validates.
 */
public final class McPlayerActionService {

  public JsonElement swingArm(Minecraft client, JsonObject params) {
    if (client == null || client.player == null) return JsonNull.INSTANCE;
    String hand = McBridgeApiUtils.getString(params, "hand", "main");
    ClientCompat.swing(client.player, "off".equalsIgnoreCase(hand) ? InteractionHand.OFF_HAND : InteractionHand.MAIN_HAND);
    return JsonNull.INSTANCE;
  }

  public JsonElement dropItem(Minecraft client, JsonObject params) {
    if (client == null || client.player == null) return JsonNull.INSTANCE;
    boolean entireStack = McBridgeApiUtils.getBool(params, "entireStack", false);
    ClientCompat.dropSelected(client, entireStack);
    return JsonNull.INSTANCE;
  }

  /** Snapshot of the player's inventory (no NBT, just id + count + slot). */
  public JsonElement getInventory(Minecraft client, JsonObject params) {
    if (client == null || client.player == null) return JsonNull.INSTANCE;
    Inventory inv = client.player.getInventory();
    if (inv == null) return JsonNull.INSTANCE;

    JsonObject out = new JsonObject();
    JsonArray items = new JsonArray();
    int size = inv.getContainerSize();
    for (int i = 0; i < size; i++) {
      ItemStack stack = inv.getItem(i);
      if (stack == null || stack.isEmpty()) continue;

      JsonObject obj = ItemStackJson.serializeDetailed(stack);
      obj.addProperty("slot", i);
      items.add(obj);
    }

    out.add("items", items);
    out.addProperty("size", size);
    try { out.addProperty("selectedHotbarSlot", inv.getSelectedSlot()); } catch (Exception ignored) {}
    return out;
  }

  /** the block being dug, kept going every tick like a held attack key */
  private static BlockPos diggingPos;
  private static Direction diggingFace;

  /**
   * Start digging a block; {@link #tick} keeps breaking it until it's gone,
   * {@link #stopDig} is called or another block is dug. Digging the same block
   * again is a no-op, so callers can repeat it every step.
   */
  public JsonElement dig(Minecraft client, JsonObject params) {
    if (client == null || client.player == null || client.gameMode == null || client.level == null)
      return JsonNull.INSTANCE;

    int x = McBridgeApiUtils.getInt(params, "x", 0);
    int y = McBridgeApiUtils.getInt(params, "y", 0);
    int z = McBridgeApiUtils.getInt(params, "z", 0);
    BlockPos pos = new BlockPos(x, y, z);
    Direction face = parseDirection(McBridgeApiUtils.getString(params, "face", "up"));

    BlockState state = client.level.getBlockState(pos);
    JsonObject out = new JsonObject();
    if (state == null || state.isAir()) {
      out.addProperty("ok", false);
      out.addProperty("reason", "block_is_air");
      return out;
    }

    boolean instant = state.getDestroySpeed(client.level, pos) <= 0;
    synchronized (McPlayerActionService.class) {
      if (!pos.equals(diggingPos)) {
        client.gameMode.startDestroyBlock(pos, face);
        ClientCompat.swing(client.player, InteractionHand.MAIN_HAND);
        diggingPos = instant ? null : pos;
        diggingFace = face;
      }
    }
    out.addProperty("ok", true);
    out.addProperty("instant", instant);
    return out;
  }

  /** advances the dig started by {@link #dig}; ends once the block is gone */
  public static synchronized void tick(Minecraft client) {
    if (diggingPos == null) return;
    if (client.player == null || client.gameMode == null || client.level == null
        || client.level.getBlockState(diggingPos).isAir()) {
      diggingPos = null;
      return;
    }
    if (client.gameMode.continueDestroyBlock(diggingPos, diggingFace)) {
      if (client.player.tickCount % 4 == 0) ClientCompat.swing(client.player, InteractionHand.MAIN_HAND);
    } else diggingPos = null;
  }

  public JsonElement stopDig(Minecraft client, JsonObject params) {
    if (client == null || client.player == null || client.gameMode == null)
      return JsonNull.INSTANCE;
    synchronized (McPlayerActionService.class) {
      diggingPos = null;
    }
    client.gameMode.stopDestroyBlock();
    return JsonNull.INSTANCE;
  }

  /**
   * Place a block at the position of an existing block, on the chosen face.
   * Requires line-of-sight + reach (server-validated).
   */
  public JsonElement placeBlock(Minecraft client, JsonObject params) {
    if (client == null || client.player == null || client.gameMode == null || client.level == null)
      return JsonNull.INSTANCE;

    int x = McBridgeApiUtils.getInt(params, "x", 0);
    int y = McBridgeApiUtils.getInt(params, "y", 0);
    int z = McBridgeApiUtils.getInt(params, "z", 0);
    String faceRaw = McBridgeApiUtils.getString(params, "face", "up");
    String handRaw = McBridgeApiUtils.getString(params, "hand", "main");

    Direction face = parseDirection(faceRaw);
    InteractionHand hand = "off".equalsIgnoreCase(handRaw) ? InteractionHand.OFF_HAND : InteractionHand.MAIN_HAND;

    BlockPos pos = new BlockPos(x, y, z);
    Vec3 hitPos = Vec3.atCenterOf(pos).add(face.getStepX() * 0.5, face.getStepY() * 0.5, face.getStepZ() * 0.5);

    BlockHitResult hit = new BlockHitResult(hitPos, face, pos, false);
    client.gameMode.useItemOn(client.player, hand, hit);
    ClientCompat.swing(client.player, hand);

    JsonObject out = new JsonObject();
    out.addProperty("ok", true);
    return out;
  }

  /**
   * Move an item from the inventory to a destination slot.
   * destination: 'hand' | 'off-hand' | 'head' | 'chest' | 'legs' | 'feet' | 'hotbar' | a slot index (string)
   */
  public JsonElement equip(Minecraft client, JsonObject params) {
    if (client == null || client.player == null || client.gameMode == null) return failed("no_client");

    String itemId = McBridgeApiUtils.getString(params, "itemId", null);
    int srcSlot = McBridgeApiUtils.getInt(params, "slot", -1);
    String destinationRaw = McBridgeApiUtils.getString(params, "destination", "hand");

    Inventory inv = client.player.getInventory();
    if (inv == null) return failed("no_inventory");

    int sourceSlot = srcSlot;
    if (sourceSlot < 0 && itemId != null) {
      sourceSlot = findSlotByItemId(inv, itemId);
    }
    if (sourceSlot < 0) return failed("source_not_found");

    int destSlot = destinationSlot(destinationRaw);
    if (destSlot < 0) return failed("invalid_destination");

    // Use clickSlot via the player's currentScreenHandler (inventory or open container).
    // Easier approach for hotbar: pickFromInventory (which swaps).
    if ("hotbar".equalsIgnoreCase(destinationRaw) || "hand".equalsIgnoreCase(destinationRaw)) {
      // Pick into hotbar via swap
      try {
        inv.setSelectedSlot(0);
      } catch (Exception ignored) {}
      net.minecraft.world.inventory.AbstractContainerMenu handler = client.player.inventoryMenu;
      // QUICK_MOVE moves the stack between inventory and hotbar.
      client.gameMode.handleInventoryMouseClick(handler.containerId, sourceSlot, 0,
          net.minecraft.world.inventory.ClickType.QUICK_MOVE, client.player);
      JsonObject out = ok();
      out.addProperty("destinationSlot", destSlot);
      return out;
    }

    // For armor slots: use swap-with-hotbar action with the player screen handler.
    // The PlayerScreenHandler slot indices: 5=head, 6=chest, 7=legs, 8=feet, 36..44=hotbar.
    net.minecraft.world.inventory.AbstractContainerMenu handler = client.player.inventoryMenu;

    // Pick up
    client.gameMode.handleInventoryMouseClick(handler.containerId, sourceSlot, 0,
        net.minecraft.world.inventory.ClickType.PICKUP, client.player);
    // Place into destination
    client.gameMode.handleInventoryMouseClick(handler.containerId, destSlot, 0,
        net.minecraft.world.inventory.ClickType.PICKUP, client.player);
    // If anything stayed on cursor, put it back
    client.gameMode.handleInventoryMouseClick(handler.containerId, sourceSlot, 0,
        net.minecraft.world.inventory.ClickType.PICKUP, client.player);

    JsonObject out = ok();
    out.addProperty("destinationSlot", destSlot);
    return out;
  }

  private static int findSlotByItemId(Inventory inv, String itemId) {
    int size = inv.getContainerSize();
    for (int i = 0; i < size; i++) {
      ItemStack s = inv.getItem(i);
      if (s == null || s.isEmpty()) continue;
      if (ItemStackJson.matches(s, itemId)) return i;
    }
    return -1;
  }

  private static int destinationSlot(String name) {
    if (name == null) return -1;
    return switch (name.toLowerCase()) {
      case "head", "helmet" -> 5;
      case "chest", "chestplate" -> 6;
      case "legs", "leggings" -> 7;
      case "feet", "boots" -> 8;
      case "off-hand", "offhand", "off_hand" -> 45;
      case "hand", "mainhand", "main_hand", "hotbar" -> 36;
      default -> -1;
    };
  }

  public JsonElement sleep(Minecraft client, JsonObject params) {
    // Attempt to use the block in front of the player — if it's a bed, this puts the player to sleep.
    return useOnLooked(client, params);
  }

  public JsonElement wake(Minecraft client, JsonObject params) {
    if (client == null || client.player == null) return failed("no_client");
    try {
      // Send leave-bed action
      client.player.connection.send(
          new net.minecraft.network.protocol.game.ServerboundPlayerCommandPacket(
              client.player,
              net.minecraft.network.protocol.game.ServerboundPlayerCommandPacket.Action.STOP_SLEEPING));
    } catch (Exception ignored) {}
    return ok();
  }

  private static JsonObject ok() {
    JsonObject o = new JsonObject();
    o.addProperty("ok", true);
    return o;
  }
  private static JsonObject failed(String reason) {
    JsonObject o = new JsonObject();
    o.addProperty("ok", false);
    o.addProperty("reason", reason);
    return o;
  }

  private static Direction parseDirection(String name) {
    if (name == null) return Direction.UP;
    return switch (name.toLowerCase()) {
      case "down", "bottom" -> Direction.DOWN;
      case "up", "top" -> Direction.UP;
      case "north" -> Direction.NORTH;
      case "south" -> Direction.SOUTH;
      case "east" -> Direction.EAST;
      case "west" -> Direction.WEST;
      default -> Direction.UP;
    };
  }

  /**
   * Right-click a specific block (open chest/furnace, press a button, etc.).
   * Same input shape as placeBlock: position + face the player is reaching from.
   */
  public JsonElement activateBlock(Minecraft client, JsonObject params) {
    if (client == null || client.player == null || client.gameMode == null) return failed("no_client");

    int x = McBridgeApiUtils.getInt(params, "x", 0);
    int y = McBridgeApiUtils.getInt(params, "y", 0);
    int z = McBridgeApiUtils.getInt(params, "z", 0);
    String faceRaw = McBridgeApiUtils.getString(params, "face", "up");
    String handRaw = McBridgeApiUtils.getString(params, "hand", "main");

    Direction face = parseDirection(faceRaw);
    InteractionHand hand = "off".equalsIgnoreCase(handRaw) ? InteractionHand.OFF_HAND : InteractionHand.MAIN_HAND;

    BlockPos pos = new BlockPos(x, y, z);
    Vec3 hitPos = Vec3.atCenterOf(pos);
    BlockHitResult hit = new BlockHitResult(hitPos, face, pos, false);
    client.gameMode.useItemOn(client.player, hand, hit);
    ClientCompat.swing(client.player, hand);
    return ok();
  }

  /** Right-click whatever block is in front of the player (auto raycast). */
  public JsonElement useOnLooked(Minecraft client, JsonObject params) {
    if (client == null || client.player == null || client.level == null) return JsonNull.INSTANCE;

    double maxDistance = McBridgeApiUtils.getDouble(params, "maxDistance", 5.0);
    Vec3 start = client.player.getEyePosition(1.0F);
    Vec3 dir = client.player.getViewVector(1.0F);
    Vec3 end = start.add(dir.x * maxDistance, dir.y * maxDistance, dir.z * maxDistance);

    BlockHitResult hit = client.level.clip(new ClipContext(start, end,
        ClipContext.Block.OUTLINE, ClipContext.Fluid.NONE, client.player));

    if (hit == null || hit.getType() != HitResult.Type.BLOCK) {
      JsonObject out = new JsonObject();
      out.addProperty("ok", false);
      out.addProperty("reason", "no_block_in_sight");
      return out;
    }

    client.gameMode.useItemOn(client.player, InteractionHand.MAIN_HAND, hit);
    ClientCompat.swing(client.player, InteractionHand.MAIN_HAND);

    JsonObject out = new JsonObject();
    out.addProperty("ok", true);
    JsonObject p = new JsonObject();
    p.addProperty("x", hit.getBlockPos().getX());
    p.addProperty("y", hit.getBlockPos().getY());
    p.addProperty("z", hit.getBlockPos().getZ());
    out.add("block", p);
    return out;
  }

  public JsonElement lookAt(Minecraft client, JsonObject params) {
    if (client == null || client.player == null) return failed("no_client");
    double x = McBridgeApiUtils.getDouble(params, "x", client.player.getX());
    double y = McBridgeApiUtils.getDouble(params, "y", client.player.getEyeY());
    double z = McBridgeApiUtils.getDouble(params, "z", client.player.getZ());
    Vec3 eye = client.player.getEyePosition();
    double dx = x - eye.x;
    double dy = y - eye.y;
    double dz = z - eye.z;
    double horizontal = Math.sqrt(dx * dx + dz * dz);
    float yaw = (float) Math.toDegrees(Math.atan2(-dx, dz));
    float pitch = (float) -Math.toDegrees(Math.atan2(dy, horizontal));
    client.player.setYRot(yaw);
    client.player.setXRot(Math.max(-90, Math.min(90, pitch)));
    client.player.setYHeadRot(yaw);
    return ok();
  }

  public JsonElement useItem(Minecraft client, JsonObject params) {
    if (client == null || client.player == null || client.gameMode == null) return failed("no_client");
    InteractionHand hand = "off".equalsIgnoreCase(McBridgeApiUtils.getString(params, "hand", "main"))
        ? InteractionHand.OFF_HAND : InteractionHand.MAIN_HAND;
    client.gameMode.useItem(client.player, hand);
    ClientCompat.swing(client.player, hand);
    return ok();
  }

  public JsonElement releaseUseItem(Minecraft client, JsonObject params) {
    if (client == null || client.player == null || client.gameMode == null) return failed("no_client");
    client.gameMode.releaseUsingItem(client.player);
    return ok();
  }

  public JsonElement swapHands(Minecraft client, JsonObject params) {
    if (client == null || client.player == null || client.player.connection == null) return failed("no_client");
    client.player.connection.send(new ServerboundPlayerActionPacket(
        ServerboundPlayerActionPacket.Action.SWAP_ITEM_WITH_OFFHAND, BlockPos.ZERO, Direction.DOWN));
    ClientCompat.swing(client.player, InteractionHand.OFF_HAND);
    return ok();
  }

  public JsonElement respawn(Minecraft client, JsonObject params) {
    if (client == null || client.player == null) return failed("no_client");
    client.player.respawn();
    return ok();
  }

  public JsonElement canRespawn(Minecraft client, JsonObject params) {
    JsonObject out = new JsonObject();
    out.addProperty("ok", client != null && client.screen instanceof DeathScreen);
    return out;
  }
}
