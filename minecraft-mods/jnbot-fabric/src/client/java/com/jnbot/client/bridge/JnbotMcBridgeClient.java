package com.jnbot.client.bridge;

import com.google.gson.Gson;
import com.google.gson.JsonElement;
import com.google.gson.JsonNull;
import com.google.gson.JsonObject;
import com.jnbot.client.bridge.api.McBridgeApiRouter;
import com.jnbot.client.hud.ScriptProgressHudOverlay;
import com.jnbot.client.proxy.ProxyServerList;
import net.minecraft.SharedConstants;
import net.minecraft.client.Minecraft;
import net.minecraft.network.chat.Component;
import net.fabricmc.loader.api.FabricLoader;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.WebSocket;
import java.time.Duration;
import java.util.Objects;
import java.util.UUID;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicLong;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

public final class JnbotMcBridgeClient {
  private static final Gson GSON = new Gson();
  private static final JnbotMcBridgeClient INSTANCE = new JnbotMcBridgeClient();
  private static final Logger LOGGER = LoggerFactory.getLogger("JnbotMcBridge");

  private static final McBridgeApiRouter API = new McBridgeApiRouter();

  public static JnbotMcBridgeClient getInstance() {
    return INSTANCE;
  }

  private final AtomicLong requestCounter = new AtomicLong(1);
  private final ConcurrentHashMap<String, CompletableFuture<JsonObject>> pending = new ConcurrentHashMap<>();

  private final ScheduledExecutorService scheduler = Executors.newSingleThreadScheduledExecutor(r -> {
    Thread t = new Thread(r, "jnbot-mc-bridge");
    t.setDaemon(true);
    return t;
  });

  private volatile WebSocket webSocket;
  private volatile boolean started = false;
  private volatile boolean connecting = false;

  private volatile long lastConnectAttemptAt = 0;
  private volatile long lastConnectedAt = 0;

  private volatile String lastError = null;
  private volatile String connectionId = null;
  private volatile JnbotAppInfo appInfo = null;

  private final ConcurrentHashMap<String, Boolean> subscribedEvents = new ConcurrentHashMap<>();

  private JnbotMcBridgeClient() {}

  public boolean isConnected() {
    WebSocket ws = webSocket;
    return ws != null && !ws.isOutputClosed() && !ws.isInputClosed();
  }

  public boolean isConnecting() {
    return connecting;
  }

  public String getLastError() {
    return lastError;
  }

  public String getConnectionId() {
    return connectionId;
  }

  public JnbotAppInfo getAppInfo() {
    return appInfo;
  }

  public long getLastConnectedAt() {
    return lastConnectedAt;
  }

  public boolean isEventSubscribed(String event) {
    if (event == null || event.isBlank()) return false;
    return Boolean.TRUE.equals(subscribedEvents.get(event));
  }

  private void setEventSubscribed(String event, boolean subscribed) {
    if (event == null || event.isBlank()) return;
    if (subscribed) subscribedEvents.put(event, true);
    else subscribedEvents.remove(event);
  }

  public void start() {
    if (started) return;
    started = true;

    scheduler.schedule(this::connectWithBackoff, 0, TimeUnit.MILLISECONDS);
    scheduler.scheduleAtFixedRate(this::sendPing, 20, 20, TimeUnit.SECONDS);
  }

  public void requestAppInfo() {
    if (!isConnected()) return;
    request("app.getInfo", 5).thenAccept(this::parseAndStoreAppInfo);
  }

  /** Sends a request to the app; completes with the raw response message. */
  public CompletableFuture<JsonObject> request(String method, int timeoutSeconds) {
    if (!isConnected()) return CompletableFuture.failedFuture(new IllegalStateException("JNbot app is not connected"));

    final String id = String.valueOf(requestCounter.getAndIncrement());

    final JsonObject req = new JsonObject();
    req.addProperty("v", JnbotBridgeProtocol.PROTOCOL_VERSION);
    req.addProperty("type", JnbotBridgeProtocol.TYPE_REQUEST);
    req.addProperty("id", id);
    req.addProperty("method", method);

    CompletableFuture<JsonObject> future = new CompletableFuture<>();
    pending.put(id, future);

    sendJson(req);

    return future.orTimeout(timeoutSeconds, TimeUnit.SECONDS).whenComplete((res, err) -> pending.remove(id));
  }

