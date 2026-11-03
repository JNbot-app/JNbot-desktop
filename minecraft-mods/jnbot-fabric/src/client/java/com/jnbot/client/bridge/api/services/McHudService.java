package com.jnbot.client.bridge.api.services;

import com.jnbot.client.compat.ClientCompat;
import com.google.gson.JsonElement;
import com.google.gson.JsonNull;
import com.google.gson.JsonObject;
import com.jnbot.client.bridge.api.McBridgeApiUtils;
import com.jnbot.client.hud.MarkerOverlay;
import com.jnbot.client.hud.ToastOverlay;
import net.minecraft.client.Minecraft;

/**
 * Surface for scripts to draw lightweight notifications and world markers on
 * the player's HUD. All of these are local-only — nothing crosses the wire
 * except the small request payload.
 */
public final class McHudService {

  public JsonElement toast(Minecraft client, JsonObject params) {
    String title = McBridgeApiUtils.getString(params, "title", "");
    String body = McBridgeApiUtils.getString(params, "body", null);
    String kind = McBridgeApiUtils.getString(params, "kind", "info");
    long duration = (long) McBridgeApiUtils.getDouble(params, "durationMs", 5000);

    ToastOverlay.getInstance().push(title, body, kind, duration);

    JsonObject out = new JsonObject();
    out.addProperty("ok", true);
    return out;
  }

  public JsonElement clearToasts(Minecraft client, JsonObject params) {
    ToastOverlay.getInstance().clear();
    return JsonNull.INSTANCE;
  }

  public JsonElement addMarker(Minecraft client, JsonObject params) {
    String id = McBridgeApiUtils.getString(params, "id", null);
    double x = McBridgeApiUtils.getDouble(params, "x", 0);
    double y = McBridgeApiUtils.getDouble(params, "y", 0);
    double z = McBridgeApiUtils.getDouble(params, "z", 0);
    String label = McBridgeApiUtils.getString(params, "label", "");
    String colorRaw = McBridgeApiUtils.getString(params, "color", null);
    long ttl = (long) McBridgeApiUtils.getDouble(params, "ttlMs", 0);
    int entityId = McBridgeApiUtils.getInt(params, "entityId", -1);

    int color = parseColor(colorRaw);
    String assignedId = MarkerOverlay.getInstance().add(id, x, y, z, label, color, ttl, entityId);

    JsonObject out = new JsonObject();
    out.addProperty("id", assignedId);
    return out;
  }

  public JsonElement removeMarker(Minecraft client, JsonObject params) {
    String id = McBridgeApiUtils.getString(params, "id", null);
    MarkerOverlay.getInstance().remove(id);
    return JsonNull.INSTANCE;
  }

  public JsonElement clearMarkers(Minecraft client, JsonObject params) {
    MarkerOverlay.getInstance().clear();
    return JsonNull.INSTANCE;
  }

  public JsonElement beep(Minecraft client, JsonObject params) {
    if (client == null || client.player == null) return JsonNull.INSTANCE;
    String soundId = McBridgeApiUtils.getString(params, "sound", "minecraft:block.note_block.pling");
    float volume = (float) McBridgeApiUtils.getDouble(params, "volume", 1.0);
    float pitch = (float) McBridgeApiUtils.getDouble(params, "pitch", 1.0);

    try {
      net.minecraft.resources.Identifier id = net.minecraft.resources.Identifier.tryParse(soundId);
      if (id == null) id = net.minecraft.resources.Identifier.tryParse("minecraft:block.note_block.pling");
      var event = net.minecraft.core.registries.BuiltInRegistries.SOUND_EVENT.getValue(id);
      if (event != null && client.level != null) {
        client.level.playSound(client.player, client.player, event,
            net.minecraft.sounds.SoundSource.MASTER, volume, pitch);
      }
    } catch (Exception ignored) {}

    JsonObject out = new JsonObject();
    out.addProperty("ok", true);
    return out;
  }

  /** Request attention from the OS (flashes the taskbar / dock). */
  public JsonElement flashWindow(Minecraft client, JsonObject params) {
    try {
      ClientCompat.requestWindowAttention(client);
    } catch (Exception ignored) {}
    JsonObject out = new JsonObject();
    out.addProperty("ok", true);
    return out;
  }

  private static int parseColor(String raw) {
    if (raw == null || raw.isBlank()) return 0;
    String s = raw.trim();
    try {
      if (s.startsWith("#")) {
        long v = Long.parseLong(s.substring(1), 16);
        // assume RGB, force opaque
        return (int) (0xFF000000L | (v & 0xFFFFFFL));
      }
      if (s.startsWith("0x") || s.startsWith("0X")) {
        return (int) Long.parseLong(s.substring(2), 16);
      }
      return Integer.parseInt(s);
    } catch (Exception e) {
      return 0;
    }
  }
}
