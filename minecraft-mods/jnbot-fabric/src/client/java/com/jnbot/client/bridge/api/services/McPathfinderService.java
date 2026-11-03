package com.jnbot.client.bridge.api.services;

import com.google.gson.JsonElement;
import com.google.gson.JsonNull;
import com.google.gson.JsonObject;
import com.jnbot.client.bridge.api.McBridgeApiUtils;
import com.jnbot.client.pathfinder.PathExecutor;
import com.jnbot.client.pathfinder.Pathfinder;
import net.minecraft.client.Minecraft;
import net.minecraft.core.BlockPos;

/**
 * mc.pathfinder.* — A* over the loaded world. The path stays on the client;
 * only path length + ETA is shipped over the websocket. Progress lands as
 * mc.pathfinder.arrived / mc.pathfinder.failed events.
 */
public final class McPathfinderService {
  public static final PathExecutor EXECUTOR = new PathExecutor();

  public JsonElement goTo(Minecraft client, JsonObject params) {
    if (client == null || client.player == null || client.level == null) return JsonNull.INSTANCE;

    int x = McBridgeApiUtils.getInt(params, "x", 0);
    int y = McBridgeApiUtils.getInt(params, "y", 0);
    int z = McBridgeApiUtils.getInt(params, "z", 0);
    Pathfinder.Movement movement = resolveMovement(client, McBridgeApiUtils.getString(params, "movement", "auto"));
    int defaultMaxNodes = movement == Pathfinder.Movement.FLY ? 30000 : 10000;
    int maxNodeLimit = movement == Pathfinder.Movement.FLY ? 100000 : 20000;
    double maxRangeLimit = movement == Pathfinder.Movement.FLY ? 512 : 256;
    int maxNodes = Math.min(maxNodeLimit, Math.max(64,
        McBridgeApiUtils.getInt(params, "maxNodes", defaultMaxNodes)));
    double maxRange = Math.min(maxRangeLimit, Math.max(2,
        McBridgeApiUtils.getDouble(params, "maxRange", 200)));
    boolean sprint = McBridgeApiUtils.getBool(params, "sprint", true);
    double arriveRadius = Math.max(0.5, McBridgeApiUtils.getDouble(params, "arriveRadius", 1.0));

    BlockPos start = client.player.blockPosition();
    BlockPos goal = new BlockPos(x, y, z);

    Pathfinder pathfinder = new Pathfinder(client.level, maxNodes, maxRange, movement);
    long t0 = System.nanoTime();
    Pathfinder.Result result = pathfinder.findPath(start, goal);
    long elapsedMs = (System.nanoTime() - t0) / 1_000_000;

    JsonObject out = new JsonObject();
    out.addProperty("ok", result.ok());
    out.addProperty("searchMs", elapsedMs);
    out.addProperty("visited", result.visitedNodes);

    if (!result.ok()) {
      out.addProperty("reason", result.failureReason);
      return out;
    }

    String taskId = McBridgeApiUtils.getString(params, "taskId", java.util.UUID.randomUUID().toString());
    EXECUTOR.start(result.path, sprint, arriveRadius, taskId, movement);

    out.addProperty("pathLength", result.path.size());
    out.addProperty("taskId", taskId);
    out.addProperty("movement", movement.name().toLowerCase());
    // Rough ETA at ~4.3 blocks/sec walking, ~5.6 b/s sprinting
    double bps = sprint ? 5.6 : 4.3;
    out.addProperty("etaMs", (long) Math.round(result.path.size() / bps * 1000.0));

    JsonObject startPos = new JsonObject();
    startPos.addProperty("x", result.path.get(0).getX());
    startPos.addProperty("y", result.path.get(0).getY());
    startPos.addProperty("z", result.path.get(0).getZ());
    out.add("start", startPos);

    BlockPos last = result.path.get(result.path.size() - 1);
    JsonObject endPos = new JsonObject();
    endPos.addProperty("x", last.getX());
    endPos.addProperty("y", last.getY());
    endPos.addProperty("z", last.getZ());
    out.add("end", endPos);

    return out;
  }

