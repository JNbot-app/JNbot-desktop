package com.jnbot.client.bridge.api.services;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.jnbot.client.bridge.JnbotMcBridgeClient;
import com.jnbot.client.bridge.api.McBridgeApiUtils;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import net.minecraft.client.Minecraft;
import net.minecraft.core.BlockPos;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.world.level.block.state.BlockState;

/** Bounded block-region delta watches. No snapshots are sent unless a block changes. */
public final class McBlockWatchService {
  public static final McBlockWatchService INSTANCE = new McBlockWatchService();
  private static final int MAX_VOLUME = 4096;
  private static final int MAX_CHANGES_PER_EVENT = 128;

  private final Map<String, Watch> watches = new ConcurrentHashMap<>();

  private McBlockWatchService() {}

  public JsonElement watch(Minecraft client, JsonObject params) {
    BlockPos from = pos(params.getAsJsonObject("from"));
    BlockPos to = pos(params.getAsJsonObject("to"));
    JsonObject out = new JsonObject();
    if (from == null || to == null) return failed("invalid_region");
    int minX = Math.min(from.getX(), to.getX());
    int minY = Math.min(from.getY(), to.getY());
    int minZ = Math.min(from.getZ(), to.getZ());
    int maxX = Math.max(from.getX(), to.getX());
    int maxY = Math.max(from.getY(), to.getY());
    int maxZ = Math.max(from.getZ(), to.getZ());
    long volume = (long) (maxX - minX + 1) * (maxY - minY + 1) * (maxZ - minZ + 1);
    if (volume > MAX_VOLUME) return failed("region_too_large");

    String id = McBridgeApiUtils.getString(params, "id", UUID.randomUUID().toString());
    long interval = Math.min(5000, Math.max(100, McBridgeApiUtils.getInt(params, "intervalMs", 250)));
    Watch watch = new Watch(id, new BlockPos(minX, minY, minZ), new BlockPos(maxX, maxY, maxZ), interval);
    if (client != null && client.level != null) watch.capture(client);
    watches.put(id, watch);
    out.addProperty("ok", true);
    out.addProperty("id", id);
    out.addProperty("volume", volume);
    return out;
  }

  public JsonElement unwatch(Minecraft client, JsonObject params) {
    String id = McBridgeApiUtils.getString(params, "id", "");
    JsonObject out = new JsonObject();
    out.addProperty("ok", watches.remove(id) != null);
    return out;
  }

  public JsonElement clear(Minecraft client, JsonObject params) {
    int count = watches.size();
    watches.clear();
    JsonObject out = new JsonObject();
    out.addProperty("ok", true);
    out.addProperty("affected", count);
    return out;
  }

  public void reset() { watches.clear(); }

  public void tick(Minecraft client) {
    if (client == null || client.level == null || watches.isEmpty()) return;
    JnbotMcBridgeClient bridge = JnbotMcBridgeClient.getInstance();
    if (!bridge.isEventSubscribed("mc.block.changed")) return;
    long now = System.currentTimeMillis();
    for (Watch watch : watches.values()) {
      if (now - watch.lastScanAt < watch.intervalMs) continue;
      watch.lastScanAt = now;
      JsonArray changes = watch.scan(client);
      if (changes.isEmpty()) continue;
      JsonObject data = new JsonObject();
      data.addProperty("watchId", watch.id);
      data.add("changes", changes);
      data.addProperty("ts", now);
      bridge.sendEvent("mc.block.changed", data);
    }
  }

  private static BlockPos pos(JsonObject value) {
    if (value == null || !value.has("x") || !value.has("y") || !value.has("z")) return null;
    return new BlockPos(value.get("x").getAsInt(), value.get("y").getAsInt(), value.get("z").getAsInt());
  }

  private static JsonObject failed(String reason) {
    JsonObject out = new JsonObject();
    out.addProperty("ok", false);
    out.addProperty("reason", reason);
    return out;
  }

  private static final class Watch {
    final String id;
    final BlockPos from;
    final BlockPos to;
    final long intervalMs;
    final Map<Long, Integer> signatures = new LinkedHashMap<>();
    long lastScanAt;

    Watch(String id, BlockPos from, BlockPos to, long intervalMs) {
      this.id = id;
      this.from = from;
      this.to = to;
      this.intervalMs = intervalMs;
    }

    void capture(Minecraft client) {
      forEach(pos -> signatures.put(pos.asLong(), signature(client, pos)));
    }

    JsonArray scan(Minecraft client) {
      JsonArray changes = new JsonArray();
      forEach(pos -> {
        int next = signature(client, pos);
        Integer previous = signatures.put(pos.asLong(), next);
        if (previous != null && previous != next && changes.size() < MAX_CHANGES_PER_EVENT) {
          changes.add(McBlockService.serializeBlockAtRaw(client, pos, true));
        }
      });
      return changes;
    }

    private void forEach(java.util.function.Consumer<BlockPos> consumer) {
      for (int y = from.getY(); y <= to.getY(); y++) {
        for (int x = from.getX(); x <= to.getX(); x++) {
          for (int z = from.getZ(); z <= to.getZ(); z++) consumer.accept(new BlockPos(x, y, z));
        }
      }
    }

    private static int signature(Minecraft client, BlockPos pos) {
      BlockState state = client.level.getBlockState(pos);
      if (state == null) return 0;
      return BuiltInRegistries.BLOCK.getKey(state.getBlock()).hashCode() * 31 + state.hashCode();
    }
  }
}
