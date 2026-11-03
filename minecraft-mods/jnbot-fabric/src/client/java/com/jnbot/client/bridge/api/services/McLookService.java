package com.jnbot.client.bridge.api.services;

import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.jnbot.client.bridge.JnbotMcBridgeClient;
import com.jnbot.client.bridge.api.McBridgeApiUtils;
import java.util.UUID;
import net.minecraft.client.Minecraft;
import net.minecraft.world.phys.Vec3;

/** Tick-driven camera rotation with no per-frame bridge messages. */
public final class McLookService {
  public static final McLookService INSTANCE = new McLookService();

  private Rotation rotation;

  private McLookService() {}

  public synchronized JsonElement smoothLook(Minecraft client, JsonObject params) {
    if (client == null || client.player == null) return failed("no_client");
    float startYaw = client.player.getYRot();
    float startPitch = client.player.getXRot();
    boolean delta = "delta".equalsIgnoreCase(McBridgeApiUtils.getString(params, "mode", "absolute"));
    float targetYaw = (float) McBridgeApiUtils.getDouble(params, "yaw", startYaw);
    float targetPitch = (float) McBridgeApiUtils.getDouble(params, "pitch", startPitch);
    if (delta) {
      targetYaw += startYaw;
      targetPitch += startPitch;
    }
    return start(params, startYaw, startPitch, targetYaw, targetPitch);
  }

  public synchronized JsonElement smoothLookAt(Minecraft client, JsonObject params) {
    if (client == null || client.player == null) return failed("no_client");
    Vec3 eye = client.player.getEyePosition();
    double dx = McBridgeApiUtils.getDouble(params, "x", eye.x) - eye.x;
    double dy = McBridgeApiUtils.getDouble(params, "y", eye.y) - eye.y;
    double dz = McBridgeApiUtils.getDouble(params, "z", eye.z) - eye.z;
    double horizontal = Math.sqrt(dx * dx + dz * dz);
    float yaw = (float) Math.toDegrees(Math.atan2(-dx, dz));
    float pitch = (float) -Math.toDegrees(Math.atan2(dy, horizontal));
    return start(params, client.player.getYRot(), client.player.getXRot(), yaw, pitch);
  }

  private JsonObject start(JsonObject params, float startYaw, float startPitch,
                           float targetYaw, float targetPitch) {
    if (rotation != null) cancel("replaced", true);
    String taskId = McBridgeApiUtils.getString(params, "taskId", UUID.randomUUID().toString());
    int durationMs = Math.min(60_000, Math.max(0, McBridgeApiUtils.getInt(params, "durationMs", 500)));
    String easing = McBridgeApiUtils.getString(params, "easing", "easeInOut");
    rotation = new Rotation(taskId, startYaw, clampPitch(startPitch), targetYaw,
        clampPitch(targetPitch), durationMs, easing, System.currentTimeMillis());

    JsonObject out = new JsonObject();
    out.addProperty("ok", true);
    out.addProperty("taskId", taskId);
    out.addProperty("durationMs", durationMs);
    return out;
  }

  public synchronized JsonElement stop(Minecraft client, JsonObject params) {
    String requested = McBridgeApiUtils.getString(params, "taskId", "");
    if (rotation == null || (!requested.isBlank() && !requested.equals(rotation.taskId))) {
      return failed("task_not_found");
    }
    cancel("cancelled", true);
    JsonObject out = new JsonObject();
    out.addProperty("ok", true);
    return out;
  }

  public synchronized JsonElement status(Minecraft client, JsonObject params) {
    JsonObject out = new JsonObject();
    out.addProperty("active", rotation != null);
    if (rotation != null) {
      out.addProperty("taskId", rotation.taskId);
      out.addProperty("durationMs", rotation.durationMs);
      out.addProperty("elapsedMs", Math.max(0, System.currentTimeMillis() - rotation.startedAt));
    }
    return out;
  }

  public synchronized void tick(Minecraft client) {
    if (rotation == null) return;
    if (client == null || client.player == null) {
      cancel("no_client", true);
      return;
    }
    long elapsed = Math.max(0, System.currentTimeMillis() - rotation.startedAt);
    double progress = rotation.durationMs == 0 ? 1.0 : Math.min(1.0, elapsed / (double) rotation.durationMs);
    double eased = ease(progress, rotation.easing);
    float yawDelta = wrapDegrees(rotation.targetYaw - rotation.startYaw);
    float yaw = rotation.startYaw + yawDelta * (float) eased;
    float pitch = rotation.startPitch + (rotation.targetPitch - rotation.startPitch) * (float) eased;
    client.player.setYRot(yaw);
    client.player.setYHeadRot(yaw);
    client.player.setXRot(clampPitch(pitch));
    if (progress >= 1.0) {
      emit("mc.task.completed", rotation.taskId, "look", null);
      rotation = null;
    }
  }

  public synchronized void reset() {
    rotation = null;
  }

  public synchronized void cancelForManualInput() {
    if (rotation != null) cancel("input_override", true);
  }

  private void cancel(String reason, boolean emit) {
    if (rotation == null) return;
    if (emit) emit("mc.task.failed", rotation.taskId, "look", reason);
    rotation = null;
  }

  private static double ease(double value, String easing) {
    if ("linear".equalsIgnoreCase(easing)) return value;
    if ("easeIn".equalsIgnoreCase(easing)) return value * value;
    if ("easeOut".equalsIgnoreCase(easing)) return 1.0 - (1.0 - value) * (1.0 - value);
    return value < 0.5 ? 2.0 * value * value : 1.0 - Math.pow(-2.0 * value + 2.0, 2.0) / 2.0;
  }

  private static float clampPitch(float pitch) {
    return Math.max(-90.0f, Math.min(90.0f, pitch));
  }

  private static float wrapDegrees(float degrees) {
    return (degrees + 540.0f) % 360.0f - 180.0f;
  }

  private static void emit(String event, String taskId, String type, String reason) {
    JnbotMcBridgeClient bridge = JnbotMcBridgeClient.getInstance();
    if (!bridge.isEventSubscribed(event)) return;
    JsonObject data = new JsonObject();
    data.addProperty("taskId", taskId);
    data.addProperty("type", type);
    if (reason != null) data.addProperty("reason", reason);
    data.addProperty("ts", System.currentTimeMillis());
    bridge.sendEvent(event, data);
  }

  private static JsonObject failed(String reason) {
    JsonObject out = new JsonObject();
    out.addProperty("ok", false);
    out.addProperty("reason", reason);
    return out;
  }

  private record Rotation(String taskId, float startYaw, float startPitch, float targetYaw,
                          float targetPitch, int durationMs, String easing, long startedAt) {}
}
