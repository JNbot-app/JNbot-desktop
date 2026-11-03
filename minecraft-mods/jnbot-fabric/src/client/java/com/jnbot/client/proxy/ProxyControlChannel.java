package com.jnbot.client.proxy;

import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import io.netty.buffer.ByteBuf;
import net.fabricmc.fabric.api.client.networking.v1.ClientPlayConnectionEvents;
import net.fabricmc.fabric.api.client.networking.v1.ClientPlayNetworking;
import net.fabricmc.fabric.api.networking.v1.PacketSender;
import net.fabricmc.fabric.api.networking.v1.PayloadTypeRegistry;
import net.minecraft.client.Minecraft;
import net.minecraft.client.player.LocalPlayer;
import net.minecraft.network.codec.StreamCodec;
import net.minecraft.network.protocol.common.ServerboundCustomPayloadPacket;
import net.minecraft.network.protocol.common.custom.CustomPacketPayload;
import net.minecraft.resources.Identifier;

import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.function.Consumer;

/**
 * The JNbot proxy's private `jnbot:proxy` channel. Through it the proxy can
 * hand this client's connection to a bot: on `capture` the client exports its
 * state ({@link ProxyStateExport}) in parts small enough for a serverbound
 * payload. While a bot drives, `state_sync` keeps this client at its position.
 * The proxy also pushes the sessions this client can move to ({@link ProxySessionsScreen})
 * and a status line drawn by {@link ProxyStatusHud}, e.g. while spectating.
 */
public final class ProxyControlChannel {
  /** Stays below the 32767-byte serverbound custom payload limit after JSON escaping. */
  private static final int PART_CHARS = 24_000;
  private static String nonce;
  private static List<Session> sessions = List.of();
  private static String currentSession;
  private static String status;

  /** A proxy session: one server connection, played by `driver` (null when nobody plays). */
  public record Session(String id, String account, String version, String driver, int players, boolean joinable) {}

  public record Payload(byte[] data) implements CustomPacketPayload {
    static final Type<Payload> TYPE = new Type<>(Identifier.fromNamespaceAndPath("jnbot", "proxy"));
    static final StreamCodec<ByteBuf, Payload> CODEC = StreamCodec.of(
        (buffer, payload) -> buffer.writeBytes(payload.data),
        buffer -> {
          byte[] data = new byte[buffer.readableBytes()];
          buffer.readBytes(data);
          return new Payload(data);
        });

    @Override
    public Type<Payload> type() {
      return TYPE;
    }
  }

  private ProxyControlChannel() {}

  public static void register() {
    PayloadTypeRegistry.playS2C().register(Payload.TYPE, Payload.CODEC);
    PayloadTypeRegistry.playC2S().register(Payload.TYPE, Payload.CODEC);
    ClientPlayNetworking.registerGlobalReceiver(Payload.TYPE, (payload, context) -> receive(context.client(), context.responseSender(), payload));
    ClientPlayConnectionEvents.DISCONNECT.register((handler, client) -> {
      nonce = currentSession = status = null;
      sessions = List.of();
    });
  }

  /** Whether this client is connected through a JNbot proxy. */
  public static boolean linked() {
    return nonce != null;
  }

  public static List<Session> sessions() {
    return sessions;
  }

  public static String currentSession() {
    return currentSession;
  }

  /** The line the proxy wants on screen, or null. */
  public static String status() {
    return status;
  }

  /** Ask the proxy to move this client into another session. */
  public static void join(String sessionId) {
    if (nonce == null) return;
    send(ClientPlayNetworking.getSender(), "join", reply -> reply.addProperty("sessionId", sessionId));
  }

  /** Runs on the client thread in packet order, so replies follow every earlier packet. */
  private static void receive(Minecraft mc, PacketSender sender, Payload payload) {
    JsonObject message;
    try {
      message = JsonParser.parseString(new String(payload.data(), StandardCharsets.UTF_8)).getAsJsonObject();
    } catch (RuntimeException e) {
      return;
    }
    String type = string(message, "type");
    if ("enable".equals(type)) {
      nonce = string(message, "nonce");
      send(sender, "ready", reply -> reply.addProperty("provider", "inline"));
      return;
    }
    if (nonce == null || !nonce.equals(string(message, "nonce")) || type == null) return;
    switch (type) {
      case "barrier" -> send(sender, "barrier", reply -> reply.add("id", message.get("id")));
      case "capture" -> capture(mc, sender, message.get("id"));
      case "state_sync" -> sync(mc.player, message.getAsJsonObject("player"));
      case "sessions" -> updateSessions(message);
      case "status" -> status = string(message, "text");
      default -> {}
    }
  }

  private static void capture(Minecraft mc, PacketSender sender, JsonElement id) {
    String snapshot;
    try {
      snapshot = ProxyStateExport.export(mc).toString();
    } catch (RuntimeException e) {
      send(sender, "capture_error", reply -> {
        reply.add("id", id);
        reply.addProperty("message", String.valueOf(e.getMessage()));
      });
      return;
    }
    for (int i = 0; i < snapshot.length(); i += PART_CHARS) {
      String part = snapshot.substring(i, Math.min(snapshot.length(), i + PART_CHARS));
      send(sender, "capture_part", reply -> {
        reply.add("id", id);
        reply.addProperty("data", part);
      });
    }
    send(sender, "capture_end", reply -> reply.add("id", id));
  }

  private static void updateSessions(JsonObject message) {
    currentSession = string(message, "current");
    List<Session> list = new ArrayList<>();
    for (JsonElement element : message.getAsJsonArray("sessions")) {
      JsonObject session = element.getAsJsonObject();
      list.add(new Session(
          string(session, "id"),
          string(session, "account"),
          string(session, "version"),
          string(session, "driver"),
          (int) number(session, "players", 0),
          session.has("joinable") && session.get("joinable").getAsBoolean()));
    }
    sessions = List.copyOf(list);
  }

  private static void sync(LocalPlayer player, JsonObject state) {
    if (player == null || state == null) return;
    JsonObject position = state.getAsJsonObject("position");
    if (position != null) {
      player.snapTo(
          number(position, "x", player.getX()),
          number(position, "y", player.getY()),
          number(position, "z", player.getZ()),
          (float) number(position, "yaw", player.getYRot()),
          (float) number(position, "pitch", player.getXRot()));
    }
    if (state.has("selectedSlot")) player.getInventory().setSelectedSlot(state.get("selectedSlot").getAsInt());
  }

  /**
   * Sent as a plain custom payload: the proxy never registers channels, so Fabric's send would refuse.
   * Goes through the handler's sender, not `mc.getConnection()`: that is null until the login packet,
   * and the proxy offers `enable` as soon as configuration finishes.
   */
  private static void send(PacketSender sender, String type, Consumer<JsonObject> fill) {
    JsonObject message = new JsonObject();
    message.addProperty("type", type);
    message.addProperty("nonce", nonce);
    fill.accept(message);
    byte[] data = message.toString().getBytes(StandardCharsets.UTF_8);
    sender.sendPacket(new ServerboundCustomPayloadPacket(new Payload(data)));
  }

  private static String string(JsonObject object, String key) {
    JsonElement value = object.get(key);
    return value != null && value.isJsonPrimitive() ? value.getAsString() : null;
  }

  private static double number(JsonObject object, String key, double fallback) {
    JsonElement value = object.get(key);
    return value != null && value.isJsonPrimitive() ? value.getAsDouble() : fallback;
  }
}
