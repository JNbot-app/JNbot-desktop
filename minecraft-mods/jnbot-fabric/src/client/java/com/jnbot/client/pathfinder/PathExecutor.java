package com.jnbot.client.pathfinder;

import com.google.gson.JsonObject;
import com.jnbot.client.bridge.JnbotMcBridgeClient;
import com.mojang.blaze3d.platform.InputConstants;
import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.util.List;
import net.minecraft.client.KeyMapping;
import net.minecraft.client.Minecraft;
import net.minecraft.core.BlockPos;
import net.minecraft.world.phys.Vec3;

/**
 * Drives the player along a precomputed path each client tick. Holds forward,
 * steers yaw toward the next node, presses jump on upward steps, advances
 * when the player gets close enough.
 *
 * Lifecycle: start(path, settings) → tick() repeatedly → stop() / arrived.
 */
public final class PathExecutor {
  private static final double ARRIVE_DIST_SQ = 0.6 * 0.6;
  private static final int STUCK_TICKS = 60; // ~3s

  private List<BlockPos> path = null;
  private int index = 0;
  private long startedAtMs = 0;
  private boolean active = false;

  private double lastDistSq = Double.MAX_VALUE;
  private int stuckTicks = 0;
  private int brakedFlightIndex = -1;

  private boolean sprint = false;
  private Pathfinder.Movement movement = Pathfinder.Movement.WALK;
  private double arriveRadius = 1.0;
  private String taskId = null;

  public synchronized void start(List<BlockPos> path, boolean sprint, double arriveRadius, String taskId) {
    start(path, sprint, arriveRadius, taskId, Pathfinder.Movement.WALK);
  }

  public synchronized void start(List<BlockPos> path, boolean sprint, double arriveRadius, String taskId,
                                 Pathfinder.Movement movement) {
    this.path = path;
    this.index = path != null && path.size() > 1 ? 1 : 0;
    this.startedAtMs = System.currentTimeMillis();
    this.active = path != null && !path.isEmpty();
    this.sprint = sprint;
    this.movement = movement != null ? movement : Pathfinder.Movement.WALK;
    this.arriveRadius = Math.max(0.5, arriveRadius);
    this.taskId = taskId;
    this.lastDistSq = Double.MAX_VALUE;
    this.stuckTicks = 0;
    this.brakedFlightIndex = -1;
  }

  public synchronized boolean isActive() { return active; }

  public synchronized int currentIndex() { return index; }

  public synchronized int pathSize() { return path != null ? path.size() : 0; }
  public synchronized String taskId() { return taskId; }
  public synchronized String movement() { return movement.name().toLowerCase(); }

  public synchronized void stop(String reason) {
    if (!active) return;
    releaseKeys();
    stopFlightMomentum();
    active = false;

    JsonObject data = new JsonObject();
    data.addProperty("reason", reason != null ? reason : "cancelled");
    if (taskId != null) data.addProperty("taskId", taskId);
    data.addProperty("ts", System.currentTimeMillis());
    JnbotMcBridgeClient.getInstance().sendEvent("mc.pathfinder.failed", data);
  }

