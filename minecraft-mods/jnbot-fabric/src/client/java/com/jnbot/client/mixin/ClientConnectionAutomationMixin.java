package com.jnbot.client.mixin;

import com.jnbot.client.automation.AutomationRecorderController;
import net.minecraft.network.Connection;
import net.minecraft.network.protocol.Packet;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

@Mixin(Connection.class)
public abstract class ClientConnectionAutomationMixin {
  @Inject(method = "send(Lnet/minecraft/network/protocol/Packet;)V", at = @At("HEAD"))
  private void jnbot$recordScreenAction(Packet<?> packet, CallbackInfo ci) {
    AutomationRecorderController.INSTANCE.onPacket(packet);
  }
}
