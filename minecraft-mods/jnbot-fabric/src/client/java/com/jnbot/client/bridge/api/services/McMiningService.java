package com.jnbot.client.bridge.api.services;

import com.jnbot.client.compat.ClientCompat;
import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.jnbot.client.bridge.JnbotMcBridgeClient;
import com.jnbot.client.bridge.api.McBridgeApiUtils;
import com.jnbot.client.pathfinder.Pathfinder;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import net.minecraft.client.Minecraft;
import net.minecraft.core.BlockPos;
import net.minecraft.core.Direction;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.network.protocol.game.ServerboundSetCarriedItemPacket;
import net.minecraft.world.InteractionHand;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.phys.Vec3;

/** Stateful, tick-driven block mining tasks. */
public final class McMiningService {
  public static final McMiningService INSTANCE = new McMiningService();
  private static final int MAX_TARGETS = 4096;

  private MiningTask task;

  private McMiningService() {}

  public synchronized JsonElement mineBlock(Minecraft client, JsonObject params) {
    BlockPos target = position(params, null);
    if (target == null) return failed("invalid_position");
    MiningTask next = createTask(params, "block", 1);
    next.targets.add(target);
    return start(next);
  }

  public synchronized JsonElement mineNearest(Minecraft client, JsonObject params) {
    if (parseMatching(params).isEmpty()) return failed("matching_required");
    return start(createTask(params, "nearest", 1));
  }

  public synchronized JsonElement veinMine(Minecraft client, JsonObject params) {
    BlockPos origin = position(params, client != null && client.player != null ? client.player.blockPosition() : null);
    if (origin == null || client == null || client.level == null) return failed("invalid_position");
    MiningTask next = createTask(params, "vein", 64);
    if (next.matching.isEmpty()) {
      BlockState state = client.level.getBlockState(origin);
      if (state == null || state.isAir()) return failed("block_is_air");
      next.matching.add(BuiltInRegistries.BLOCK.getKey(state.getBlock()).toString());
    }
    collectVein(client, next, origin, McBridgeApiUtils.getBool(params, "diagonal", false));
    if (next.targets.isEmpty()) return failed("block_not_found");
    return start(next);
  }

  private JsonObject start(MiningTask next) {
    if (task != null) cancel("replaced", true);
    McEntityAutomationService.INSTANCE.reset();
    McLookService.INSTANCE.reset();
    if (McPathfinderService.EXECUTOR.isActive()) McPathfinderService.EXECUTOR.stop("replaced");
    task = next;
    JsonObject out = new JsonObject();
    out.addProperty("ok", true);
    out.addProperty("taskId", next.id);
    out.addProperty("type", next.type);
    return out;
  }

  public synchronized JsonElement stop(Minecraft client, JsonObject params) {
    String requested = McBridgeApiUtils.getString(params, "taskId", "");
    if (task == null || (!requested.isBlank() && !requested.equals(task.id))) return failed("task_not_found");
    cancel("cancelled", true);
    JsonObject out = new JsonObject();
    out.addProperty("ok", true);
    return out;
  }

  public synchronized JsonElement status(Minecraft client, JsonObject params) {
    JsonObject out = new JsonObject();
    out.addProperty("active", task != null);
    if (task == null) return out;
    out.addProperty("taskId", task.id);
    out.addProperty("type", task.type);
    out.addProperty("phase", task.phase);
    out.addProperty("mined", task.mined);
    out.addProperty("skipped", task.skipped);
    out.addProperty("queued", task.targets.size() + (task.current != null ? 1 : 0));
    if (task.current != null) out.add("current", jsonPosition(task.current));
    return out;
  }

  public synchronized void tick(Minecraft client) {
    if (task == null) return;
    if (client == null || client.player == null || client.level == null || client.gameMode == null) {
      fail("no_client");
      return;
    }

    if (task.maxBlocks > 0 && task.mined >= task.maxBlocks) {
      complete();
      return;
    }

    long now = System.currentTimeMillis();
    if (task.current == null) {
      if (task.targets.isEmpty() && task.allowScan) scanTargets(client, task);
      task.current = task.targets.pollFirst();
      task.breaking = false;
      task.navigating = false;
      task.blockStartedAt = now;
      if (task.current == null) {
        complete();
        return;
      }
    }

    BlockState state = client.level.getBlockState(task.current);
    if (state == null || state.isAir() || !matches(task.matching, state)) {
      if (task.breaking) task.mined++;
      task.current = null;
      task.phase = "selecting";
      return;
    }

    if (now - task.blockStartedAt > task.blockTimeoutMs) {
      skipCurrent(client, "block_timeout");
      return;
    }

    double distanceSq = client.player.getEyePosition().distanceToSqr(Vec3.atCenterOf(task.current));
    if (distanceSq > task.reach * task.reach) {
      navigateToCurrent(client);
      return;
    }

    task.navigating = false;
    task.phase = "mining";
    if (task.autoTool) selectBestTool(client, state);
    lookAt(client, Vec3.atCenterOf(task.current));
    Direction face = facingFrom(client.player.getEyePosition(), task.current);
    if (!task.breaking) {
      task.breaking = client.gameMode.startDestroyBlock(task.current, face);
    }
    boolean active = client.gameMode.continueDestroyBlock(task.current, face);
    if (active && client.player.tickCount % 4 == 0) ClientCompat.swing(client.player, InteractionHand.MAIN_HAND);
  }

