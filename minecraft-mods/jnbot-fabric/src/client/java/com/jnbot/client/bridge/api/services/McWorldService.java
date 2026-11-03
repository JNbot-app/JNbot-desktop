package com.jnbot.client.bridge.api.services;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonNull;
import com.google.gson.JsonObject;
import com.jnbot.client.bridge.api.EntityJson;
import com.jnbot.client.bridge.api.McBridgeApiUtils;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import net.minecraft.client.Minecraft;
import net.minecraft.core.BlockPos;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.level.biome.Biome;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.level.levelgen.Heightmap;

public final class McWorldService {
  private static JsonObject serializeEntity(Entity e) {
    JsonObject out = new JsonObject();
    out.addProperty("id", e.getId());
    out.addProperty("type", BuiltInRegistries.ENTITY_TYPE.getKey(e.getType()).toString());
    out.addProperty("x", e.getX());
    out.addProperty("y", e.getY());
    out.addProperty("z", e.getZ());
    out.addProperty("yaw", e.getYRot());
    out.addProperty("pitch", e.getXRot());
    out.addProperty("name", e.getName().getString());
    out.add("data", EntityJson.data(e));

    if (e instanceof Player p) {
      out.addProperty("uuid", p.getStringUUID());
    }

    return out;
  }

  public JsonElement getOnlinePlayers(Minecraft client, JsonObject params) {
    if (client == null || client.level == null) return JsonNull.INSTANCE;

    JsonArray arr = new JsonArray();
    List<? extends Player> players = client.level.players();
    for (Player p : players) {
      arr.add(serializeEntity(p));
    }

    JsonObject out = new JsonObject();
    out.add("players", arr);
    return out;
  }

  public JsonElement getNearbyEntities(Minecraft client, JsonObject params) {
    if (client == null || client.level == null || client.player == null) return JsonNull.INSTANCE;

    double radius = McBridgeApiUtils.getDouble(params, "radius", 24);
    int limit = McBridgeApiUtils.getInt(params, "limit", 100);
    boolean includePlayers = McBridgeApiUtils.getBool(params, "includePlayers", true);
    String typeFilter = McBridgeApiUtils.getString(params, "type", null);

    JsonArray arr = new JsonArray();
    int count = 0;

    for (Entity e : client.level.entitiesForRendering()) {
      if (e == null) continue;
      if (e == client.player) continue;
      if (!includePlayers && (e instanceof Player)) continue;

      if (typeFilter != null && !typeFilter.isBlank()) {
        String id = BuiltInRegistries.ENTITY_TYPE.getKey(e.getType()).toString();
        if (!id.equals(typeFilter) && !id.endsWith(":" + typeFilter)) continue;
      }

      double dx = e.getX() - client.player.getX();
      double dy = e.getY() - client.player.getY();
      double dz = e.getZ() - client.player.getZ();
      double distSq = dx * dx + dy * dy + dz * dz;
      if (distSq > radius * radius) continue;

      arr.add(serializeEntity(e));
      count++;
      if (count >= limit) break;
    }

    JsonObject out = new JsonObject();
    out.addProperty("radius", radius);
    out.add("entities", arr);
    return out;
  }

  /** Light info at a position — sky / block / total. */
  public JsonElement getLight(Minecraft client, JsonObject params) {
    if (client == null || client.level == null) return JsonNull.INSTANCE;
    int x = McBridgeApiUtils.getInt(params, "x", 0);
    int y = McBridgeApiUtils.getInt(params, "y", 0);
    int z = McBridgeApiUtils.getInt(params, "z", 0);
    BlockPos pos = new BlockPos(x, y, z);

    JsonObject out = new JsonObject();
    try {
      out.addProperty("block", client.level.getBrightness(net.minecraft.world.level.LightLayer.BLOCK, pos));
      out.addProperty("sky", client.level.getBrightness(net.minecraft.world.level.LightLayer.SKY, pos));
      out.addProperty("total", client.level.getMaxLocalRawBrightness(pos));
    } catch (Exception ignored) {}
    return out;
  }

