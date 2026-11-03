package com.jnbot.client.bridge.events;

import com.google.gson.JsonArray;
import com.google.gson.JsonNull;
import com.google.gson.JsonObject;
import com.jnbot.client.bridge.JnbotMcBridgeClient;
import com.jnbot.client.bridge.api.EntityJson;
import com.jnbot.client.bridge.api.ItemStackJson;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.screens.inventory.AbstractContainerScreen;
import net.minecraft.world.inventory.AbstractContainerMenu;
import net.minecraft.world.inventory.Slot;
import net.minecraft.world.item.ItemStack;


public final class McClientEventEmitter {
  private static final McClientEventEmitter INSTANCE = new McClientEventEmitter();

  public static McClientEventEmitter getInstance() {
    return INSTANCE;
  }

  private double lastX = Double.NaN;
  private double lastY = Double.NaN;
  private double lastZ = Double.NaN;
  private float lastYaw = Float.NaN;
  private float lastPitch = Float.NaN;
  private long lastPositionSentAt = 0;

  private boolean lastHandledScreen = false;
  private int lastSyncId = -1;
  private int[] lastSlotSig = null;
  private int lastCursorSig = 0;

  // Health snapshot
  private float lastHealth = Float.NaN;
  private float lastMaxHealth = Float.NaN;
  private int lastFood = Integer.MIN_VALUE;
  private long lastHealthSentAt = 0;

  // Entity presence
  private java.util.Set<Integer> knownEntityIds = new java.util.HashSet<>();
  private java.util.Set<Integer> reportedDeadEntityIds = new java.util.HashSet<>();
  private long lastEntityScanAt = 0;

  // Death/respawn tracking
  private boolean wasDead = false;
  private String lastDimension = null;
  private int lastHeldItemSig = Integer.MIN_VALUE;
  private int lastEffectsSig = Integer.MIN_VALUE;
  private boolean lastOnFire = false;
  private boolean lastUsingItem = false;
  private boolean lastSwimming = false;
  private boolean lastGliding = false;
  private int lastAir = Integer.MIN_VALUE;

  private McClientEventEmitter() {}

  public void reset() {
    lastX = Double.NaN;
    lastY = Double.NaN;
    lastZ = Double.NaN;
    lastYaw = Float.NaN;
    lastPitch = Float.NaN;
    lastPositionSentAt = 0;

    lastHandledScreen = false;
    lastSyncId = -1;
    lastSlotSig = null;
    lastCursorSig = 0;

    lastHealth = Float.NaN;
    lastMaxHealth = Float.NaN;
    lastFood = Integer.MIN_VALUE;
    lastHealthSentAt = 0;

    knownEntityIds.clear();
    reportedDeadEntityIds.clear();
    lastEntityScanAt = 0;
    wasDead = false;
    lastDimension = null;
    lastHeldItemSig = Integer.MIN_VALUE;
    lastEffectsSig = Integer.MIN_VALUE;
    lastAir = Integer.MIN_VALUE;
  }

  /** Fire-and-forget event for connection-loss/kick reasons. */
  public void onDisconnected(String reason) {
    JnbotMcBridgeClient bridge = JnbotMcBridgeClient.getInstance();
    if (!bridge.isEventSubscribed("mc.kicked")) return;
    JsonObject data = new JsonObject();
    data.addProperty("reason", reason != null ? reason : "unknown");
    data.addProperty("ts", System.currentTimeMillis());
    bridge.sendEvent("mc.kicked", data);
  }

  private static int stackSig(ItemStack stack) {
    return ItemStackJson.signature(stack);
  }

  private static JsonObject serializeStack(ItemStack stack) {
    return ItemStackJson.serialize(stack);
  }

  public void onChat(String message, String kind) {
    JnbotMcBridgeClient bridge = JnbotMcBridgeClient.getInstance();
    if (!bridge.isEventSubscribed("mc.chat")) return;

    JsonObject data = new JsonObject();
    data.addProperty("message", message != null ? message : "");
    data.addProperty("kind", kind != null ? kind : "chat");
    data.addProperty("ts", System.currentTimeMillis());

    bridge.sendEvent("mc.chat", data);
  }