  public synchronized void reset() {
    task = null;
  }

  public synchronized void cancelForManualInput() {
    if (task != null) cancel("input_override", true);
  }

  private void navigateToCurrent(Minecraft client) {
    task.phase = "approaching";
    if (McPathfinderService.EXECUTOR.isActive()) return;
    if (task.navigating) {
      skipCurrent(client, "unreachable");
      return;
    }
    BlockPos approach = findApproach(client, task.current, task.movement);
    JsonObject params = jsonPosition(approach != null ? approach : task.current);
    params.addProperty("movement", task.movement);
    params.addProperty("sprint", task.sprint);
    params.addProperty("arriveRadius", Math.max(0.75, task.reach - 1.0));
    params.addProperty("maxRange", task.maxRange);
    params.addProperty("taskId", task.id + ":path");
    JsonElement result = new McPathfinderService().goTo(client, params);
    task.navigating = result != null && result.isJsonObject()
        && result.getAsJsonObject().has("ok") && result.getAsJsonObject().get("ok").getAsBoolean();
    if (!task.navigating) skipCurrent(client, "unreachable");
  }

  private void skipCurrent(Minecraft client, String reason) {
    if (client != null && client.gameMode != null) client.gameMode.stopDestroyBlock();
    task.skipped++;
    task.current = null;
    task.breaking = false;
    task.navigating = false;
    task.phase = reason;
  }

  private void scanTargets(Minecraft client, MiningTask task) {
    List<BlockPos> found = new ArrayList<>();
    BlockPos origin = client.player.blockPosition();
    int remaining = task.maxBlocks > 0 ? Math.max(0, task.maxBlocks - task.mined) : MAX_TARGETS;
    int limit = Math.min(MAX_TARGETS, remaining);
    if (limit == 0) return;

    for (int y = origin.getY() - task.radius; y <= origin.getY() + task.radius && found.size() < MAX_TARGETS; y++) {
      if (client.level.isOutsideBuildHeight(y)) continue;
      for (int x = origin.getX() - task.radius; x <= origin.getX() + task.radius && found.size() < MAX_TARGETS; x++) {
        for (int z = origin.getZ() - task.radius; z <= origin.getZ() + task.radius && found.size() < MAX_TARGETS; z++) {
          BlockPos pos = new BlockPos(x, y, z);
          if (pos.distSqr(origin) > task.radius * task.radius) continue;
          BlockState state = client.level.getBlockState(pos);
          if (state != null && !state.isAir() && matches(task.matching, state)) found.add(pos);
        }
      }
    }
    found.sort(Comparator.comparingDouble(pos -> pos.distSqr(origin)));
    for (int i = 0; i < Math.min(limit, found.size()); i++) task.targets.add(found.get(i));
  }

  private static void collectVein(Minecraft client, MiningTask task, BlockPos origin, boolean diagonal) {
    ArrayDeque<BlockPos> open = new ArrayDeque<>();
    Set<BlockPos> visited = new HashSet<>();
    open.add(origin);
    int[][] directions = diagonal ? allDirections() : new int[][] {
        {1, 0, 0}, {-1, 0, 0}, {0, 1, 0}, {0, -1, 0}, {0, 0, 1}, {0, 0, -1}
    };
    int limit = Math.min(MAX_TARGETS, task.maxBlocks > 0 ? task.maxBlocks : 64);
    while (!open.isEmpty() && task.targets.size() < limit) {
      BlockPos pos = open.removeFirst();
      if (!visited.add(pos) || pos.distSqr(origin) > task.radius * task.radius) continue;
      BlockState state = client.level.getBlockState(pos);
      if (state == null || state.isAir() || !matches(task.matching, state)) continue;
      task.targets.add(pos);
      for (int[] direction : directions) open.add(pos.offset(direction[0], direction[1], direction[2]));
    }
  }