  private void connectWithBackoff() {
    if (!started) return;
    if (isConnected() || connecting) return;

    connecting = true;
    lastConnectAttemptAt = System.currentTimeMillis();

    try {
      final URI uri = resolveServerUri();
      final HttpClient client = HttpClient.newBuilder()
          .connectTimeout(Duration.ofSeconds(3))
          .build();

      client.newWebSocketBuilder()
          .connectTimeout(Duration.ofSeconds(3))
          .buildAsync(uri, new Listener())
          .whenComplete((ws, err) -> {
            connecting = false;
            if (err != null) {
              lastError = String.valueOf(err.getMessage());
              scheduleReconnect();
              return;
            }
            webSocket = ws;
            lastError = null;
            lastConnectedAt = System.currentTimeMillis();
            sendHello();
            requestAppInfo();
          });

    } catch (Exception e) {
      connecting = false;
      lastError = String.valueOf(e.getMessage());
      scheduleReconnect();
    }
  }

  private void scheduleReconnect() {
    if (!started) return;
    long now = System.currentTimeMillis();
    long since = Math.max(0, now - lastConnectAttemptAt);
    long delay = Math.min(10_000, Math.max(500, 1500 - since));
    scheduler.schedule(this::connectWithBackoff, delay, TimeUnit.MILLISECONDS);
  }

  private void sendHello() {
    final Minecraft mc = Minecraft.getInstance();
    final String username = mc.getUser() != null ? mc.getUser().getName() : null;
    final String uuid = (mc.getUser() != null && mc.getUser().getProfileId() != null)
      ? mc.getUser().getProfileId().toString()
      : null;

    final String instanceId = System.getProperty("jnbot.bridge.instanceId");

    final JsonObject hello = new JsonObject();
    hello.addProperty("v", JnbotBridgeProtocol.PROTOCOL_VERSION);
    hello.addProperty("type", JnbotBridgeProtocol.TYPE_HELLO);
    hello.addProperty("clientId", buildClientId(username, uuid));
    if (instanceId != null && !instanceId.isBlank()) hello.addProperty("instanceId", instanceId);
    if (username != null) hello.addProperty("username", username);
    if (uuid != null) hello.addProperty("uuid", uuid);
    hello.addProperty("mcVersion", SharedConstants.getCurrentVersion().name());

    try {
      String modVersion = FabricLoader.getInstance()
        .getModContainer("jnbot")
        .map(c -> c.getMetadata().getVersion().getFriendlyString())
        .orElse(null);
      if (modVersion != null) hello.addProperty("modVersion", modVersion);
    } catch (Exception ignored) {}

    // Allow overriding server token from env var (optional)
    String token = System.getenv("JNBOT_MC_BRIDGE_TOKEN");
    if (token != null && !token.isBlank()) hello.addProperty("token", token);

    sendJson(hello);
  }

  private void sendResponse(String id, boolean ok, JsonElement result, String errorCode, String errorMessage, JsonElement errorDetails) {
    if (!isConnected()) return;

    JsonObject res = new JsonObject();
    res.addProperty("v", JnbotBridgeProtocol.PROTOCOL_VERSION);
    res.addProperty("type", JnbotBridgeProtocol.TYPE_RESPONSE);
    res.addProperty("id", id != null ? id : "0");
    res.addProperty("ok", ok);

    if (ok) {
      res.add("result", result != null ? result : JsonNull.INSTANCE);
    } else {
      JsonObject err = new JsonObject();
      err.addProperty("code", errorCode != null ? errorCode : "error");
      err.addProperty("message", errorMessage != null ? errorMessage : "Unknown error");
      if (errorDetails != null) err.add("details", errorDetails);
      res.add("error", err);
    }

    sendJson(res);
  }