  public void tick(Minecraft client) {
    if (client == null || client.player == null) return;

    JnbotMcBridgeClient bridge = JnbotMcBridgeClient.getInstance();

    boolean subPos = bridge.isEventSubscribed("mc.position");
    boolean subTp = bridge.isEventSubscribed("mc.player.forcedTeleport");
    boolean subDimension = bridge.isEventSubscribed("mc.dimension.changed");
    if (subPos || subTp || subDimension) {
      double x = client.player.getX();
      double y = client.player.getY();
      double z = client.player.getZ();
      float yaw = client.player.getYRot();
      float pitch = client.player.getXRot();
      String dimension = client.level != null ? client.level.dimension().identifier().toString() : "unknown";

      if (subDimension && lastDimension != null && !lastDimension.equals(dimension)) {
        JsonObject data = new JsonObject();
        data.addProperty("from", lastDimension);
        data.addProperty("to", dimension);
        data.addProperty("ts", System.currentTimeMillis());
        bridge.sendEvent("mc.dimension.changed", data);
      }
      lastDimension = dimension;

      if (!Double.isNaN(lastX)) {
        double dx = x - lastX;
        double dy = y - lastY;
        double dz = z - lastZ;
        double distSq = dx * dx + dy * dy + dz * dz;

        if (subTp && distSq > (8.0 * 8.0)) {
          JsonObject data = new JsonObject();
          JsonObject from = new JsonObject();
          from.addProperty("x", lastX);
          from.addProperty("y", lastY);
          from.addProperty("z", lastZ);
          JsonObject to = new JsonObject();
          to.addProperty("x", x);
          to.addProperty("y", y);
          to.addProperty("z", z);
          data.add("from", from);
          data.add("to", to);
          data.addProperty("dist", Math.sqrt(distSq));
          data.addProperty("ts", System.currentTimeMillis());
          bridge.sendEvent("mc.player.forcedTeleport", data);
        }
      }

      long now = System.currentTimeMillis();
      if (subPos) {
        boolean moved = Double.isNaN(lastX) || Math.abs(x - lastX) > 0.01 || Math.abs(y - lastY) > 0.01 || Math.abs(z - lastZ) > 0.01;
        boolean rotated = Float.isNaN(lastYaw) || Math.abs(yaw - lastYaw) > 0.25f || Math.abs(pitch - lastPitch) > 0.25f;
        boolean due = (now - lastPositionSentAt) >= 200;

        if ((moved || rotated) && due) {
          JsonObject data = new JsonObject();
          data.addProperty("x", x);
          data.addProperty("y", y);
          data.addProperty("z", z);
          data.addProperty("yaw", yaw);
          data.addProperty("pitch", pitch);
          try {
            if (client.level != null) {
              var dim = client.level.dimension().identifier();
              if (dim != null) data.addProperty("dimension", dim.toString());
            }
          } catch (Exception ignored) {}
          data.addProperty("ts", now);
          bridge.sendEvent("mc.position", data);
          lastPositionSentAt = now;
        }
      }

      lastX = x;
      lastY = y;
      lastZ = z;
      lastYaw = yaw;
      lastPitch = pitch;
    }

    boolean subWindowOpen = bridge.isEventSubscribed("mc.window.open");
    boolean subWindowClose = bridge.isEventSubscribed("mc.window.close");
    boolean subWindowItems = bridge.isEventSubscribed("mc.window.items");

    boolean handled = client.screen instanceof AbstractContainerScreen<?>;
    if ((subWindowOpen || subWindowClose || subWindowItems) && handled != lastHandledScreen) {
      if (handled && subWindowOpen) {
        AbstractContainerMenu handler = client.player.containerMenu;
        JsonObject data = new JsonObject();
        data.addProperty("syncId", handler != null ? handler.containerId : -1);
        data.addProperty("screenClass", client.screen.getClass().getName());
        try {
          if (client.screen instanceof AbstractContainerScreen<?> hs) {
            data.addProperty("title", hs.getTitle().getString());
          }
        } catch (Exception ignored) {}
        data.addProperty("ts", System.currentTimeMillis());
        bridge.sendEvent("mc.window.open", data);
      }

      if (!handled && subWindowClose) {
        JsonObject data = new JsonObject();
        data.addProperty("syncId", lastSyncId);
        data.addProperty("ts", System.currentTimeMillis());
        bridge.sendEvent("mc.window.close", data);
      }

      lastSlotSig = null;
      lastCursorSig = 0;
    }
    lastHandledScreen = handled;

    if (!subWindowItems) return;
    if (!handled) return;

    AbstractContainerMenu handler = client.player.containerMenu;
    if (handler == null) return;

    int syncId = handler.containerId;
    if (syncId != lastSyncId) {
      lastSyncId = syncId;
      lastSlotSig = null;
      lastCursorSig = 0;
    }

    int size = handler.slots != null ? handler.slots.size() : 0;
    if (size <= 0) return;

    if (lastSlotSig == null || lastSlotSig.length != size) {
      lastSlotSig = new int[size];
      for (int i = 0; i < size; i++) lastSlotSig[i] = Integer.MIN_VALUE;
    }

    JsonArray changed = new JsonArray();
    for (int i = 0; i < size; i++) {
      Slot slot = handler.slots.get(i);
      int sig = stackSig(slot.getItem());
      if (sig == lastSlotSig[i]) continue;
      lastSlotSig[i] = sig;

      JsonObject s = new JsonObject();
      s.addProperty("slot", i);
      s.add("stack", serializeStack(slot.getItem()));
      changed.add(s);
    }

    int cursorSig = stackSig(handler.getCarried());
    boolean cursorChanged = cursorSig != lastCursorSig;
    if (cursorChanged) lastCursorSig = cursorSig;

    if (changed.isEmpty() && !cursorChanged) return;

    JsonObject data = new JsonObject();
    data.addProperty("syncId", syncId);
    data.add("changedSlots", changed);
    data.add("cursorStack", handler.getCarried() != null ? serializeStack(handler.getCarried()) : JsonNull.INSTANCE);
    data.addProperty("ts", System.currentTimeMillis());

    bridge.sendEvent("mc.window.items", data);
  }

