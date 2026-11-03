package com.jnbot.client.hud;

import com.jnbot.client.bridge.JnbotMcBridgeClient;
import com.jnbot.client.ui.UiPainter;
import com.jnbot.client.ui.UiTheme;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.Font;
import net.minecraft.client.gui.GuiGraphics;

/**
 * A tiny, non-intrusive status indicator. Only visible when the bridge is
 * disconnected while a player is in-game — so the user knows JNbot lost the
 * link to the desktop app. When connected, nothing is drawn.
 */
public final class JnbotStatusOverlay {
  private static final JnbotStatusOverlay INSTANCE = new JnbotStatusOverlay();

  public static JnbotStatusOverlay getInstance() {
    return INSTANCE;
  }

  private JnbotStatusOverlay() {}

  public void render(GuiGraphics ctx) {
    Minecraft mc = Minecraft.getInstance();
    if (mc == null || mc.player == null || mc.level == null) return;
    if (mc.options.hideGui) return;
    if (mc.getDebugOverlay().showDebugScreen()) return;
    if (mc.screen != null) return; // never overlap menus

    JnbotMcBridgeClient bridge = JnbotMcBridgeClient.getInstance();
    if (bridge.isConnected()) return;

    Font tr = mc.font;
    String label = bridge.isConnecting() ? "JNbot · connecting" : "JNbot · offline";
    int color = bridge.isConnecting() ? UiTheme.WARN : UiTheme.ERROR;

    int padX = 6;
    int padY = 3;
    int textW = tr.width(label);
    int boxW = textW + 14 + padX * 2;
    int boxH = 9 + padY * 2;

    int screenW = mc.getWindow().getGuiScaledWidth();
    int screenH = mc.getWindow().getGuiScaledHeight();
    int x = screenW - boxW - 6;
    int y = screenH - boxH - 6;

    UiPainter.panel(ctx, x, y, boxW, boxH, UiTheme.BG_HUD, UiTheme.BORDER);
    UiPainter.statusDot(ctx, x + padX, y + (boxH - 6) / 2, color);
    ctx.drawString(tr, label, x + padX + 10, y + padY + 1, UiTheme.TEXT_PRIMARY, false);
  }
}
