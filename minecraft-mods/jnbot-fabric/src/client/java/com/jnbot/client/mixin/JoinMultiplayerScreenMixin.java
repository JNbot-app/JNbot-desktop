package com.jnbot.client.mixin;

import com.jnbot.client.proxy.ProxyServerList;
import net.minecraft.client.gui.screens.multiplayer.JoinMultiplayerScreen;
import net.minecraft.client.multiplayer.ServerData;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

/** Starts the JNbot proxy before joining its entry while it isn't running. */
@Mixin(JoinMultiplayerScreen.class)
public abstract class JoinMultiplayerScreenMixin {
  @Inject(method = "join", at = @At("HEAD"), cancellable = true)
  private void jnbot$startProxy(ServerData data, CallbackInfo ci) {
    if (ProxyServerList.startBeforeJoin((JoinMultiplayerScreen) (Object) this, data)) ci.cancel();
  }
}
