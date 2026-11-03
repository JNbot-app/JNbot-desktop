package com.jnbot.client.bridge.api.services;

import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.jnbot.client.bridge.api.McBridgeApiUtils;
import com.jnbot.client.screens.ScriptUiScreen;
import net.minecraft.client.Minecraft;

public final class McUiService {
  public JsonElement open(Minecraft client, JsonObject params) {
    JsonObject out = new JsonObject();
    if (client == null) {
      out.addProperty("ok", false);
      return out;
    }
    String id = McBridgeApiUtils.getString(params, "id", "plugin-ui");
    String title = McBridgeApiUtils.getString(params, "title", "Plugin controls");
    var elements = params.has("elements") && params.get("elements").isJsonArray()
        ? params.getAsJsonArray("elements") : new com.google.gson.JsonArray();
    client.setScreen(new ScriptUiScreen(client.screen, id, title, elements));
    out.addProperty("ok", true);
    out.addProperty("id", id);
    return out;
  }

  public JsonElement close(Minecraft client, JsonObject params) {
    JsonObject out = new JsonObject();
    if (client != null && client.screen instanceof ScriptUiScreen screen) {
      String id = McBridgeApiUtils.getString(params, "id", "");
      if (id.isBlank() || id.equals(screen.uiId())) screen.onClose();
    }
    out.addProperty("ok", true);
    return out;
  }
}
