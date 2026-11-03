package com.jnbot.client.bridge.api.services;

import com.jnbot.client.compat.ClientCompat;
import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonNull;
import com.google.gson.JsonObject;
import com.jnbot.client.bridge.api.McBridgeApiUtils;
import java.util.HashSet;
import java.util.Set;
import net.minecraft.client.Minecraft;
import net.minecraft.core.BlockPos;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.world.level.ClipContext;
import net.minecraft.world.level.block.entity.BlockEntity;
import net.minecraft.world.level.block.entity.SignBlockEntity;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.phys.BlockHitResult;
import net.minecraft.world.phys.HitResult;
import net.minecraft.world.phys.Vec3;

/**
 * Mineflayer-style read API for blocks. Everything stays on the client; only
 * the result (a small JSON object) is shipped over the websocket.
 */
public final class McBlockService {

  public JsonElement getBlockAt(Minecraft client, JsonObject params) {
    if (client == null || client.level == null) return JsonNull.INSTANCE;
    int x = McBridgeApiUtils.getInt(params, "x", 0);
    int y = McBridgeApiUtils.getInt(params, "y", 0);
    int z = McBridgeApiUtils.getInt(params, "z", 0);
    return serializeBlockAt(client, new BlockPos(x, y, z));
  }

  /** Block the player is currently looking at (raycast). Bounded by maxDistance. */
  public JsonElement getBlockAtCursor(Minecraft client, JsonObject params) {
    if (client == null || client.player == null || client.level == null) return JsonNull.INSTANCE;

    double maxDistance = McBridgeApiUtils.getDouble(params, "maxDistance", 5.0);
    HitResult cursor = client.hitResult;

    if (cursor instanceof BlockHitResult bhr) {
      JsonObject out = (JsonObject) serializeBlockAt(client, bhr.getBlockPos());
      if (out != null) {
        out.addProperty("face", bhr.getDirection().getSerializedName());
        JsonObject hit = new JsonObject();
        Vec3 pos = bhr.getLocation();
        hit.addProperty("x", pos.x);
        hit.addProperty("y", pos.y);
        hit.addProperty("z", pos.z);
        out.add("hitPos", hit);
        return out;
      }
    }

    // Fallback: explicit raycast
    return raycast(client, params, maxDistance);
  }

  public JsonElement raycast(Minecraft client, JsonObject params) {
    if (client == null || client.player == null || client.level == null) return JsonNull.INSTANCE;
    double maxDistance = McBridgeApiUtils.getDouble(params, "maxDistance", 5.0);
    return raycast(client, params, maxDistance);
  }

  private JsonElement raycast(Minecraft client, JsonObject params, double maxDistance) {
    Vec3 start = client.player.getEyePosition(1.0F);
    Vec3 dir = client.player.getViewVector(1.0F);
    Vec3 end = start.add(dir.x * maxDistance, dir.y * maxDistance, dir.z * maxDistance);

    BlockHitResult hit = client.level.clip(new ClipContext(
        start, end,
        ClipContext.Block.OUTLINE,
        ClipContext.Fluid.NONE,
        client.player));

    if (hit == null || hit.getType() != HitResult.Type.BLOCK) {
      return JsonNull.INSTANCE;
    }

    JsonObject out = (JsonObject) serializeBlockAt(client, hit.getBlockPos());
    if (out != null) {
      out.addProperty("face", hit.getDirection().getSerializedName());
      JsonObject p = new JsonObject();
      p.addProperty("x", hit.getLocation().x);
      p.addProperty("y", hit.getLocation().y);
      p.addProperty("z", hit.getLocation().z);
      out.add("hitPos", p);
    }
    return out != null ? out : JsonNull.INSTANCE;
  }

  /**
   * Mineflayer-style findBlock: BFS from the player, optionally limited by ids.
   *
   * Params:
   *  - matching: string | string[]   (block ids like "minecraft:diamond_ore"; supports "*:diamond_ore" loose match)
   *  - maxDistance: number           (radius, default 16, hard-capped at 64)
   *  - count: number                 (max results, default 1, hard-capped at 64)
   *  - useExtraInfo: boolean         (return state info)
   */
  public JsonElement findBlocks(Minecraft client, JsonObject params) {
    if (client == null || client.player == null || client.level == null) return JsonNull.INSTANCE;

    Set<String> ids = parseMatching(params);
    int radius = Math.min(64, Math.max(1, McBridgeApiUtils.getInt(params, "maxDistance", 16)));
    int count = Math.min(64, Math.max(1, McBridgeApiUtils.getInt(params, "count", 1)));
    boolean useExtra = McBridgeApiUtils.getBool(params, "useExtraInfo", false);

    BlockPos origin = client.player.blockPosition();

    JsonArray matches = new JsonArray();

    // Scan a cube centered on the player. For each block whose id matches,
    // record it. Order by squared distance to mirror mineflayer's "closest first".
    java.util.List<int[]> hits = new java.util.ArrayList<>();
    int rad = radius;
    for (int dy = -rad; dy <= rad; dy++) {
      int y = origin.getY() + dy;
      if (client.level.isOutsideBuildHeight(y)) continue;
      for (int dx = -rad; dx <= rad; dx++) {
        for (int dz = -rad; dz <= rad; dz++) {
          int sq = dx * dx + dy * dy + dz * dz;
          if (sq > rad * rad) continue;

          BlockPos pos = new BlockPos(origin.getX() + dx, y, origin.getZ() + dz);
          BlockState state = client.level.getBlockState(pos);
          if (state == null || state.isAir()) continue;

          String blockId = BuiltInRegistries.BLOCK.getKey(state.getBlock()).toString();
          if (!matches(ids, blockId)) continue;
          hits.add(new int[]{pos.getX(), pos.getY(), pos.getZ(), sq});
        }
      }
    }

    hits.sort((a, b) -> Integer.compare(a[3], b[3]));

    int limit = Math.min(count, hits.size());
    for (int i = 0; i < limit; i++) {
      int[] h = hits.get(i);
      BlockPos pos = new BlockPos(h[0], h[1], h[2]);
      JsonObject obj = serializeBlockAtRaw(client, pos, useExtra);
      matches.add(obj);
    }

    JsonObject out = new JsonObject();
    out.add("blocks", matches);
    out.addProperty("scannedRadius", radius);
    out.addProperty("total", hits.size());
    return out;
  }

