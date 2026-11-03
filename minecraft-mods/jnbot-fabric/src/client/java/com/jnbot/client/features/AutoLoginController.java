package com.jnbot.client.features;

import com.jnbot.client.bridge.JnbotMcBridgeClient;
import com.jnbot.client.config.JnbotClientConfigStore;
import net.minecraft.client.Minecraft;

public final class AutoLoginController {
  private static final AutoLoginController INSTANCE = new AutoLoginController();

  public static AutoLoginController getInstance() {
    return INSTANCE;
  }

  private volatile boolean pending = false;
  private volatile long nextAttemptAtMs = 0;
  private volatile long giveUpAtMs = 0;
  private volatile boolean hasAttemptedForCurrentServer = false;

  private String serverKind;
  private String serverAddress;

  private AutoLoginController() {}

  public void onSessionJoined(String serverKind, String serverAddress) {
    if (!JnbotClientConfigStore.getInstance().get().isAutoLoginEnabled()) return;
    if (serverKind == null || !"multiplayer".equals(serverKind)) return;
    if (hasAttemptedForCurrentServer) return;

    this.serverKind = serverKind;
    this.serverAddress = serverAddress;

    long now = System.currentTimeMillis();
    this.pending = true;
    this.nextAttemptAtMs = now + 1000;
    this.giveUpAtMs = now + 15000;
    this.hasAttemptedForCurrentServer = true;
  }

  public void onSessionLeft() {
    this.pending = false;
    this.hasAttemptedForCurrentServer = false;
    this.serverKind = null;
    this.serverAddress = null;
  }

  public void tick(Minecraft client) {
    if (!JnbotClientConfigStore.getInstance().get().isAutoLoginEnabled()) {
      pending = false;
      return;
    }
    if (!pending) return;

    long now = System.currentTimeMillis();
    if (now < nextAttemptAtMs) return;
    if (now > giveUpAtMs) {
      pending = false;
      return;
    }

    if (client == null || client.player == null || client.player.connection == null) {
      nextAttemptAtMs = now + 500;
      return;
    }

    JnbotMcBridgeClient bridge = JnbotMcBridgeClient.getInstance();
    if (!bridge.isConnected()) {
      nextAttemptAtMs = now + 750;
      return;
    }

    bridge.sendPasswordRequest(serverKind != null ? serverKind : "unknown", serverAddress != null ? serverAddress : "unknown");
    pending = false;
  }
}