  private static int[][] allDirections() {
    List<int[]> directions = new ArrayList<>(26);
    for (int x = -1; x <= 1; x++) for (int y = -1; y <= 1; y++) for (int z = -1; z <= 1; z++) {
      if (x != 0 || y != 0 || z != 0) directions.add(new int[] {x, y, z});
    }
    return directions.toArray(int[][]::new);
  }

  private static BlockPos findApproach(Minecraft client, BlockPos target, String requestedMovement) {
    Pathfinder.Movement movement = resolveMovement(client, requestedMovement);
    Pathfinder pathfinder = new Pathfinder(client.level, 64, 16, movement);
    BlockPos best = null;
    double bestDistance = Double.MAX_VALUE;
    for (int y = -2; y <= 2; y++) for (int x = -2; x <= 2; x++) for (int z = -2; z <= 2; z++) {
      if (x == 0 && y == 0 && z == 0) continue;
      BlockPos candidate = target.offset(x, y, z);
      boolean valid = movement == Pathfinder.Movement.FLY
          ? pathfinder.isFlyable(candidate) : pathfinder.isStandable(candidate);
      if (!valid) continue;
      double distance = candidate.distSqr(client.player.blockPosition());
      if (distance < bestDistance) {
        best = candidate;
        bestDistance = distance;
      }
    }
    return best;
  }

  private static Pathfinder.Movement resolveMovement(Minecraft client, String movement) {
    if ("fly".equalsIgnoreCase(movement)) return Pathfinder.Movement.FLY;
    if ("walk".equalsIgnoreCase(movement)) return Pathfinder.Movement.WALK;
    return client.player.getAbilities().flying ? Pathfinder.Movement.FLY : Pathfinder.Movement.WALK;
  }

  private static void selectBestTool(Minecraft client, BlockState state) {
    int bestSlot = client.player.getInventory().getSelectedSlot();
    float bestSpeed = client.player.getInventory().getItem(bestSlot).getDestroySpeed(state);
    for (int slot = 0; slot < 9; slot++) {
      ItemStack stack = client.player.getInventory().getItem(slot);
      if (stack == null || stack.isEmpty()) continue;
      if (stack.isDamageableItem() && stack.getMaxDamage() - stack.getDamageValue() <= 1) continue;
      float speed = stack.getDestroySpeed(state);
      if (speed > bestSpeed) {
        bestSpeed = speed;
        bestSlot = slot;
      }
    }
    if (bestSlot != client.player.getInventory().getSelectedSlot()) {
      client.player.getInventory().setSelectedSlot(bestSlot);
      client.player.connection.send(new ServerboundSetCarriedItemPacket(bestSlot));
    }
  }

  private static void lookAt(Minecraft client, Vec3 target) {
    Vec3 eye = client.player.getEyePosition();
    double dx = target.x - eye.x;
    double dy = target.y - eye.y;
    double dz = target.z - eye.z;
    float yaw = (float) Math.toDegrees(Math.atan2(-dx, dz));
    float pitch = (float) -Math.toDegrees(Math.atan2(dy, Math.sqrt(dx * dx + dz * dz)));
    client.player.setYRot(yaw);
    client.player.setYHeadRot(yaw);
    client.player.setXRot(Math.max(-90, Math.min(90, pitch)));
  }

  private static Direction facingFrom(Vec3 eye, BlockPos block) {
    Vec3 delta = eye.subtract(Vec3.atCenterOf(block));
    return Direction.getApproximateNearest(delta.x, delta.y, delta.z);
  }

  private void cancel(String reason, boolean emit) {
    if (task == null) return;
    Minecraft client = Minecraft.getInstance();
    if (client != null && client.gameMode != null) client.gameMode.stopDestroyBlock();
    if (McPathfinderService.EXECUTOR.isActive()
        && (McPathfinderService.EXECUTOR.taskId() != null
        && McPathfinderService.EXECUTOR.taskId().startsWith(task.id))) {
      McPathfinderService.EXECUTOR.stop(reason);
    }
    if (emit) emit("mc.task.failed", task, reason);
    task = null;
  }

  private void complete() {
    emit("mc.task.completed", task, null);
    task = null;
  }

  private void fail(String reason) {
    emit("mc.task.failed", task, reason);
    task = null;
  }