  /** Convenience: returns only the first match (or null). */
  public JsonElement findBlock(Minecraft client, JsonObject params) {
    JsonObject p = params == null ? new JsonObject() : params.deepCopy();
    p.addProperty("count", 1);
    JsonElement res = findBlocks(client, p);
    if (!(res instanceof JsonObject obj)) return JsonNull.INSTANCE;
    JsonArray arr = obj.getAsJsonArray("blocks");
    if (arr == null || arr.isEmpty()) return JsonNull.INSTANCE;
    return arr.get(0);
  }

  private static boolean matches(Set<String> ids, String blockId) {
    if (ids == null || ids.isEmpty()) return true;
    if (ids.contains(blockId)) return true;
    // Loose match by name (after namespace). Useful with "diamond_ore" etc.
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
   * Reads the text content of a sign block at the given position. Returns
   * `{ front: [..], back: [..] }` (Minecraft 1.20+ signs have two faces).
   */
  public JsonElement getSignText(Minecraft client, JsonObject params) {
    if (client == null || client.level == null) return JsonNull.INSTANCE;
    int x = McBridgeApiUtils.getInt(params, "x", 0);
    int y = McBridgeApiUtils.getInt(params, "y", 0);
    int z = McBridgeApiUtils.getInt(params, "z", 0);

    BlockPos pos = new BlockPos(x, y, z);
    BlockEntity be = client.level.getBlockEntity(pos);
    if (!(be instanceof SignBlockEntity sign)) return JsonNull.INSTANCE;

    JsonObject out = new JsonObject();
    try {
      var frontText = ClientCompat.signText(sign, true);
      var backText = ClientCompat.signText(sign, false);
      JsonArray frontArr = new JsonArray();
      JsonArray backArr = new JsonArray();
      for (var line : frontText.getMessages(false)) frontArr.add(line.getString());
      for (var line : backText.getMessages(false)) backArr.add(line.getString());
      out.add("front", frontArr);
      out.add("back", backArr);
    } catch (Exception e) {
      out.addProperty("error", e.getMessage());
    }
    return out;
  }

  /** Serialise a small descriptor for a block. Used by findBlock/getBlockAt. */
  static JsonElement serializeBlockAt(Minecraft client, BlockPos pos) {
    return serializeBlockAtRaw(client, pos, false);
  }

  static JsonObject serializeBlockAtRaw(Minecraft client, BlockPos pos, boolean includeState) {
    JsonObject out = new JsonObject();
    BlockState state = client.level.getBlockState(pos);

    JsonObject p = new JsonObject();
    p.addProperty("x", pos.getX());
    p.addProperty("y", pos.getY());
    p.addProperty("z", pos.getZ());
    out.add("position", p);

    if (state == null) {
      out.addProperty("empty", true);
      return out;
    }

    String id = BuiltInRegistries.BLOCK.getKey(state.getBlock()).toString();
    out.addProperty("blockId", id);
    out.addProperty("name", state.getBlock().getName().getString());
    out.addProperty("empty", state.isAir());
    out.addProperty("isAir", state.isAir());
    out.addProperty("isLiquid", !state.getFluidState().isEmpty());
    out.addProperty("isSolid", state.isSolid());
    out.addProperty("hardness", state.getDestroySpeed(client.level, pos));
    out.addProperty("luminance", state.getLightEmission());

    if (includeState) out.add("state", stateProps(state));
    return out;
  }

  /** a block's properties as strings, e.g. {"age": "7"} */
  static JsonObject stateProps(BlockState state) {
    JsonObject props = new JsonObject();
    try {
      for (net.minecraft.world.level.block.state.properties.Property<?> prop : state.getProperties()) {
        props.addProperty(prop.getName(), String.valueOf(state.getValue(prop)));
      }
    } catch (Exception ignored) {}
    return props;
  }

}