  /** Called every client tick. */
  public synchronized void tick(Minecraft client) {
    if (!active) return;
    if (client == null || client.player == null || client.level == null) {
      releaseKeys();
      active = false;
      return;
    }
    if (path == null || index >= path.size()) {
      finish();
      return;
    }

    BlockPos target = path.get(index);
    double tx = target.getX() + 0.5;
    double ty = target.getY();
    double tz = target.getZ() + 0.5;

    double px = client.player.getX();
    double py = client.player.getY();
    double pz = client.player.getZ();

    double dx = tx - px;
    double dz = tz - pz;
    double dy = ty - py;
    double distanceSq = dx * dx + dy * dy + dz * dz;

    if (movement == Pathfinder.Movement.FLY) {
      tickFlying(client, px, py, pz, dx, dy, dz, distanceSq);
      return;
    }

    if (distanceSq <= ARRIVE_DIST_SQ) {
      index++;
      stuckTicks = 0;
      lastDistSq = Double.MAX_VALUE;
      if (index >= path.size()) {
        finish();
        return;
      }
      target = path.get(index);
      tx = target.getX() + 0.5;
      ty = target.getY();
      tz = target.getZ() + 0.5;
      dx = tx - px;
      dz = tz - pz;
      dy = ty - py;
      distanceSq = dx * dx + dy * dy + dz * dz;
    }

    // Check on final goal — count "arrived" against arriveRadius
    if (index == path.size() - 1 && distanceSq <= arriveRadius * arriveRadius
        && (movement == Pathfinder.Movement.FLY || Math.abs(py - ty) <= 1.5)) {
      finish();
      return;
    }

    // Steer yaw
    float targetYaw = (float) Math.toDegrees(Math.atan2(-dx, dz));
    float yaw = approachAngle(client.player.getYRot(), targetYaw, 20.0f);
    client.player.setYRot(yaw);
    client.player.setYHeadRot(yaw);

    // Movement
    boolean horizontalMovement = dx * dx + dz * dz > 0.08;
    pressKey(client.options.keyUp, horizontalMovement);
    pressKey(client.options.keySprint, sprint);

    // Jump on upward steps
    boolean needJump = dy > 0.3;
    pressKey(client.options.keyJump, needJump);
    pressKey(client.options.keyShift, movement == Pathfinder.Movement.FLY && dy < -0.3);

    // Stuck detection (only if we are not making progress)
    if (Math.abs(lastDistSq - distanceSq) < 0.001 && !needJump) {
      stuckTicks++;
      if (stuckTicks > STUCK_TICKS) {
        stop("stuck");
        return;
      }
    } else {
      stuckTicks = 0;
      lastDistSq = distanceSq;
    }
  }

  private void tickFlying(Minecraft client, double px, double py, double pz,
                          double dx, double dy, double dz, double distanceSq) {
    ensureFlying(client);
    if (client.player.getAbilities().flying && client.player.onGround()) {
      pressKey(client.options.keyUp, false);
      pressKey(client.options.keyShift, false);
      pressKey(client.options.keyJump, true);
      return;
    }

    while (index < path.size() - 1 && !isTurnOrDestination(index)
        && passedNode(px, py, pz, path.get(index - 1), path.get(index))) {
      index++;
      stuckTicks = 0;
      lastDistSq = Double.MAX_VALUE;
    }

    BlockPos target = path.get(index);
    double tx = target.getX() + 0.5;
    double ty = target.getY();
    double tz = target.getZ() + 0.5;
    dx = tx - px;
    dy = ty - py;
    dz = tz - pz;
    distanceSq = dx * dx + dy * dy + dz * dz;

    Vec3 velocity = client.player.getDeltaMovement();
    double speed = velocity.length();
    if (brakedFlightIndex != index && isTurnOrDestination(index)
        && Math.sqrt(distanceSq) <= Math.max(1.0, speed * 2.0 + 0.5)) {
      stopFlightMomentum();
      brakedFlightIndex = index;
    }

    if (index == path.size() - 1 && distanceSq <= arriveRadius * arriveRadius) {
      stopFlightMomentum();
      finish();
      return;
    }

    if (index < path.size() - 1 && distanceSq <= ARRIVE_DIST_SQ) {
      index++;
      tickFlying(client, px, py, pz, dx, dy, dz, distanceSq);
      return;
    }

    double horizontalSq = dx * dx + dz * dz;
    if (horizontalSq > 0.04) {
      float targetYaw = (float) Math.toDegrees(Math.atan2(-dx, dz));
      float maxTurn = (float) Math.min(90.0, 25.0 + speed * 120.0);
      float yaw = approachAngle(client.player.getYRot(), targetYaw, maxTurn);
      client.player.setYRot(yaw);
      client.player.setYHeadRot(yaw);
    }

    pressKey(client.options.keyUp, horizontalSq > 0.04);
    pressKey(client.options.keySprint, sprint && horizontalSq > 0.04);
    pressKey(client.options.keyJump, client.player.onGround() || dy > 0.2);
    pressKey(client.options.keyShift, dy < -0.2);

    updateStuckState(distanceSq, false);
  }

