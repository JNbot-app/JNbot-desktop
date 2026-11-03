package com.jnbot.server;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonNull;
import com.google.gson.JsonObject;
import com.mojang.brigadier.CommandDispatcher;
import net.fabricmc.loader.api.FabricLoader;
import net.minecraft.commands.CommandSource;
import net.minecraft.commands.CommandSourceStack;
import net.minecraft.core.BlockPos;
import net.minecraft.network.chat.Component;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.server.level.ServerPlayer;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;

public final class ServerApiRouter {
  public static final class MethodNotFound extends Exception {
    MethodNotFound(String method) {
      super("Unknown method: " + method);
    }
  }

  @FunctionalInterface
  private interface Handler {
    JsonElement handle(MinecraftServer server, JsonObject params) throws Exception;
  }

  private static final String[] EVENTS = {
      "server.started",
      "server.stopping",
      "server.player.join",
      "server.player.leave",
      "server.chat"
  };

  private final Map<String, Handler> methods = new LinkedHashMap<>();
  private final ServerBridgeConnection bridge;
  private final long startedAt = System.currentTimeMillis();

  ServerApiRouter(ServerBridgeConnection bridge) {
    this.bridge = bridge;
    register("server.status", this::status);
    register("server.command.execute", this::executeCommand);
    register("server.message.broadcast", this::broadcast);
    register("server.players.list", this::players);
    register("server.players.get", this::player);
    register("server.players.message", this::messagePlayer);
    register("server.players.kick", this::kickPlayer);
    register("server.worlds.list", this::worlds);
    register("server.worlds.get", this::world);
    register("server.api.list", this::apiList);
    register("server.api.version", this::apiVersion);
    register("server.api.capabilities", this::apiCapabilities);
    register("server.events.subscribe", this::subscribe);
    register("server.events.unsubscribe", this::unsubscribe);
  }

  JsonElement invoke(MinecraftServer server, String method, JsonObject params)
      throws Exception {
    Handler handler = methods.get(method);
    if (handler == null) throw new MethodNotFound(method);
    JsonElement result = handler.handle(server, params);
    return result != null ? result : JsonNull.INSTANCE;
  }

  private void register(String method, Handler handler) {
    methods.put(method, handler);
  }

  private JsonElement status(MinecraftServer server, JsonObject params) {
    JsonObject result = new JsonObject();
    result.addProperty("id", env("JNBOT_MC_SERVER_ID", "unknown"));
    result.addProperty("name", server.getMotd());
    result.addProperty("version", server.getServerVersion());
    result.addProperty("state", "online");
    result.addProperty("apiState", "online");
    result.addProperty("apiVersion", "1");
    result.addProperty("players", server.getPlayerList().getPlayers().size());
    result.addProperty("uptimeMs", System.currentTimeMillis() - startedAt);
    return result;
  }

  private JsonElement executeCommand(MinecraftServer server, JsonObject params)
      throws Exception {
    String command = required(params, "command").replaceFirst("^/", "");
    JsonArray output = new JsonArray();
    CommandSource collector = new CommandSource() {
      @Override
      public void sendSystemMessage(Component message) {
        output.add(message.getString());
      }

      @Override public boolean acceptsSuccess() { return true; }
      @Override public boolean acceptsFailure() { return true; }
      @Override public boolean shouldInformAdmins() { return false; }
    };
    CommandSourceStack source = server.createCommandSourceStack().withSource(collector);
    CommandDispatcher<CommandSourceStack> dispatcher =
        server.getCommands().getDispatcher();
    int resultCode = dispatcher.execute(command, source);
    JsonObject result = new JsonObject();
    result.addProperty("result", resultCode);
    result.add("output", output);
    return result;
  }

  private JsonElement broadcast(MinecraftServer server, JsonObject params) {
    server.getPlayerList().broadcastSystemMessage(Component.literal(required(params, "message")), false);
    return JsonNull.INSTANCE;
  }

  private JsonElement players(MinecraftServer server, JsonObject params) {
    JsonArray players = new JsonArray();
    for (ServerPlayer player : server.getPlayerList().getPlayers())
      players.add(playerJson(player));
    return players;
  }

  private JsonElement player(MinecraftServer server, JsonObject params) {
    ServerPlayer player = findPlayer(server, required(params, "player"));
    return player != null ? playerJson(player) : JsonNull.INSTANCE;
  }

  private JsonElement messagePlayer(MinecraftServer server, JsonObject params) {
    ServerPlayer player = requirePlayer(server, required(params, "player"));
    player.sendSystemMessage(Component.literal(required(params, "message")));
    return JsonNull.INSTANCE;
  }

  private JsonElement kickPlayer(MinecraftServer server, JsonObject params) {
    ServerPlayer player = requirePlayer(server, required(params, "player"));
    String reason = optional(params, "reason", "Kicked by a JNbot plugin");
    player.connection.disconnect(Component.literal(reason));
    return JsonNull.INSTANCE;
  }