  /**
   * Scan a rectangular box for blocks matching the given ids. Same shape as
   * findBlocks but with `from` + `to` corners instead of a radius.
   *
   *  - from / to: { x, y, z } inclusive corners
   *  - matching:  string | string[] (block ids/short names)
   *  - count:     max results (default 64, hard cap 4096)
   *
   * Returns: { blocks: [...], total }
   */
  public JsonElement scanBox(Minecraft client, JsonObject params) {
    if (client == null || client.level == null) return JsonNull.INSTANCE;

    if (params == null || !params.has("from") || !params.has("to")) return JsonNull.INSTANCE;
    JsonObject from = params.getAsJsonObject("from");
    JsonObject to = params.getAsJsonObject("to");

    int x0 = McBridgeApiUtils.getInt(from, "x", 0);
    int y0 = McBridgeApiUtils.getInt(from, "y", 0);
    int z0 = McBridgeApiUtils.getInt(from, "z", 0);
    int x1 = McBridgeApiUtils.getInt(to, "x", 0);
    int y1 = McBridgeApiUtils.getInt(to, "y", 0);
    int z1 = McBridgeApiUtils.getInt(to, "z", 0);

    int xa = Math.min(x0, x1), xb = Math.max(x0, x1);
    int ya = Math.min(y0, y1), yb = Math.max(y0, y1);
    int za = Math.min(z0, z1), zb = Math.max(z0, z1);

    int volume = (xb - xa + 1) * (yb - ya + 1) * (zb - za + 1);
    if (volume > 262_144) {
      JsonObject err = new JsonObject();
      err.addProperty("ok", false);
      err.addProperty("reason", "volume_too_large");
      err.addProperty("limit", 262_144);
      return err;
    }

    Set<String> ids = parseMatching(params);
    // solid/liquid and properties too (e.g. a crop's age), for brain snapshots
    boolean details = params.has("details") && params.get("details").getAsBoolean();
    int limit = Math.min(4096, Math.max(1, McBridgeApiUtils.getInt(params, "count", 64)));

    JsonArray matches = new JsonArray();
    int total = 0;

    BlockPos.MutableBlockPos p = new BlockPos.MutableBlockPos();
    for (int y = ya; y <= yb; y++) {
      if (client.level.isOutsideBuildHeight(y)) continue;
      for (int x = xa; x <= xb; x++) {
        for (int z = za; z <= zb; z++) {
          p.set(x, y, z);
          BlockState state = client.level.getBlockState(p);
          if (state == null || state.isAir()) continue;
          String id = BuiltInRegistries.BLOCK.getKey(state.getBlock()).toString();
          if (!matches(ids, id)) continue;
          total++;
          if (matches.size() < limit) {
            JsonObject o = new JsonObject();
            JsonObject pos = new JsonObject();
            pos.addProperty("x", x); pos.addProperty("y", y); pos.addProperty("z", z);
            o.add("position", pos);
            o.addProperty("blockId", id);
            if (details) {
              o.addProperty("isSolid", state.isSolid());
              o.addProperty("isLiquid", !state.getFluidState().isEmpty());
              JsonObject props = McBlockService.stateProps(state);
              if (props.size() > 0) o.add("state", props);
            }
            matches.add(o);
          }
        }
      }
    }

    JsonObject out = new JsonObject();
    out.add("blocks", matches);
    out.addProperty("total", total);
    out.addProperty("volume", volume);
    return out;
  }

  /**
   * Every block of a box, compact: the distinct blocks (id, solid, liquid,
   * properties) and runs of [palette index, count] in y, then z, then x order.
   * For brain snapshots, which need the whole box (air too) every step.
   */
  public JsonElement blockCube(Minecraft client, JsonObject params) {
    if (client == null || client.level == null || params == null || !params.has("from") || !params.has("to"))
      return JsonNull.INSTANCE;
    JsonObject from = params.getAsJsonObject("from");
    JsonObject to = params.getAsJsonObject("to");
    int xa = McBridgeApiUtils.getInt(from, "x", 0), xb = McBridgeApiUtils.getInt(to, "x", 0);
    int ya = McBridgeApiUtils.getInt(from, "y", 0), yb = McBridgeApiUtils.getInt(to, "y", 0);
    int za = McBridgeApiUtils.getInt(from, "z", 0), zb = McBridgeApiUtils.getInt(to, "z", 0);
    if ((long) (xb - xa + 1) * (yb - ya + 1) * (zb - za + 1) > 262_144) return JsonNull.INSTANCE;

    java.util.Map<BlockState, Integer> index = new java.util.IdentityHashMap<>();
    JsonArray palette = new JsonArray();
    JsonArray runs = new JsonArray();
    int last = -1, count = 0;
    BlockPos.MutableBlockPos p = new BlockPos.MutableBlockPos();
    for (int y = ya; y <= yb; y++)
      for (int z = za; z <= zb; z++)
        for (int x = xa; x <= xb; x++) {
          BlockState state = client.level.getBlockState(p.set(x, y, z));
          int i = index.computeIfAbsent(state, s -> {
            JsonObject o = new JsonObject();
            o.addProperty("blockId", BuiltInRegistries.BLOCK.getKey(s.getBlock()).toString());
            o.addProperty("isSolid", s.isSolid());
            o.addProperty("isLiquid", !s.getFluidState().isEmpty());
            JsonObject props = McBlockService.stateProps(s);
            if (props.size() > 0) o.add("state", props);
            palette.add(o);
            return palette.size() - 1;
          });
          if (i == last) {
            count++;
            continue;
          }
          if (count > 0) {
            runs.add(last);
            runs.add(count);
          }
          last = i;
          count = 1;
        }
    if (count > 0) {
      runs.add(last);
      runs.add(count);
    }
    JsonObject out = new JsonObject();
    out.add("palette", palette);
    out.add("runs", runs);
    return out;
  }

