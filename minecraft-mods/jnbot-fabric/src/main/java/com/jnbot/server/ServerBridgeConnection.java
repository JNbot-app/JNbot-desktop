package com.jnbot.server;

import com.google.gson.Gson;
import com.google.gson.JsonElement;
import com.google.gson.JsonNull;
import com.google.gson.JsonObject;
import net.fabricmc.loader.api.FabricLoader;
import net.minecraft.SharedConstants;
import net.minecraft.server.MinecraftServer;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.WebSocket;
import java.time.Duration;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;

public final class ServerBridgeConnection {
  private static final Logger LOGGER = LoggerFactory.getLogger("JnbotServerBridge");
  private static final Gson GSON = new Gson();
  private static final ServerBridgeConnection INSTANCE = new ServerBridgeConnection();
  private static final int PROTOCOL_VERSION = 1;

  public static ServerBridgeConnection getInstance() {
    return INSTANCE;
  }

  private final ScheduledExecutorService scheduler =
      Executors.newSingleThreadScheduledExecutor(runnable -> {
        Thread thread = new Thread(runnable, "jnbot-server-bridge");
        thread.setDaemon(true);
        return thread;
      });
  private final Set<String> subscribedEvents = ConcurrentHashMap.newKeySet();
  private final ServerApiRouter api = new ServerApiRouter(this);
  private volatile MinecraftServer server;
  private volatile WebSocket socket;
  private volatile boolean running;
  private volatile boolean connecting;
  private volatile boolean startedEventSent;

  private ServerBridgeConnection() {}

  public void start(MinecraftServer server) {
    this.server = server;
    if (running) return;
    running = true;
    startedEventSent = false;
    scheduler.execute(this::connect);
    scheduler.scheduleAtFixedRate(this::ping, 20, 20, TimeUnit.SECONDS);
  }

  public void stop() {
    running = false;
    subscribedEvents.clear();
    startedEventSent = false;
    WebSocket current = socket;
    socket = null;
    if (current != null) current.sendClose(1001, "Minecraft server stopping");
  }

  public void subscribe(String event) {
    if (event != null && !event.isBlank()) subscribedEvents.add(event);
  }

  public void unsubscribe(String event) {
    if (event != null) subscribedEvents.remove(event);
  }

  public void sendEvent(String name, JsonElement data) {
    if (!subscribedEvents.contains(name) && !name.equals("server.started")
        && !name.equals("server.stopping")) return;
    JsonObject event = base("event");
    event.addProperty("name", name);
    event.add("data", data != null ? data : JsonNull.INSTANCE);
    send(event);
  }

  private void connect() {
    if (!running || connecting || isConnected()) return;
    String serverId = System.getenv("JNBOT_MC_SERVER_ID");
    String token = System.getenv("JNBOT_MC_BRIDGE_TOKEN");
    if (serverId == null || serverId.isBlank() || token == null || token.isBlank()) {
      LOGGER.warn("Managed server bridge credentials are unavailable");
      return;
    }
    connecting = true;
    try {
      HttpClient client = HttpClient.newBuilder()
          .connectTimeout(Duration.ofSeconds(3))
          .build();
      client.newWebSocketBuilder()
          .connectTimeout(Duration.ofSeconds(3))
          .buildAsync(resolveUri(), new Listener())
          .whenComplete((connected, error) -> {
            connecting = false;
            if (error != null) {
              scheduleReconnect();
              return;
            }
            socket = connected;
            JsonObject hello = base("hello");
            hello.addProperty("kind", "managed-server");
            hello.addProperty("serverId", serverId);
            hello.addProperty("token", token);
            hello.addProperty("mcVersion", SharedConstants.getCurrentVersion().name());
            FabricLoader.getInstance().getModContainer("jnbot").ifPresent(container ->
                hello.addProperty("modVersion",
                    container.getMetadata().getVersion().getFriendlyString()));
            send(hello);
          });
    } catch (Exception error) {
      connecting = false;
      scheduleReconnect();
    }
  }

  private void scheduleReconnect() {
    if (running) scheduler.schedule(this::connect, 1500, TimeUnit.MILLISECONDS);
  }

