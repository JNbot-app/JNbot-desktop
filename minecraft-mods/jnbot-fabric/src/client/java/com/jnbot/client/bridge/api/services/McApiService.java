package com.jnbot.client.bridge.api.services;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.jnbot.client.bridge.api.McBridgeApiRouter;

import net.fabricmc.loader.api.FabricLoader;
import net.minecraft.client.Minecraft;

/**
 * Self-describing API surface so scripts can feature-detect. Both methods are
 * cheap and have no side effects.
 */
public final class McApiService {
  private final McBridgeApiRouter router;

  public McApiService(McBridgeApiRouter router) {
    this.router = router;
  }

  public JsonElement list(Minecraft client, JsonObject params) {
    JsonArray arr = new JsonArray();
    for (String m : router.methodNames()) arr.add(m);
    JsonObject out = new JsonObject();
    out.add("methods", arr);
    out.addProperty("count", arr.size());
    return out;
  }

  public JsonElement version(Minecraft client, JsonObject params) {
    JsonObject out = new JsonObject();
    out.addProperty("protocolVersion", com.jnbot.client.bridge.JnbotBridgeProtocol.PROTOCOL_VERSION);
    try {
      String modVersion = FabricLoader.getInstance()
          .getModContainer("jnbot")
          .map(c -> c.getMetadata().getVersion().getFriendlyString())
          .orElse("unknown");
      out.addProperty("modVersion", modVersion);
    } catch (Exception ignored) {
      out.addProperty("modVersion", "unknown");
    }
    try {
      out.addProperty("mcVersion", FabricLoader.getInstance().getModContainer("minecraft")
          .map(c -> c.getMetadata().getVersion().getFriendlyString())
          .orElse("unknown"));
    } catch (Exception ignored) {}
    return out;
  }

  public JsonElement capabilities(Minecraft client, JsonObject params) {
    JsonObject out = list(client, params).getAsJsonObject();
    JsonArray events = new JsonArray();
    for (String event : new String[] {
        "mc.chat", "mc.position", "mc.window.open", "mc.window.close", "mc.window.items",
        "mc.player.forcedTeleport", "mc.health.changed", "mc.death", "mc.respawn", "mc.kicked",
        "mc.player.stateChanged", "mc.player.heldItemChanged", "mc.player.effectsChanged",
        "mc.dimension.changed", "mc.pathfinder.arrived", "mc.pathfinder.failed",
        "mc.entity.spawned", "mc.entity.died", "mc.entity.despawned", "mc.block.changed", "mc.ui.action",
        "mc.task.completed", "mc.task.failed"
    }) events.add(event);
    out.add("events", events);
    JsonObject limits = new JsonObject();
    limits.addProperty("maxWorldScanRadius", 64);
    limits.addProperty("maxBlockWatchVolume", 4096);
    limits.addProperty("maxBlockChangesPerEvent", 128);
    limits.addProperty("maxEntityQueryResults", 128);
    limits.addProperty("maxMiningTargets", 4096);
    out.add("limits", limits);
    out.addProperty("binaryTransport", false);
    out.addProperty("taskCancellation", true);
    out.addProperty("declarativeUi", true);
    out.addProperty("flightPathfinding", true);
    out.addProperty("miningAutomation", true);
    out.addProperty("smoothLook", true);
    return out;
  }

  public JsonElement batch(Minecraft client, JsonObject params) throws Exception {
    JsonArray steps = params.has("steps") && params.get("steps").isJsonArray()
        ? params.getAsJsonArray("steps") : new JsonArray();
    if (steps.size() > 64) throw new IllegalArgumentException("A batch may contain at most 64 steps");
    JsonArray results = new JsonArray();
    for (JsonElement raw : steps) {
      if (!raw.isJsonObject()) throw new IllegalArgumentException("Invalid batch step");
      JsonObject step = raw.getAsJsonObject();
      String method = step.has("method") ? step.get("method").getAsString() : "";
      if (method.isBlank() || method.equals("mc.automation.batch")) {
        throw new IllegalArgumentException("Invalid batch method");
      }
      JsonObject stepParams = step.has("params") && step.get("params").isJsonObject()
          ? step.getAsJsonObject("params") : new JsonObject();
      results.add(router.invoke(client, method, stepParams));
    }
    JsonObject out = new JsonObject();
    out.add("results", results);
    return out;
  }
}
