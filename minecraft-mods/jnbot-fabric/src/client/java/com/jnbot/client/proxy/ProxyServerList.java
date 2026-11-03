package com.jnbot.client.proxy;

import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.jnbot.client.bridge.JnbotMcBridgeClient;
import com.jnbot.client.mixin.JoinMultiplayerScreenAccessor;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.screens.AlertScreen;
import net.minecraft.client.gui.screens.GenericMessageScreen;
import net.minecraft.client.gui.screens.multiplayer.JoinMultiplayerScreen;
import net.minecraft.client.multiplayer.ServerData;
import net.minecraft.network.chat.Component;

import java.util.ArrayList;
import java.util.List;

/**
 * JNbot proxies (pushed by the app as `proxy.servers`), shown at the top of the
 * multiplayer server list. An inactive entry asks the app to start the proxy
 * when joined. They are never written to servers.dat
 * ({@link com.jnbot.client.mixin.ServerListMixin}).
 */
public final class ProxyServerList {
  private static List<ServerData> servers = List.of();

  /** Marks proxy entries, so stale ones (from a list loaded before an update) are never saved either. */
  private static final class Entry extends ServerData {
    boolean active;

    Entry(String name, String address, boolean active) {
      super(name, address, Type.OTHER);
      this.active = active;
    }
  }

  private ProxyServerList() {}

  public static void update(JsonObject params) {
    List<ServerData> next = new ArrayList<>();
    if (params.has("servers") && params.get("servers").isJsonArray()) {
      for (JsonElement el : params.getAsJsonArray("servers")) {
        JsonObject server = el.getAsJsonObject();
        next.add(new Entry(
            server.get("name").getAsString(),
            server.get("address").getAsString(),
            server.has("active") && server.get("active").getAsBoolean()));
      }
    }
    if (next.isEmpty() && servers.isEmpty()) return;
    servers = List.copyOf(next);

    Minecraft client = Minecraft.getInstance();
    if (client.screen instanceof JoinMultiplayerScreenAccessor screen) {
      screen.jnbot$refreshServerList();
    }
  }

  /** Starts the proxy when an inactive entry is joined, then joins it. Returns whether it took over the join. */
  public static boolean startBeforeJoin(JoinMultiplayerScreen screen, ServerData data) {
    if (!(data instanceof Entry entry) || entry.active) return false;

    Minecraft client = Minecraft.getInstance();
    client.setScreen(new GenericMessageScreen(Component.literal("Starting JNbot proxy...")));
    JnbotMcBridgeClient.getInstance().request("proxy.start", 25).whenComplete((res, err) -> client.execute(() -> {
      if (err == null && res.has("ok") && res.get("ok").getAsBoolean()) {
        entry.ip = res.getAsJsonObject("result").get("address").getAsString();
        entry.active = true;
        screen.join(entry);
        return;
      }
      String reason = err != null ? err.getMessage()
          : res.has("error") ? res.getAsJsonObject("error").get("message").getAsString()
          : "Unknown error";
      client.setScreen(new AlertScreen(
          () -> client.setScreen(screen),
          Component.literal("Couldn't start the JNbot proxy"),
          Component.literal(String.valueOf(reason))));
    }));
    return true;
  }

  public static void addTo(List<ServerData> list) {
    list.addAll(0, servers);
  }

  /** Removes proxy entries, returning them in list order. */
  public static List<ServerData> removeFrom(List<ServerData> list) {
    List<ServerData> removed = new ArrayList<>();
    list.removeIf(server -> server instanceof Entry && removed.add(server));
    return removed;
  }
}