  public JsonElement stop(Minecraft client, JsonObject params) {
    String requested = McBridgeApiUtils.getString(params, "taskId", "");
    if (!requested.isBlank() && !requested.equals(EXECUTOR.taskId())) {
      JsonObject out = new JsonObject();
      out.addProperty("ok", false);
      out.addProperty("reason", "task_not_found");
      return out;
    }
    EXECUTOR.stop("cancelled");
    return JsonNull.INSTANCE;
  }

  public JsonElement status(Minecraft client, JsonObject params) {
    JsonObject out = new JsonObject();
    out.addProperty("active", EXECUTOR.isActive());
    out.addProperty("index", EXECUTOR.currentIndex());
    out.addProperty("pathLength", EXECUTOR.pathSize());
    if (EXECUTOR.taskId() != null) out.addProperty("taskId", EXECUTOR.taskId());
    out.addProperty("movement", EXECUTOR.movement());
    return out;
  }

  public JsonElement goToEntity(Minecraft client, JsonObject params) {
    if (client == null || client.level == null) return JsonNull.INSTANCE;
    var entity = client.level.getEntity(McBridgeApiUtils.getInt(params, "id", -1));
    if (entity == null) return failed("entity_not_found");
    JsonObject target = params.deepCopy();
    target.addProperty("x", entity.getBlockX());
    target.addProperty("y", entity.getBlockY());
    target.addProperty("z", entity.getBlockZ());
    target.addProperty("arriveRadius", McBridgeApiUtils.getDouble(params, "arriveRadius", 2));
    return goTo(client, target);
  }

  public JsonElement goToBlock(Minecraft client, JsonObject params) {
    JsonElement found = new McBlockService().findBlock(client, params);
    if (found == null || found.isJsonNull()) return failed("block_not_found");
    JsonObject position = found.getAsJsonObject().getAsJsonObject("position");
    JsonObject target = params.deepCopy();
    target.addProperty("x", position.get("x").getAsInt());
    target.addProperty("y", position.get("y").getAsInt());
    target.addProperty("z", position.get("z").getAsInt());
    target.addProperty("arriveRadius", McBridgeApiUtils.getDouble(params, "arriveRadius", 2));
    return goTo(client, target);
  }

  public JsonElement flee(Minecraft client, JsonObject params) {
    if (client == null || client.player == null) return JsonNull.INSTANCE;
    double x = McBridgeApiUtils.getDouble(params, "x", client.player.getX());
    double z = McBridgeApiUtils.getDouble(params, "z", client.player.getZ());
    double distance = Math.min(64, Math.max(2, McBridgeApiUtils.getDouble(params, "distance", 12)));
    double dx = client.player.getX() - x;
    double dz = client.player.getZ() - z;
    double len = Math.max(0.001, Math.sqrt(dx * dx + dz * dz));
    JsonObject target = params.deepCopy();
    target.addProperty("x", (int) Math.round(client.player.getX() + dx / len * distance));
    target.addProperty("y", client.player.getBlockY());
    target.addProperty("z", (int) Math.round(client.player.getZ() + dz / len * distance));
    return goTo(client, target);
  }

  private static JsonObject failed(String reason) {
    JsonObject out = new JsonObject();
    out.addProperty("ok", false);
    out.addProperty("reason", reason);
    out.addProperty("searchMs", 0);
    out.addProperty("visited", 0);
    return out;
  }

  private static Pathfinder.Movement resolveMovement(Minecraft client, String requested) {
    if ("fly".equalsIgnoreCase(requested)) return Pathfinder.Movement.FLY;
    if ("walk".equalsIgnoreCase(requested)) return Pathfinder.Movement.WALK;
    try {
      if (client != null && client.player != null && client.player.getAbilities().flying) {
        return Pathfinder.Movement.FLY;
      }
    } catch (Exception ignored) {}
    return Pathfinder.Movement.WALK;
  }
}