  private static void emit(String event, MiningTask task, String reason) {
    if (task == null) return;
    JnbotMcBridgeClient bridge = JnbotMcBridgeClient.getInstance();
    if (!bridge.isEventSubscribed(event)) return;
    JsonObject data = new JsonObject();
    data.addProperty("taskId", task.id);
    data.addProperty("type", task.type);
    data.addProperty("mined", task.mined);
    data.addProperty("skipped", task.skipped);
    if (reason != null) data.addProperty("reason", reason);
    data.addProperty("ts", System.currentTimeMillis());
    bridge.sendEvent(event, data);
  }

  private static MiningTask createTask(JsonObject params, String type, int maxBlocksDefault) {
    String id = McBridgeApiUtils.getString(params, "taskId", UUID.randomUUID().toString());
    int maxBlocks = Math.min(MAX_TARGETS, Math.max(0, McBridgeApiUtils.getInt(params, "maxBlocks", maxBlocksDefault)));
    return new MiningTask(id, type, parseMatching(params), maxBlocks,
        Math.min(32, Math.max(1, McBridgeApiUtils.getInt(params, "maxDistance", 16))),
        Math.min(6.0, Math.max(3.0, McBridgeApiUtils.getDouble(params, "reach", 4.5))),
        Math.min(256, Math.max(8, McBridgeApiUtils.getDouble(params, "maxRange", 128))),
        McBridgeApiUtils.getBool(params, "autoTool", true),
        McBridgeApiUtils.getBool(params, "sprint", true),
        McBridgeApiUtils.getString(params, "movement", "auto"),
        Math.min(60_000, Math.max(1_000, McBridgeApiUtils.getInt(params, "blockTimeoutMs", 15_000))));
  }

  private static Set<String> parseMatching(JsonObject params) {
    Set<String> matching = new HashSet<>();
    if (params == null || !params.has("matching")) return matching;
    JsonElement raw = params.get("matching");
    if (raw.isJsonArray()) {
      JsonArray values = raw.getAsJsonArray();
      for (JsonElement value : values) if (value.isJsonPrimitive()) matching.add(value.getAsString().toLowerCase());
    } else if (raw.isJsonPrimitive()) {
      matching.add(raw.getAsString().toLowerCase());
    }
    return matching;
  }

  private static boolean matches(Set<String> matching, BlockState state) {
    if (matching.isEmpty()) return true;
    String id = BuiltInRegistries.BLOCK.getKey(state.getBlock()).toString().toLowerCase();
    int separator = id.indexOf(':');
    String shortId = separator >= 0 ? id.substring(separator + 1) : id;
    return matching.contains(id) || matching.contains(shortId);
  }

  private static BlockPos position(JsonObject params, BlockPos fallback) {
    if (params == null) return fallback;
    JsonObject value = params.has("position") && params.get("position").isJsonObject()
        ? params.getAsJsonObject("position") : params;
    if (!value.has("x") || !value.has("y") || !value.has("z")) return fallback;
    return new BlockPos(McBridgeApiUtils.getInt(value, "x", 0), McBridgeApiUtils.getInt(value, "y", 0),
        McBridgeApiUtils.getInt(value, "z", 0));
  }

  private static JsonObject jsonPosition(BlockPos pos) {
    JsonObject out = new JsonObject();
    out.addProperty("x", pos.getX());
    out.addProperty("y", pos.getY());
    out.addProperty("z", pos.getZ());
    return out;
  }

  private static JsonObject failed(String reason) {
    JsonObject out = new JsonObject();
    out.addProperty("ok", false);
    out.addProperty("reason", reason);
    return out;
  }

  private static final class MiningTask {
    final String id;
    final String type;
    final Set<String> matching;
    final int maxBlocks;
    final int radius;
    final double reach;
    final double maxRange;
    final boolean autoTool;
    final boolean sprint;
    final boolean allowScan;
    final String movement;
    final int blockTimeoutMs;
    final ArrayDeque<BlockPos> targets = new ArrayDeque<>();
    BlockPos current;
    boolean breaking;
    boolean navigating;
    int mined;
    int skipped;
    long blockStartedAt;
    String phase = "selecting";

    MiningTask(String id, String type, Set<String> matching, int maxBlocks, int radius, double reach,
               double maxRange, boolean autoTool, boolean sprint, String movement, int blockTimeoutMs) {
      this.id = id;
      this.type = type;
      this.matching = matching;
      this.maxBlocks = maxBlocks;
      this.radius = radius;
      this.reach = reach;
      this.maxRange = maxRange;
      this.autoTool = autoTool;
      this.sprint = sprint;
      this.allowScan = "nearest".equals(type);
      this.movement = movement;
      this.blockTimeoutMs = blockTimeoutMs;
    }
  }
}