  private boolean isConnected() {
    WebSocket current = socket;
    return current != null && !current.isInputClosed() && !current.isOutputClosed();
  }

  private URI resolveUri() {
    String host = System.getenv("JNBOT_MC_BRIDGE_HOST");
    String port = System.getenv("JNBOT_MC_BRIDGE_PORT");
    if (host == null || host.isBlank()) host = "127.0.0.1";
    if (port == null || port.isBlank()) port = "17340";
    return URI.create("ws://" + host + ":" + port);
  }

  private void ping() {
    if (!isConnected()) return;
    JsonObject ping = base("ping");
    ping.addProperty("t", System.currentTimeMillis());
    send(ping);
  }

  private void handle(String text) {
    JsonObject message;
    try {
      message = GSON.fromJson(text, JsonObject.class);
    } catch (Exception ignored) {
      return;
    }
    if (message == null || !message.has("v")
        || message.get("v").getAsInt() != PROTOCOL_VERSION) return;
    String type = message.has("type") ? message.get("type").getAsString() : "";
    if (type.equals("helloAck")) {
      if (!startedEventSent) {
        startedEventSent = true;
        JsonObject data = new JsonObject();
        data.addProperty("ts", System.currentTimeMillis());
        sendEvent("server.started", data);
      }
      return;
    }
    if (type.equals("ping")) {
      JsonObject pong = base("pong");
      if (message.has("t")) pong.add("t", message.get("t"));
      send(pong);
      return;
    }
    if (!type.equals("request")) return;
    String id = message.has("id") ? message.get("id").getAsString() : "0";
    String method = message.has("method") ? message.get("method").getAsString() : "";
    JsonObject params = message.has("params") && message.get("params").isJsonObject()
        ? message.getAsJsonObject("params") : new JsonObject();
    MinecraftServer current = server;
    if (current == null) {
      sendResponse(id, false, null, "server_not_running", "Server is not running");
      return;
    }
    current.execute(() -> {
      try {
        sendResponse(id, true, api.invoke(current, method, params), null, null);
      } catch (ServerApiRouter.MethodNotFound error) {
        sendResponse(id, false, null, "method_not_found", error.getMessage());
      } catch (Exception error) {
        LOGGER.error("Managed server API call failed: {}", method, error);
        sendResponse(id, false, null, "exception",
            error.getMessage() != null ? error.getMessage() : error.toString());
      }
    });
  }

  private void sendResponse(
      String id,
      boolean ok,
      JsonElement result,
      String code,
      String errorMessage
  ) {
    JsonObject response = base("response");
    response.addProperty("id", id);
    response.addProperty("ok", ok);
    if (ok) {
      response.add("result", result != null ? result : JsonNull.INSTANCE);
    } else {
      JsonObject error = new JsonObject();
      error.addProperty("code", code);
      error.addProperty("message", errorMessage);
      response.add("error", error);
    }
    send(response);
  }

  private JsonObject base(String type) {
    JsonObject message = new JsonObject();
    message.addProperty("v", PROTOCOL_VERSION);
    message.addProperty("type", type);
    return message;
  }

  private void send(JsonObject message) {
    WebSocket current = socket;
    if (current != null && !current.isOutputClosed())
      current.sendText(GSON.toJson(message), true);
  }

  private final class Listener implements WebSocket.Listener {
    private final StringBuilder text = new StringBuilder();

    @Override
    public void onOpen(WebSocket webSocket) {
      webSocket.request(1);
    }

    @Override
    public java.util.concurrent.CompletionStage<?> onText(
        WebSocket webSocket,
        CharSequence data,
        boolean last
    ) {
      text.append(data);
      if (last) {
        String complete = text.toString();
        text.setLength(0);
        handle(complete);
      }
      webSocket.request(1);
      return null;
    }

    @Override
    public java.util.concurrent.CompletionStage<?> onClose(
        WebSocket webSocket,
        int statusCode,
        String reason
    ) {
      socket = null;
      scheduleReconnect();
      return null;
    }

    @Override
    public void onError(WebSocket webSocket, Throwable error) {
      socket = null;
      scheduleReconnect();
    }
  }
}
