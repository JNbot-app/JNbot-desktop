package com.jnbot.client.proxy;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import net.minecraft.SharedConstants;
import net.minecraft.network.ConnectionProtocol;
import net.minecraft.network.ProtocolInfo;
import net.minecraft.network.protocol.Packet;

import java.util.ArrayList;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.function.Supplier;

/**
 * Keeps the wire bytes of the join handshake the server sent: the latest
 * configuration phase, login/respawn and session-wide play packets. The JNbot
 * proxy replays them verbatim to a bot taking over this connection, so nothing
 * here depends on the protocol version. Registry data is the exception: the
 * server may have omitted entries this client knows from its vanilla packs, so
 * it is re-packed in full at export time.
 */
public final class ProxyHandshakeRecorder {
  private static final Set<String> SKIPPED_CONFIGURATION =
      Set.of("minecraft:keep_alive", "minecraft:ping", "minecraft:finish_configuration");
  private static final Set<String> SINGLETONS = Set.of(
      "minecraft:change_difficulty",
      "minecraft:set_default_spawn_position",
      "minecraft:server_data",
      "minecraft:commands",
      "minecraft:initialize_border",
      "minecraft:set_time",
      "minecraft:update_tags");

  /** A null entry marks where the server sent its registry data. */
  private static final List<byte[]> configuration = new ArrayList<>();
  private static final Map<String, byte[]> singletons = new LinkedHashMap<>();
  private static byte[] login;
  private static byte[] respawn;
  private static ProtocolInfo<?> configurationProtocol;
  private static ProtocolInfo<?> play;

  private ProxyHandshakeRecorder() {}

  /** Called on the network thread for every decoded clientbound packet. */
  public static synchronized void onDecoded(ProtocolInfo<?> protocol, Packet<?> packet, Supplier<byte[]> raw) {
    String id = packet.type().id().toString();
    ConnectionProtocol phase = protocol.id();
    if (phase == ConnectionProtocol.LOGIN) {
      configuration.clear();
      singletons.clear();
      login = respawn = null;
      configurationProtocol = play = null;
    } else if (phase == ConnectionProtocol.CONFIGURATION) {
      configurationProtocol = protocol;
      if (id.equals("minecraft:registry_data")) {
        if (!configuration.contains(null)) configuration.add(null);
      } else if (!SKIPPED_CONFIGURATION.contains(id)) {
        configuration.add(raw.get());
      }
    } else if (phase == ConnectionProtocol.PLAY) {
      play = protocol;
      switch (id) {
        case "minecraft:start_configuration" -> {
          configuration.clear();
          singletons.clear();
        }
        case "minecraft:login" -> {
          login = raw.get();
          respawn = null;
        }
        case "minecraft:respawn" -> respawn = raw.get();
        default -> {
          if (SINGLETONS.contains(id)) singletons.put(id, raw.get());
        }
      }
    }
  }

  /** The play protocol of the current connection, used to encode the world bootstrap. */
  public static synchronized ProtocolInfo<?> play() {
    return play;
  }

  public static synchronized ProtocolInfo<?> configurationProtocol() {
    return configurationProtocol;
  }

  /** The snapshot header the proxy expects: protocol and raw handshake, with `registries` in place. */
  public static synchronized JsonObject snapshot(List<byte[]> registries) {
    if (login == null) throw new IllegalStateException("No world joined yet");
    List<byte[]> packets = new ArrayList<>();
    for (byte[] raw : configuration) {
      if (raw == null) packets.addAll(registries);
      else packets.add(raw);
    }
    JsonObject handshake = new JsonObject();
    handshake.add("configuration", encode(packets));
    handshake.addProperty("login", encode(login));
    if (respawn != null) handshake.addProperty("respawn", encode(respawn));
    handshake.add("singletons", encode(singletons.values()));

    JsonObject snapshot = new JsonObject();
    snapshot.addProperty("protocol", SharedConstants.getProtocolVersion());
    snapshot.addProperty("boundary", 0);
    snapshot.add("capabilities", new JsonArray());
    snapshot.add("handshake", handshake);
    return snapshot;
  }

  static String encode(byte[] raw) {
    return Base64.getEncoder().encodeToString(raw);
  }

  static JsonArray encode(Iterable<byte[]> packets) {
    JsonArray array = new JsonArray();
    for (byte[] raw : packets) array.add(encode(raw));
    return array;
  }
}
