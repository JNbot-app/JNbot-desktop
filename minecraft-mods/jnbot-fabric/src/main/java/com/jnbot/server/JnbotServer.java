package com.jnbot.server;

import com.google.gson.JsonObject;
import net.fabricmc.api.DedicatedServerModInitializer;
import net.fabricmc.fabric.api.event.lifecycle.v1.ServerLifecycleEvents;
import net.fabricmc.fabric.api.message.v1.ServerMessageEvents;
import net.fabricmc.fabric.api.networking.v1.ServerPlayConnectionEvents;

public final class JnbotServer implements DedicatedServerModInitializer {
  private final ServerBridgeConnection bridge = ServerBridgeConnection.getInstance();

  @Override
  public void onInitializeServer() {
    ServerLifecycleEvents.SERVER_STARTED.register(server -> {
      bridge.start(server);
    });
    ServerLifecycleEvents.SERVER_STOPPING.register(server -> {
      bridge.sendEvent("server.stopping", timestamp());
      bridge.stop();
    });
    ServerPlayConnectionEvents.JOIN.register((handler, sender, server) -> {
      JsonObject data = new JsonObject();
      data.add("player", ServerApiRouter.playerJson(handler.player));
      data.addProperty("ts", System.currentTimeMillis());
      bridge.sendEvent("server.player.join", data);
    });
    ServerPlayConnectionEvents.DISCONNECT.register((handler, server) -> {
      JsonObject data = new JsonObject();
      data.add("player", ServerApiRouter.playerJson(handler.player));
      data.addProperty("ts", System.currentTimeMillis());
      bridge.sendEvent("server.player.leave", data);
    });
    ServerMessageEvents.CHAT_MESSAGE.register((message, sender, params) -> {
      JsonObject data = new JsonObject();
      data.add("player", ServerApiRouter.playerJson(sender));
      data.addProperty("message", message.signedContent());
      data.addProperty("ts", System.currentTimeMillis());
      bridge.sendEvent("server.chat", data);
    });
  }

  private static JsonObject timestamp() {
    JsonObject data = new JsonObject();
    data.addProperty("ts", System.currentTimeMillis());
    return data;
  }
}