  private void handleRequest(JsonObject req) {
    String id = req.has("id") ? req.get("id").getAsString() : "0";
    String method = req.has("method") ? req.get("method").getAsString() : null;
    JsonObject params = (req.has("params") && req.get("params").isJsonObject())
      ? req.getAsJsonObject("params")
      : new JsonObject();

    LOGGER.info("Received API request: method={}, id={}, params={}", method, id, params);

    if (method == null || method.isBlank()) {
      sendResponse(id, false, null, "invalid_request", "Missing method", null);
      return;
    }

    Minecraft mc = Minecraft.getInstance();
    mc.execute(() -> {
      try {
        JsonElement result = API.invoke(mc, method, params);
        sendResponse(id, true, result, null, null, null);
      } catch (McBridgeApiRouter.MethodNotFoundException e) {
        LOGGER.warn("API method not found: method={}", method, e);
        sendResponse(id, false, null, "method_not_found", e.getMessage(), null);
      } catch (Exception e) {
        LOGGER.error("API request failed: method={}", method, e);
        sendResponse(id, false, null, "exception", e.getMessage(), null);
      }
    });
  }

  public void sendSessionJoined(String serverKind, String serverAddress) {
    if (!isConnected()) return;
    JsonObject data = new JsonObject();
    data.addProperty("serverKind", serverKind);
    data.addProperty("serverAddress", serverAddress);

    JsonObject evt = new JsonObject();
    evt.addProperty("v", JnbotBridgeProtocol.PROTOCOL_VERSION);
    evt.addProperty("type", JnbotBridgeProtocol.TYPE_EVENT);
    evt.addProperty("name", "mc.session.joined");
    evt.add("data", data);
    sendJson(evt);
  }

  public void sendSessionLeft() {
    if (!isConnected()) return;
    JsonObject evt = new JsonObject();
    evt.addProperty("v", JnbotBridgeProtocol.PROTOCOL_VERSION);
    evt.addProperty("type", JnbotBridgeProtocol.TYPE_EVENT);
    evt.addProperty("name", "mc.session.left");
    sendJson(evt);
  }

  public void sendEvent(String name, JsonElement data) {
    if (!isConnected()) return;
    if (name == null || name.isBlank()) return;

    JsonObject evt = new JsonObject();
    evt.addProperty("v", JnbotBridgeProtocol.PROTOCOL_VERSION);
    evt.addProperty("type", JnbotBridgeProtocol.TYPE_EVENT);
    evt.addProperty("name", name);
    if (data != null) evt.add("data", data);
    sendJson(evt);
  }

  public void sendPasswordRequest(String serverKind, String serverAddress) {
    if (!isConnected()) return;

    JsonObject data = new JsonObject();
    data.addProperty("serverKind", serverKind != null ? serverKind : "unknown");
    data.addProperty("serverAddress", serverAddress != null ? serverAddress : "unknown");
    data.addProperty("ts", System.currentTimeMillis());

    JsonObject evt = new JsonObject();
    evt.addProperty("v", JnbotBridgeProtocol.PROTOCOL_VERSION);
    evt.addProperty("type", JnbotBridgeProtocol.TYPE_EVENT);
    evt.addProperty("name", "PASSWORD_REQUEST");
    evt.add("data", data);
    sendJson(evt);
  }

  private void sendPing() {
    if (!isConnected()) return;
    JsonObject ping = new JsonObject();
    ping.addProperty("v", JnbotBridgeProtocol.PROTOCOL_VERSION);
    ping.addProperty("type", JnbotBridgeProtocol.TYPE_PING);
    ping.addProperty("t", System.currentTimeMillis());
    sendJson(ping);
  }

  private void sendJson(JsonObject obj) {
    WebSocket ws = webSocket;
    if (ws == null) return;
    try {
      ws.sendText(GSON.toJson(obj), true);
    } catch (Exception e) {
      lastError = String.valueOf(e.getMessage());
    }
  }