  /** Health/food changes — emit on change, throttled to ≥250ms. */
  public void tickHealth(Minecraft client) {
    if (client == null || client.player == null) return;
    JnbotMcBridgeClient bridge = JnbotMcBridgeClient.getInstance();
    boolean subHealth = bridge.isEventSubscribed("mc.health.changed");
    boolean subDeath = bridge.isEventSubscribed("mc.death");
    boolean subRespawn = bridge.isEventSubscribed("mc.respawn");
    boolean subState = bridge.isEventSubscribed("mc.player.stateChanged");
    boolean subHeld = bridge.isEventSubscribed("mc.player.heldItemChanged");
    boolean subEffects = bridge.isEventSubscribed("mc.player.effectsChanged");
    if (!subHealth && !subDeath && !subRespawn && !subState && !subHeld && !subEffects) return;

    float h = client.player.getHealth();
    float maxH = client.player.getMaxHealth();
    int food = client.player.getFoodData() != null ? client.player.getFoodData().getFoodLevel() : 0;

    boolean dead = h <= 0;
    if (dead && !wasDead && subDeath) {
      JsonObject data = new JsonObject();
      data.addProperty("ts", System.currentTimeMillis());
      bridge.sendEvent("mc.death", data);
    } else if (!dead && wasDead && subRespawn) {
      JsonObject data = new JsonObject();
      data.addProperty("ts", System.currentTimeMillis());
      bridge.sendEvent("mc.respawn", data);
    }
    wasDead = dead;

    if (subHeld) {
      int signature = ItemStackJson.signature(client.player.getMainHandItem()) * 31
          + ItemStackJson.signature(client.player.getOffhandItem());
      if (lastHeldItemSig != Integer.MIN_VALUE && signature != lastHeldItemSig) {
        JsonObject data = new JsonObject();
        data.add("mainHand", ItemStackJson.serialize(client.player.getMainHandItem()));
        data.add("offHand", ItemStackJson.serialize(client.player.getOffhandItem()));
        data.addProperty("selectedHotbarSlot", client.player.getInventory().getSelectedSlot());
        data.addProperty("ts", System.currentTimeMillis());
        bridge.sendEvent("mc.player.heldItemChanged", data);
      }
      lastHeldItemSig = signature;
    }

    if (subEffects) {
      int signature = 1;
      for (var effect : client.player.getActiveEffects()) {
        signature = signature * 31 + effect.getDescriptionId().hashCode();
        signature = signature * 31 + effect.getAmplifier();
      }
      if (lastEffectsSig != Integer.MIN_VALUE && signature != lastEffectsSig) {
        JsonArray effects = new JsonArray();
        for (var effect : client.player.getActiveEffects()) {
          JsonObject item = new JsonObject();
          item.addProperty("id", effect.getDescriptionId());
          item.addProperty("amplifier", effect.getAmplifier());
          item.addProperty("duration", effect.getDuration());
          effects.add(item);
        }
        JsonObject data = new JsonObject();
        data.add("effects", effects);
        data.addProperty("ts", System.currentTimeMillis());
        bridge.sendEvent("mc.player.effectsChanged", data);
      }
      lastEffectsSig = signature;
    }

    if (subState) {
      boolean onFire = client.player.isOnFire();
      boolean usingItem = client.player.isUsingItem();
      boolean swimming = client.player.isSwimming();
      boolean gliding = client.player.isFallFlying();
      int air = client.player.getAirSupply();
      boolean changed = lastAir != Integer.MIN_VALUE && (onFire != lastOnFire || usingItem != lastUsingItem
          || swimming != lastSwimming || gliding != lastGliding || air != lastAir);
      if (changed) {
        JsonObject data = new JsonObject();
        data.addProperty("onFire", onFire);
        data.addProperty("usingItem", usingItem);
        data.addProperty("swimming", swimming);
        data.addProperty("gliding", gliding);
        data.addProperty("air", air);
        data.addProperty("ts", System.currentTimeMillis());
        bridge.sendEvent("mc.player.stateChanged", data);
      }
      lastOnFire = onFire;
      lastUsingItem = usingItem;
      lastSwimming = swimming;
      lastGliding = gliding;
      lastAir = air;
    }

    if (!subHealth) return;
    long now = System.currentTimeMillis();
    boolean changed = Float.isNaN(lastHealth)
        || Math.abs(h - lastHealth) > 0.01
        || Math.abs(maxH - lastMaxHealth) > 0.01
        || food != lastFood;
    if (!changed) return;
    if (now - lastHealthSentAt < 250) return;

    JsonObject data = new JsonObject();
    data.addProperty("health", h);
    data.addProperty("maxHealth", maxH);
    data.addProperty("food", food);
    data.addProperty("ts", now);
    bridge.sendEvent("mc.health.changed", data);

    lastHealth = h;
    lastMaxHealth = maxH;
    lastFood = food;
    lastHealthSentAt = now;
  }

