package com.jnbot.client.mixin;

import com.jnbot.client.proxy.ProxyHandshakeRecorder;
import io.netty.buffer.ByteBuf;
import io.netty.buffer.ByteBufUtil;
import io.netty.channel.ChannelHandlerContext;
import net.minecraft.network.PacketDecoder;
import net.minecraft.network.ProtocolInfo;
import net.minecraft.network.protocol.Packet;
import net.minecraft.network.protocol.PacketFlow;
import org.spongepowered.asm.mixin.Final;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.Shadow;
import org.spongepowered.asm.mixin.Unique;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

import java.util.List;

/** Hands each decoded clientbound packet, with its exact bytes, to the handshake recorder. */
@Mixin(PacketDecoder.class)
public abstract class PacketDecoderRawMixin {
  @Shadow @Final private ProtocolInfo<?> protocolInfo;
  @Unique private int jnbot$start;

  @Inject(method = "decode", at = @At("HEAD"))
  private void jnbot$markStart(ChannelHandlerContext ctx, ByteBuf in, List<Object> out, CallbackInfo ci) {
    jnbot$start = in.readerIndex();
  }

  @Inject(method = "decode", at = @At("RETURN"))
  private void jnbot$record(ChannelHandlerContext ctx, ByteBuf in, List<Object> out, CallbackInfo ci) {
    if (protocolInfo.flow() != PacketFlow.CLIENTBOUND || out.isEmpty()) return;
    if (!(out.get(out.size() - 1) instanceof Packet<?> packet)) return;
    int start = jnbot$start;
    int end = in.readerIndex();
    ProxyHandshakeRecorder.onDecoded(protocolInfo, packet, () -> ByteBufUtil.getBytes(in, start, end - start));
  }
}