  private URI resolveServerUri() {
    // Override via: -Djnbot.bridge.url=ws://127.0.0.1:17340
    String override = System.getProperty("jnbot.bridge.url");
    if (override != null && !override.isBlank()) {
      return URI.create(override);
    }

    String host = System.getenv("JNBOT_MC_BRIDGE_HOST");
    String port = System.getenv("JNBOT_MC_BRIDGE_PORT");
    if (host == null || host.isBlank()) host = "127.0.0.1";
    if (port == null || port.isBlank()) port = "17340";

    return URI.create("ws://" + host + ":" + port);
  }

  private static String buildClientId(String username, String uuid) {
    String u = username != null ? username : "unknown";
    String id = uuid != null ? uuid : UUID.nameUUIDFromBytes(u.getBytes()).toString();
    return u + ":" + id;
  }

  private void handleText(String text) {
    JsonObject obj;
    try {
      obj = GSON.fromJson(text, JsonObject.class);
    } catch (Exception e) {
      return;
    }

    if (obj == null) return;

    JsonElement vEl = obj.get("v");
    if (vEl == null || !vEl.isJsonPrimitive()) return;
    if (vEl.getAsInt() != JnbotBridgeProtocol.PROTOCOL_VERSION) return;

    String type = obj.has("type") ? obj.get("type").getAsString() : null;
    if (type == null) return;

    if (Objects.equals(type, JnbotBridgeProtocol.TYPE_HELLO_ACK)) {
      if (obj.has("connectionId")) connectionId = obj.get("connectionId").getAsString();
      return;
    }

    if (Objects.equals(type, JnbotBridgeProtocol.TYPE_PING)) {
      JsonObject pong = new JsonObject();
      pong.addProperty("v", JnbotBridgeProtocol.PROTOCOL_VERSION);
      pong.addProperty("type", JnbotBridgeProtocol.TYPE_PONG);
      if (obj.has("t")) pong.add("t", obj.get("t"));
      sendJson(pong);
      return;
    }

    if (Objects.equals(type, JnbotBridgeProtocol.TYPE_RESPONSE)) {
      String id = obj.has("id") ? obj.get("id").getAsString() : null;
      if (id == null) return;
      CompletableFuture<JsonObject> future = pending.get(id);
      if (future != null) {
        future.complete(obj);
      }
      return;
    }

    if (Objects.equals(type, JnbotBridgeProtocol.TYPE_REQUEST)) {
      handleRequest(obj);
      return;
    }

    if (Objects.equals(type, JnbotBridgeProtocol.TYPE_COMMAND)) {
      handleCommand(obj);
    }
  }

  private void parseAndStoreAppInfo(JsonObject response) {
    if (!response.has("ok") || !response.get("ok").getAsBoolean()) return;
    JsonElement resultEl = response.get("result");
    if (resultEl == null || !resultEl.isJsonObject()) return;

    JsonObject result = resultEl.getAsJsonObject();

    String productName = getString(result, "productName");
    String version = getString(result, "version");
    String platform = getString(result, "platform");
    long pid = getLong(result, "pid");
    long uptimeMs = getLong(result, "uptimeMs");

    String wsHost = null;
    int wsPort = 0;
    int clients = 0;

    if (result.has("websocket") && result.get("websocket").isJsonObject()) {
      JsonObject ws = result.getAsJsonObject("websocket");
      wsHost = getString(ws, "host");
      wsPort = (int) getLong(ws, "port");
    }

    if (result.has("clients") && result.get("clients").isJsonArray()) {
      clients = result.getAsJsonArray("clients").size();
    }

    this.appInfo = new JnbotAppInfo(productName, version, platform, pid, uptimeMs, wsHost, wsPort, clients);
  }

  private static String getString(JsonObject obj, String key) {
    if (!obj.has(key)) return null;
    JsonElement el = obj.get(key);
    if (el == null || !el.isJsonPrimitive()) return null;
    return el.getAsString();
  }

  private static long getLong(JsonObject obj, String key) {
    if (!obj.has(key)) return 0;
    JsonElement el = obj.get(key);
    if (el == null || !el.isJsonPrimitive()) return 0;
    try {
      return el.getAsLong();
    } catch (Exception e) {
      return 0;
    }
  }

