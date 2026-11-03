package com.jnbot.client.mixin;

import net.minecraft.client.gui.screens.multiplayer.JoinMultiplayerScreen;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.gen.Invoker;

@Mixin(JoinMultiplayerScreen.class)
public interface JoinMultiplayerScreenAccessor {
  @Invoker("refreshServerList")
  void jnbot$refreshServerList();
}