  private JsonElement worlds(MinecraftServer server, JsonObject params) {
    JsonArray worlds = new JsonArray();
    for (ServerLevel world : server.getAllLevels()) {
      JsonObject entry = new JsonObject();
      String id = world.dimension().identifier().toString();
      entry.addProperty("id", id);
      entry.addProperty("name", id);
      worlds.add(entry);
    }
    return worlds;
  }

  private JsonElement world(MinecraftServer server, JsonObject params) {
    String requested = optional(params, "dimension", "");
    ServerLevel selected = null;
    for (ServerLevel world : server.getAllLevels()) {
      String id = world.dimension().identifier().toString();
      if (requested.isBlank() || requested.equals(id)) {
        selected = world;
        break;
      }
    }
    if (selected == null) throw new IllegalArgumentException("World not found");
    String id = selected.dimension().identifier().toString();
    JsonObject result = new JsonObject();
    result.addProperty("id", id);
    result.addProperty("name", id);
    result.addProperty("time", selected.getGameTime());
    //? if >=26.1 {
    /*result.addProperty("timeOfDay", selected.getDefaultClockTime());
    *///?} else
    result.addProperty("timeOfDay", selected.getDayTime());
    result.addProperty("difficulty", server.getWorldData().getDifficulty().getSerializedName());
    result.addProperty("raining", selected.isRaining());
    result.addProperty("thundering", selected.isThundering());
    result.addProperty("players", selected.players().size());
    BlockPos spawn = selected.getRespawnData().pos();
    JsonObject spawnJson = new JsonObject();
    spawnJson.addProperty("x", spawn.getX());
    spawnJson.addProperty("y", spawn.getY());
    spawnJson.addProperty("z", spawn.getZ());
    result.add("spawn", spawnJson);
    return result;
  }

  private JsonElement apiList(MinecraftServer server, JsonObject params) {
    JsonObject result = new JsonObject();
    result.add("methods", strings(methods.keySet().toArray(String[]::new)));
    result.add("events", strings(EVENTS));
    return result;
  }

  private JsonElement apiVersion(MinecraftServer server, JsonObject params) {
    JsonObject result = new JsonObject();
    result.addProperty("protocol", 1);
    result.addProperty("api", "1");
    result.addProperty("minecraft", server.getServerVersion());
    FabricLoader.getInstance().getModContainer("jnbot").ifPresent(container ->
        result.addProperty("mod",
            container.getMetadata().getVersion().getFriendlyString()));
    return result;
  }

  private JsonElement apiCapabilities(MinecraftServer server, JsonObject params) {
    return apiList(server, params);
  }

  private JsonElement subscribe(MinecraftServer server, JsonObject params) {
    bridge.subscribe(required(params, "event"));
    return JsonNull.INSTANCE;
  }

  private JsonElement unsubscribe(MinecraftServer server, JsonObject params) {
    bridge.unsubscribe(required(params, "event"));
    return JsonNull.INSTANCE;
  }

  public static JsonObject playerJson(ServerPlayer player) {
    JsonObject result = new JsonObject();
    result.addProperty("uuid", player.getStringUUID());
    result.addProperty("name", player.getName().getString());
    result.addProperty(
        "displayName",
        player.getDisplayName() == null
            ? player.getName().getString()
            : player.getDisplayName().getString()
    );
    result.addProperty("gameMode", player.gameMode().getSerializedName());
    result.addProperty(
        "dimension",
        player.level().dimension().identifier().toString()
    );
    JsonObject position = new JsonObject();
    position.addProperty("x", player.getX());
    position.addProperty("y", player.getY());
    position.addProperty("z", player.getZ());
    result.add("position", position);
    result.addProperty("latency", player.connection.latency());
    return result;
  }

  private static ServerPlayer findPlayer(MinecraftServer server, String value) {
    try {
      ServerPlayer byUuid =
          server.getPlayerList().getPlayer(UUID.fromString(value));
      if (byUuid != null) return byUuid;
    } catch (IllegalArgumentException ignored) {}
    return server.getPlayerList().getPlayerByName(value);
  }

  private static ServerPlayer requirePlayer(
      MinecraftServer server,
      String value
  ) {
    ServerPlayer player = findPlayer(server, value);
    if (player == null) throw new IllegalArgumentException("Player not found: " + value);
    return player;
  }

  private static JsonArray strings(String[] values) {
    JsonArray array = new JsonArray();
    for (String value : values) array.add(value);
    return array;
  }

  private static String required(JsonObject params, String key) {
    if (!params.has(key) || params.get(key).isJsonNull())
      throw new IllegalArgumentException("Missing " + key);
    String value = params.get(key).getAsString();
    if (value.isBlank()) throw new IllegalArgumentException("Missing " + key);
    return value;
  }

  private static String optional(JsonObject params, String key, String fallback) {
    return params.has(key) && !params.get(key).isJsonNull()
        ? params.get(key).getAsString() : fallback;
  }

  private static String env(String key, String fallback) {
    String value = System.getenv(key);
    return value == null || value.isBlank() ? fallback : value;
  }
}
