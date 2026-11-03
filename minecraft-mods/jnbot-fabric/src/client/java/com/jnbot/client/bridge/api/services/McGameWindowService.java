package com.jnbot.client.bridge.api.services;

import com.jnbot.client.compat.ClientCompat;
import com.google.gson.JsonElement;
import com.google.gson.JsonNull;
import com.google.gson.JsonObject;
import com.jnbot.client.bridge.api.McBridgeApiUtils;
import com.mojang.blaze3d.platform.Window;
import net.minecraft.client.Minecraft;

/**
 * Operations on the Minecraft application window: title, fullscreen, current
 * size. Note: window resizing programmatically is intentionally limited —
 * GLFW resize hints exist but Minecraft owns the layout pipeline.
 */
public final class McGameWindowService {

  public JsonElement getInfo(Minecraft client, JsonObject params) {
    if (client == null) return JsonNull.INSTANCE;
    Window w = client.getWindow();
    if (w == null) return JsonNull.INSTANCE;

    JsonObject out = new JsonObject();
    out.addProperty("width", w.getScreenWidth());
    out.addProperty("height", w.getScreenHeight());
    out.addProperty("scaledWidth", w.getGuiScaledWidth());
    out.addProperty("scaledHeight", w.getGuiScaledHeight());
    out.addProperty("framebufferWidth", w.getWidth());
    out.addProperty("framebufferHeight", w.getHeight());
    out.addProperty("fullscreen", ClientCompat.isFullscreen(client));
    out.addProperty("scaleFactor", w.getGuiScale());
    try { out.addProperty("fps", client.getFps()); } catch (Exception ignored) {}
    return out;
  }

  public JsonElement setTitle(Minecraft client, JsonObject params) {
    if (client == null) return JsonNull.INSTANCE;
    Window w = client.getWindow();
    if (w == null) return JsonNull.INSTANCE;

    String title = McBridgeApiUtils.getString(params, "title", null);
    if (title == null || title.isBlank()) return JsonNull.INSTANCE;

    w.setTitle(title);
    return JsonNull.INSTANCE;
  }

  public JsonElement setFullscreen(Minecraft client, JsonObject params) {
    if (client == null) return JsonNull.INSTANCE;
    Window w = client.getWindow();
    if (w == null) return JsonNull.INSTANCE;

    boolean desired = McBridgeApiUtils.getBool(params, "fullscreen", !ClientCompat.isFullscreen(client));
    ClientCompat.setFullscreen(client, desired);
    return JsonNull.INSTANCE;
  }
}