  private static boolean matches(Set<String> ids, String blockId) {
    if (ids.isEmpty()) return true;
    if (ids.contains(blockId)) return true;
    int colon = blockId.indexOf(':');
    String name = colon >= 0 ? blockId.substring(colon + 1) : blockId;
    return ids.contains(name);
  }

  private static Set<String> parseMatching(JsonObject params) {
    Set<String> ids = new HashSet<>();
    if (params == null || !params.has("matching")) return ids;
    JsonElement el = params.get("matching");
    if (el == null || el.isJsonNull()) return ids;
    if (el.isJsonArray()) {
      for (JsonElement v : el.getAsJsonArray()) {
        if (v != null && v.isJsonPrimitive()) ids.add(v.getAsString());
      }
    } else if (el.isJsonPrimitive()) {
      ids.add(el.getAsString());
    }
    return ids;
  }

  /**
   * Heightmap probe for one column: returns the highest blocking Y and the
   * id of the top block. Tiny payload, useful for surface scanning.
   */
  public JsonElement getColumn(Minecraft client, JsonObject params) {
    if (client == null || client.level == null) return JsonNull.INSTANCE;
    int x = McBridgeApiUtils.getInt(params, "x", 0);
    int z = McBridgeApiUtils.getInt(params, "z", 0);

    JsonObject out = new JsonObject();
    out.addProperty("x", x);
    out.addProperty("z", z);
    try {
      int worldSurface = client.level.getHeight(Heightmap.Types.WORLD_SURFACE, x, z);
      int motionBlocking = client.level.getHeight(Heightmap.Types.MOTION_BLOCKING, x, z);
      out.addProperty("worldSurfaceY", worldSurface);
      out.addProperty("motionBlockingY", motionBlocking);

      BlockPos top = new BlockPos(x, motionBlocking - 1, z);
      BlockState s = client.level.getBlockState(top);
      if (s != null) {
        out.addProperty("topBlockId", BuiltInRegistries.BLOCK.getKey(s.getBlock()).toString());
      }
    } catch (Exception e) {
      out.addProperty("error", e.getMessage());
    }
    return out;
  }

  /** Biome at a position. */
  public JsonElement getBiome(Minecraft client, JsonObject params) {
    if (client == null || client.level == null) return JsonNull.INSTANCE;
    int x = McBridgeApiUtils.getInt(params, "x", 0);
    int y = McBridgeApiUtils.getInt(params, "y", 0);
    int z = McBridgeApiUtils.getInt(params, "z", 0);
    BlockPos pos = new BlockPos(x, y, z);

    JsonObject out = new JsonObject();
    try {
      var entry = client.level.getBiome(pos);
      String id = entry.unwrapKey().map(k -> k.identifier().toString()).orElse("unknown");
      out.addProperty("id", id);
      Biome biome = entry.value();
      out.addProperty("temperature", biome.getBaseTemperature());
      out.addProperty("hasPrecipitation", biome.hasPrecipitation());
    } catch (Exception e) {
      out.addProperty("error", e.getMessage());
    }
    return out;
  }

  /** World info — time of day, weather, dimension, seed (if available). */
  public JsonElement getWorldInfo(Minecraft client, JsonObject params) {
    if (client == null || client.level == null) return JsonNull.INSTANCE;

    JsonObject out = new JsonObject();
    out.addProperty("dimension", client.level.dimension().identifier().toString());
    out.addProperty("time", client.level.getGameTime());
    //? if >=26.1 {
    /*out.addProperty("timeOfDay", client.level.getDefaultClockTime());
    *///?} else
    out.addProperty("timeOfDay", client.level.getDayTime());
    try {
      out.addProperty("raining", client.level.isRaining());
      out.addProperty("thundering", client.level.isThundering());
    } catch (Exception ignored) {}
    try {
      out.addProperty("difficulty", client.level.getDifficulty().getSerializedName());
    } catch (Exception ignored) {}
    try {
      out.addProperty("ambientDarkness", client.level.getSkyDarken());
    } catch (Exception ignored) {}
    return out;
  }
}
