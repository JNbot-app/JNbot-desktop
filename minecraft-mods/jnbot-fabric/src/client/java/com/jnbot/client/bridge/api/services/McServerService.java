package com.jnbot.client.bridge.api.services;

import com.jnbot.client.compat.ClientCompat;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.jnbot.client.bridge.api.McBridgeApiUtils;
import net.minecraft.client.Minecraft;
import net.minecraft.client.server.IntegratedServer;

/** Controls the LAN endpoint of the currently loaded singleplayer world. */
public final class McServerService {
  public JsonElement status(Minecraft client, JsonObject params) {
    JsonObject result = new JsonObject();
    IntegratedServer server = client.getSingleplayerServer();
    boolean singleplayer = client.isLocalServer() && server != null;
    int port = singleplayer ? server.getPort() : -1;
    result.addProperty("singleplayer", singleplayer);
    result.addProperty("open", singleplayer && port > 0);
    if (port > 0) result.addProperty("port", port);
    return result;
  }

  public JsonElement openToLan(Minecraft client, JsonObject params) {
    JsonObject result = new JsonObject();
    IntegratedServer server = client.getSingleplayerServer();
    if (!client.isLocalServer() || server == null) {
      result.addProperty("ok", false);
      return result;
    }

    int currentPort = server.getPort();
    if (currentPort > 0) {
      result.addProperty("ok", true);
      result.addProperty("port", currentPort);
      result.addProperty("alreadyOpen", true);
      return result;
    }

    int port = McBridgeApiUtils.getInt(params, "port", 0);
    boolean cheatsAllowed = McBridgeApiUtils.getBool(params, "cheatsAllowed", false);
    if (port < 1 || port > 65535) {
      result.addProperty("ok", false);
      return result;
    }

    boolean opened = ClientCompat.publishLan(server, cheatsAllowed, port);
    result.addProperty("ok", opened);
    if (opened) result.addProperty("port", server.getPort());
    return result;
  }
}