  /**
   * Entity presence in a ~32-block radius — emits spawned/died events.
   * Throttled to ~once per second to keep the websocket calm.
   */
  public void tickEntities(Minecraft client) {
    if (client == null || client.player == null || client.level == null) return;
    JnbotMcBridgeClient bridge = JnbotMcBridgeClient.getInstance();
    boolean subSpawn = bridge.isEventSubscribed("mc.entity.spawned");
    boolean subDie = bridge.isEventSubscribed("mc.entity.died");
    boolean subDespawn = bridge.isEventSubscribed("mc.entity.despawned");
    if (!subSpawn && !subDie && !subDespawn) return;

    long now = System.currentTimeMillis();
    if (now - lastEntityScanAt < 1000) return;
    lastEntityScanAt = now;

    double radius = 32.0;
    double radiusSq = radius * radius;
    java.util.Set<Integer> current = new java.util.HashSet<>();
    java.util.List<net.minecraft.world.entity.Entity> spawnedEntities = new java.util.ArrayList<>();

    for (net.minecraft.world.entity.Entity e : client.level.entitiesForRendering()) {
      if (e == null || e == client.player) continue;
      double dx = e.getX() - client.player.getX();
      double dy = e.getY() - client.player.getY();
      double dz = e.getZ() - client.player.getZ();
      if (dx * dx + dy * dy + dz * dz > radiusSq) continue;
      current.add(e.getId());
      if (e.isAlive() && !knownEntityIds.contains(e.getId())) {
        spawnedEntities.add(e);
      }
    }

    if (subSpawn && !spawnedEntities.isEmpty()) {
      JsonArray arr = new JsonArray();
      for (net.minecraft.world.entity.Entity e : spawnedEntities) {
        arr.add(EntityJson.serialize(client, e, false));
      }
      JsonObject data = new JsonObject();
      data.add("entities", arr);
      data.addProperty("ts", now);
      bridge.sendEvent("mc.entity.spawned", data);
    }

    if (subDie) {
      java.util.List<Integer> died = new java.util.ArrayList<>();
      for (net.minecraft.world.entity.Entity e : client.level.entitiesForRendering()) {
        if (e != null && current.contains(e.getId()) && !e.isAlive() && reportedDeadEntityIds.add(e.getId())) {
          died.add(e.getId());
        }
      }
      if (!died.isEmpty()) {
        JsonArray arr = new JsonArray();
        for (Integer id : died) arr.add(id);
        JsonObject data = new JsonObject();
        data.add("ids", arr);
        data.addProperty("ts", now);
        bridge.sendEvent("mc.entity.died", data);
      }
    }

    if (subDespawn) {
      JsonArray ids = new JsonArray();
      for (Integer id : knownEntityIds) if (!current.contains(id) && !reportedDeadEntityIds.contains(id)) ids.add(id);
      if (!ids.isEmpty()) {
        JsonObject data = new JsonObject();
        data.add("ids", ids);
        data.addProperty("ts", now);
        bridge.sendEvent("mc.entity.despawned", data);
      }
    }

    reportedDeadEntityIds.retainAll(current);

    knownEntityIds = current;
  }
}
