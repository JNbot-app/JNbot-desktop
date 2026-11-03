package com.jnbot.client.bridge.api.services;

import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.jnbot.client.bridge.JnbotMcBridgeClient;
import com.jnbot.client.bridge.api.McBridgeApiUtils;
import java.util.UUID;
import net.minecraft.client.Minecraft;
import net.minecraft.world.entity.Entity;

/** One bounded entity automation task at a time, sharing the path executor. */
public final class McEntityAutomationService {
  public static final McEntityAutomationService INSTANCE = new McEntityAutomationService();

  private Task task;

  private McEntityAutomationService() {}

  public synchronized JsonElement follow(Minecraft client, JsonObject params) {
    return start(params, "follow");
  }

  public synchronized JsonElement attackUntilDead(Minecraft client, JsonObject params) {
    return start(params, "attack");
  }

  private JsonObject start(JsonObject params, String type) {
    int entityId = McBridgeApiUtils.getInt(params, "id", -1);
    if (entityId < 0) return failed("invalid_entity");
    if (task != null) cancel("replaced");
    String id = McBridgeApiUtils.getString(params, "taskId", UUID.randomUUID().toString());
    double distance = Math.max(1, McBridgeApiUtils.getDouble(params, "distance", "attack".equals(type) ? 3 : 2));
    task = new Task(id, type, entityId, distance, McBridgeApiUtils.getBool(params, "sprint", true));
    JsonObject out = new JsonObject();
    out.addProperty("ok", true);
    out.addProperty("taskId", id);
    return out;
  }

  public synchronized JsonElement stop(Minecraft client, JsonObject params) {
    String id = McBridgeApiUtils.getString(params, "taskId", "");
    if (task == null || (!id.isBlank() && !id.equals(task.id))) return failed("task_not_found");
    cancel("cancelled");
    JsonObject out = new JsonObject();
    out.addProperty("ok", true);
    return out;
  }

  public synchronized JsonElement status(Minecraft client, JsonObject params) {
    JsonObject out = new JsonObject();
    out.addProperty("active", task != null);
    if (task != null) {
      out.addProperty("taskId", task.id);
      out.addProperty("type", task.type);
      out.addProperty("entityId", task.entityId);
    }
    return out;
  }

  public synchronized void tick(Minecraft client) {
    if (task == null || client == null || client.player == null || client.level == null) return;
    Entity entity = client.level.getEntity(task.entityId);
    if (entity == null) {
      fail("entity_not_found");
      return;
    }
    if (!entity.isAlive()) {
      complete();
      return;
    }

    long now = System.currentTimeMillis();
    double distance = client.player.distanceTo(entity);
    if ("attack".equals(task.type) && distance <= task.distance && now - task.lastActionAt >= 500) {
      JsonObject target = new JsonObject();
      target.addProperty("id", entity.getId());
      new McEntityService().lookAt(client, target);
      new McEntityService().attack(client, target);
      task.lastActionAt = now;
      return;
    }

    if (distance > task.distance && now - task.lastPathAt >= 1000) {
      JsonObject target = new JsonObject();
      target.addProperty("id", entity.getId());
      target.addProperty("taskId", task.id);
      target.addProperty("arriveRadius", task.distance);
      target.addProperty("sprint", task.sprint);
      new McPathfinderService().goToEntity(client, target);
      task.lastPathAt = now;
    }
  }

  public synchronized void reset() {
    task = null;
  }

  private void cancel(String reason) {
    if (McPathfinderService.EXECUTOR.isActive()) McPathfinderService.EXECUTOR.stop(reason);
    task = null;
  }

  private void complete() {
    emit("mc.task.completed", null);
    task = null;
  }

  private void fail(String reason) {
    emit("mc.task.failed", reason);
    if (McPathfinderService.EXECUTOR.isActive()) McPathfinderService.EXECUTOR.stop(reason);
    task = null;
  }

  private void emit(String event, String reason) {
    if (task == null) return;
    JnbotMcBridgeClient bridge = JnbotMcBridgeClient.getInstance();
    if (!bridge.isEventSubscribed(event)) return;
    JsonObject data = new JsonObject();
    data.addProperty("taskId", task.id);
    data.addProperty("type", task.type);
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

  private static final class Task {
    final String id;
    final String type;
    final int entityId;
    final double distance;
    final boolean sprint;
    long lastPathAt;
    long lastActionAt;

    Task(String id, String type, int entityId, double distance, boolean sprint) {
      this.id = id;
      this.type = type;
      this.entityId = entityId;
      this.distance = distance;
      this.sprint = sprint;
    }
  }
}