  private void handleCommand(JsonObject cmd) {
    String name = cmd.has("name") ? cmd.get("name").getAsString() : null;
    if (name == null) return;

    JsonObject params = cmd.has("params") && cmd.get("params").isJsonObject()
        ? cmd.getAsJsonObject("params")
        : new JsonObject();

    Minecraft mc = Minecraft.getInstance();
    mc.execute(() -> {
      if ("mc.events.subscribe".equals(name)) {
        String event = getString(params, "event");



        if (event != null && !event.isBlank()) {
          setEventSubscribed(event, true);
        } 
        return;
      }

      if ("mc.events.unsubscribe".equals(name)) {
        String event = getString(params, "event");
        if (event != null && !event.isBlank()) {
          setEventSubscribed(event, false);
        } 
        return;
      }

      if ("hud.scriptProgress".equals(name)) {
        int scriptInstanceId = (int) getLong(params, "scriptInstanceId");
        String scriptName = getString(params, "scriptName");
        int current = (int) getLong(params, "current");
        int total = (int) getLong(params, "total");

        ScriptProgressHudOverlay.getInstance().update(scriptInstanceId, scriptName, current, total);
        return;
      }

      if ("hud.scriptProgress.remove".equals(name)) {
        int scriptInstanceId = (int) getLong(params, "scriptInstanceId");
        ScriptProgressHudOverlay.getInstance().remove(scriptInstanceId);
        return;
      }

      if ("proxy.servers".equals(name)) {
        ProxyServerList.update(params);
        return;
      }

      if ("chat.send".equals(name)) {
        String message = getString(params, "message");
        if (message != null && mc.player != null && mc.player.connection != null) {
          try {
            mc.player.connection.sendChat(message);
          } catch (Exception e) {
            // fallback: show locally
            mc.gui.getChat().addMessage(Component.literal("[JNbot] Failed to send chat: " + e.getMessage()));
          }
        }
        return;
      }

      if ("hud.title".equals(name)) {
        String title = getString(params, "title");
        String subtitle = getString(params, "subtitle");
        int fadeIn = (int) getLong(params, "fadeIn");
        int stay = (int) getLong(params, "stay");
        int fadeOut = (int) getLong(params, "fadeOut");

        if (title != null) mc.gui.setTitle(Component.literal(title));
        if (subtitle != null) mc.gui.setSubtitle(Component.literal(subtitle));
        if (fadeIn > 0 || stay > 0 || fadeOut > 0) {
          mc.gui.setTimes(fadeIn, stay, fadeOut);
        }
      }
    });
  }

  private final class Listener implements WebSocket.Listener {
    private final StringBuilder partial = new StringBuilder();

    @Override
    public void onOpen(WebSocket webSocket) {
      WebSocket.Listener.super.onOpen(webSocket);
      webSocket.request(1);
    }

    @Override
    public CompletionStage<?> onText(WebSocket webSocket, CharSequence data, boolean last) {
      partial.append(data);
      if (last) {
        String text = partial.toString();
        partial.setLength(0);
        handleText(text);
      }
      webSocket.request(1);
      return CompletableFuture.completedFuture(null);
    }

    @Override
    public CompletionStage<?> onClose(WebSocket webSocket, int statusCode, String reason) {
      JnbotMcBridgeClient.this.webSocket = null;
      connectionId = null;
      Minecraft.getInstance().execute(() -> ProxyServerList.update(new JsonObject()));
      scheduleReconnect();
      return WebSocket.Listener.super.onClose(webSocket, statusCode, reason);
    }

    @Override
    public void onError(WebSocket webSocket, Throwable error) {
      lastError = String.valueOf(error.getMessage());
      JnbotMcBridgeClient.this.webSocket = null;
      connectionId = null;
      Minecraft.getInstance().execute(() -> ProxyServerList.update(new JsonObject()));
      scheduleReconnect();
      WebSocket.Listener.super.onError(webSocket, error);
    }
  }
}