  private boolean isTurnOrDestination(int nodeIndex) {
    if (nodeIndex >= path.size() - 1 || nodeIndex <= 0) return true;
    BlockPos previous = path.get(nodeIndex - 1);
    BlockPos current = path.get(nodeIndex);
    BlockPos next = path.get(nodeIndex + 1);
    int inX = Integer.signum(current.getX() - previous.getX());
    int inY = Integer.signum(current.getY() - previous.getY());
    int inZ = Integer.signum(current.getZ() - previous.getZ());
    int outX = Integer.signum(next.getX() - current.getX());
    int outY = Integer.signum(next.getY() - current.getY());
    int outZ = Integer.signum(next.getZ() - current.getZ());
    return inX != outX || inY != outY || inZ != outZ;
  }

  private static boolean passedNode(double px, double py, double pz, BlockPos previous, BlockPos target) {
    double segmentX = target.getX() - previous.getX();
    double segmentY = target.getY() - previous.getY();
    double segmentZ = target.getZ() - previous.getZ();
    double beyondX = px - (target.getX() + 0.5);
    double beyondY = py - target.getY();
    double beyondZ = pz - (target.getZ() + 0.5);
    return beyondX * segmentX + beyondY * segmentY + beyondZ * segmentZ >= 0.0;
  }

  private void updateStuckState(double distanceSq, boolean jumping) {
    if (distanceSq < lastDistSq - 0.002 || jumping) {
      lastDistSq = distanceSq;
      stuckTicks = 0;
      return;
    }
    if (++stuckTicks > STUCK_TICKS) stop("stuck");
  }

  private void finish() {
    releaseKeys();
    if (!active) return;
    active = false;

    JsonObject data = new JsonObject();
    data.addProperty("ts", System.currentTimeMillis());
    data.addProperty("durationMs", System.currentTimeMillis() - startedAtMs);
    data.addProperty("nodes", pathSize());
    if (taskId != null) data.addProperty("taskId", taskId);
    JnbotMcBridgeClient.getInstance().sendEvent("mc.pathfinder.arrived", data);
  }

  private void releaseKeys() {
    Minecraft mc = Minecraft.getInstance();
    if (mc == null || mc.options == null) return;
    pressKey(mc.options.keyUp, false);
    pressKey(mc.options.keySprint, false);
    pressKey(mc.options.keyJump, false);
    pressKey(mc.options.keyShift, false);
  }

  private void stopFlightMomentum() {
    if (movement != Pathfinder.Movement.FLY) return;
    Minecraft client = Minecraft.getInstance();
    if (client != null && client.player != null) client.player.setDeltaMovement(Vec3.ZERO);
  }

  private static void ensureFlying(Minecraft client) {
    var abilities = client.player.getAbilities();
    if (abilities.mayfly && !abilities.flying) {
      abilities.flying = true;
      client.player.onUpdateAbilities();
    }
  }

  private static float approachAngle(float current, float target, float maxDelta) {
    float delta = (target - current + 540.0f) % 360.0f - 180.0f;
    return current + Math.max(-maxDelta, Math.min(maxDelta, delta));
  }

  private static void pressKey(KeyMapping binding, boolean pressed) {
    if (binding == null) return;
    InputConstants.Key key = resolveKey(binding);
    if (key != null) KeyMapping.set(key, pressed);
    binding.setDown(pressed);
  }

  private static InputConstants.Key resolveKey(KeyMapping binding) {
    try {
      Method m = KeyMapping.class.getMethod("getBoundKey");
      Object v = m.invoke(binding);
      if (v instanceof InputConstants.Key k) return k;
    } catch (Exception ignored) {}
    for (String name : new String[]{"boundKey", "defaultKey"}) {
      try {
        Field f = KeyMapping.class.getDeclaredField(name);
        f.setAccessible(true);
        Object v = f.get(binding);
        if (v instanceof InputConstants.Key k) return k;
      } catch (Exception ignored) {}
    }
    return null;
  }
}
