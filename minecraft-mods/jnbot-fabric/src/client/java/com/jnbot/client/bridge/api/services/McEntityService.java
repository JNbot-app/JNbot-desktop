package com.jnbot.client.bridge.api.services;

import com.jnbot.client.compat.ClientCompat;
import com.google.gson.JsonElement;
import com.google.gson.JsonNull;
import com.google.gson.JsonObject;
import com.jnbot.client.bridge.api.McBridgeApiUtils;
import net.minecraft.client.Minecraft;
import net.minecraft.world.InteractionHand;
import net.minecraft.world.entity.Entity;
import com.jnbot.client.bridge.api.EntityJson;

public final class McEntityService {

  public JsonElement attack(Minecraft client, JsonObject params) {
    if (client == null || client.player == null || client.gameMode == null || client.level == null)
      return failed("no_client");

    int id = McBridgeApiUtils.getInt(params, "id", -1);
    Entity target = findEntity(client, id);
    if (target == null) return failed("entity_not_found");

    client.gameMode.attack(client.player, target);
    ClientCompat.swing(client.player, InteractionHand.MAIN_HAND);
    return ok();
  }

  public JsonElement use(Minecraft client, JsonObject params) {
    if (client == null || client.player == null || client.gameMode == null || client.level == null)
      return failed("no_client");

    int id = McBridgeApiUtils.getInt(params, "id", -1);
    String handRaw = McBridgeApiUtils.getString(params, "hand", "main");
    InteractionHand hand = "off".equalsIgnoreCase(handRaw) ? InteractionHand.OFF_HAND : InteractionHand.MAIN_HAND;

    Entity target = findEntity(client, id);
    if (target == null) return failed("entity_not_found");

    ClientCompat.interact(client, target, hand);
    ClientCompat.swing(client.player, hand);
    return ok();
  }

  /** Detailed info for a single entity by id — health/equipment when applicable. */
  public JsonElement getById(Minecraft client, JsonObject params) {
    if (client == null || client.level == null) return JsonNull.INSTANCE;
    int id = McBridgeApiUtils.getInt(params, "id", -1);
    Entity e = findEntity(client, id);
    if (e == null) return JsonNull.INSTANCE;

    return EntityJson.serialize(client, e, true);
  }

  public JsonElement find(Minecraft client, JsonObject params) {
    com.google.gson.JsonArray entities = new com.google.gson.JsonArray();
    JsonObject out = new JsonObject();
    out.add("entities", entities);
    if (client == null || client.player == null || client.level == null) return out;

    String type = McBridgeApiUtils.getString(params, "type", "");
    String name = McBridgeApiUtils.getString(params, "name", "").toLowerCase();
    double radius = Math.min(256, Math.max(1, McBridgeApiUtils.getDouble(params, "radius", 32)));
    int limit = Math.min(128, Math.max(1, McBridgeApiUtils.getInt(params, "limit", 32)));
    Boolean hostile = McBridgeApiUtils.getOptionalBool(params, "hostile");
    java.util.List<Entity> matches = new java.util.ArrayList<>();
    for (Entity entity : client.level.entitiesForRendering()) {
      if (entity == client.player || !entity.isAlive()) continue;
      if (client.player.distanceTo(entity) > radius) continue;
      String entityType = net.minecraft.core.registries.BuiltInRegistries.ENTITY_TYPE.getKey(entity.getType()).toString();
      if (!type.isBlank() && !entityType.equals(type) && !entityType.endsWith(":" + type)) continue;
      if (!name.isBlank() && !entity.getName().getString().toLowerCase().contains(name)) continue;
      if (hostile != null && hostile != (entity instanceof net.minecraft.world.entity.monster.Monster)) continue;
      matches.add(entity);
    }
    matches.sort(java.util.Comparator.comparingDouble(client.player::distanceTo));
    for (int i = 0; i < Math.min(limit, matches.size()); i++) {
      entities.add(EntityJson.serialize(client, matches.get(i), false));
    }
    out.addProperty("total", matches.size());
    return out;
  }

  public JsonElement nearest(Minecraft client, JsonObject params) {
    JsonObject found = find(client, params).getAsJsonObject();
    com.google.gson.JsonArray entities = found.getAsJsonArray("entities");
    return entities == null || entities.isEmpty() ? JsonNull.INSTANCE : entities.get(0);
  }

  public JsonElement lookAt(Minecraft client, JsonObject params) {
    if (client == null || client.player == null) return failed("no_client");
    Entity target = findEntity(client, McBridgeApiUtils.getInt(params, "id", -1));
    if (target == null) return failed("entity_not_found");
    JsonObject point = new JsonObject();
    point.addProperty("x", target.getX());
    point.addProperty("y", target.getEyeY());
    point.addProperty("z", target.getZ());
    return new McPlayerActionService().lookAt(client, point);
  }

  static Entity findEntity(Minecraft client, int id) {
    if (client.level == null || id < 0) return null;
    return client.level.getEntity(id);
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
}
