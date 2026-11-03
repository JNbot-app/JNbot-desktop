package com.jnbot.client.mixin;

import com.jnbot.client.proxy.ProxyServerList;
import net.minecraft.client.multiplayer.ServerData;
import net.minecraft.client.multiplayer.ServerList;
import org.spongepowered.asm.mixin.Final;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.Shadow;
import org.spongepowered.asm.mixin.Unique;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

import java.util.List;

/** Lists running JNbot proxies first, without saving them to servers.dat. */
@Mixin(ServerList.class)
public abstract class ServerListMixin {
  @Shadow @Final private List<ServerData> serverList;
  @Unique private List<ServerData> jnbot$proxyServers = List.of();

  @Inject(method = "load", at = @At("TAIL"))
  private void jnbot$addProxyServers(CallbackInfo ci) {
    ProxyServerList.addTo(serverList);
  }

  @Inject(method = "save", at = @At("HEAD"))
  private void jnbot$removeProxyServers(CallbackInfo ci) {
    jnbot$proxyServers = ProxyServerList.removeFrom(serverList);
  }

  @Inject(method = "save", at = @At("TAIL"))
  private void jnbot$restoreProxyServers(CallbackInfo ci) {
    serverList.addAll(0, jnbot$proxyServers);
    jnbot$proxyServers = List.of();
  }
}
