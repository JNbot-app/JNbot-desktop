package com.jnbot.client.proxy;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import io.netty.buffer.ByteBuf;
import io.netty.buffer.ByteBufUtil;
import io.netty.buffer.Unpooled;
import net.minecraft.client.Minecraft;
import net.minecraft.client.multiplayer.ClientLevel;
import net.minecraft.client.multiplayer.ClientPacketListener;
import net.minecraft.core.RegistryAccess;
import net.minecraft.core.RegistrySynchronization;
import net.minecraft.nbt.NbtOps;
import net.minecraft.client.player.LocalPlayer;
import net.minecraft.network.ProtocolInfo;
import net.minecraft.network.codec.StreamCodec;
import net.minecraft.network.protocol.Packet;
import net.minecraft.network.protocol.configuration.ClientboundRegistryDataPacket;
import net.minecraft.network.protocol.game.ClientboundChunkBatchFinishedPacket;
import net.minecraft.network.protocol.game.ClientboundChunkBatchStartPacket;
import net.minecraft.network.protocol.game.ClientboundContainerSetContentPacket;
import net.minecraft.network.protocol.game.ClientboundGameEventPacket;
import net.minecraft.network.protocol.game.ClientboundLevelChunkWithLightPacket;
import net.minecraft.network.protocol.game.ClientboundPlayerAbilitiesPacket;
import net.minecraft.network.protocol.game.ClientboundPlayerPositionPacket;
import net.minecraft.network.protocol.game.ClientboundSetChunkCacheCenterPacket;
import net.minecraft.network.protocol.game.ClientboundSetExperiencePacket;
import net.minecraft.network.protocol.game.ClientboundSetHealthPacket;
import net.minecraft.network.protocol.game.ClientboundSetHeldSlotPacket;
import net.minecraft.world.entity.PositionMoveRotation;
import net.minecraft.world.inventory.InventoryMenu;
import net.minecraft.world.level.chunk.LevelChunk;

import java.util.ArrayList;
import java.util.List;
import java.util.Set;

/**
 * Exports this client's state for a bot taking over its proxy connection: the
 * recorded handshake plus the current world as clientbound packets, encoded
 * with the connection's own protocol. Entities are not exported; the server
 * re-sends them as they move.
 */
final class ProxyStateExport {
  private ProxyStateExport() {}

  static JsonObject export(Minecraft mc) {
    LocalPlayer player = mc.player;
    ClientLevel level = mc.level;
    ClientPacketListener connection = mc.getConnection();
    ProtocolInfo<?> play = ProxyHandshakeRecorder.play();
    ProtocolInfo<?> configuration = ProxyHandshakeRecorder.configurationProtocol();
    if (player == null || level == null || connection == null || play == null || configuration == null)
      throw new IllegalStateException("Not in a world");

    int centerX = player.getBlockX() >> 4;
    int centerZ = player.getBlockZ() >> 4;
    List<Packet<?>> packets = new ArrayList<>();
    packets.add(new ClientboundGameEventPacket(ClientboundGameEventPacket.LEVEL_CHUNKS_LOAD_START, 0));
    packets.add(new ClientboundSetChunkCacheCenterPacket(centerX, centerZ));
    packets.add(new ClientboundPlayerPositionPacket(0, PositionMoveRotation.of(player), Set.of()));

    packets.add(ClientboundChunkBatchStartPacket.INSTANCE);
    int radius = mc.options.getEffectiveRenderDistance() + 1;
    int chunks = 0;
    for (int x = centerX - radius; x <= centerX + radius; x++) {
      for (int z = centerZ - radius; z <= centerZ + radius; z++) {
        LevelChunk chunk = level.getChunkSource().getChunkNow(x, z);
        if (chunk == null) continue;
        packets.add(new ClientboundLevelChunkWithLightPacket(chunk, level.getLightEngine(), null, null));
        chunks++;
      }
    }
    packets.add(new ClientboundChunkBatchFinishedPacket(chunks));

    InventoryMenu inventory = player.inventoryMenu;
    packets.add(new ClientboundContainerSetContentPacket(
        inventory.containerId, inventory.getStateId(), inventory.getItems(), inventory.getCarried()));
    packets.add(new ClientboundSetHealthPacket(
        player.getHealth(), player.getFoodData().getFoodLevel(), player.getFoodData().getSaturationLevel()));
    packets.add(new ClientboundSetExperiencePacket(
        player.experienceProgress, player.totalExperience, player.experienceLevel));
    packets.add(new ClientboundPlayerAbilitiesPacket(player.getAbilities()));
    packets.add(new ClientboundSetHeldSlotPacket(player.getInventory().getSelectedSlot()));

    JsonArray bootstrap = new JsonArray();
    for (Packet<?> packet : packets) bootstrap.add(ProxyHandshakeRecorder.encode(encode(play, packet)));

    // Every entry with its data, as a server sends it to a client that knows no packs.
    List<byte[]> registries = new ArrayList<>();
    RegistryAccess registryAccess = connection.registryAccess();
    // Like the server: entries reference other registries (e.g. timelines), so the ops need the lookup.
    RegistrySynchronization.packRegistries(registryAccess.createSerializationContext(NbtOps.INSTANCE), registryAccess, Set.of(),
        (key, entries) -> registries.add(encode(configuration, new ClientboundRegistryDataPacket(key, entries))));

    JsonObject snapshot = ProxyHandshakeRecorder.snapshot(registries);
    snapshot.add("bootstrap", bootstrap);
    return snapshot;
  }

  /** The packet's wire bytes (id + body) in `protocol`. */
  private static byte[] encode(ProtocolInfo<?> protocol, Packet<?> packet) {
    @SuppressWarnings("unchecked")
    StreamCodec<ByteBuf, Packet<?>> codec = (StreamCodec<ByteBuf, Packet<?>>) (StreamCodec<?, ?>) protocol.codec();
    ByteBuf buffer = Unpooled.buffer();
    try {
      codec.encode(buffer, packet);
      return ByteBufUtil.getBytes(buffer);
    } finally {
      buffer.release();
    }
  }
}
