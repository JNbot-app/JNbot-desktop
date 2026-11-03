package com.jnbot.client.proxy;

import com.jnbot.client.ui.UiPainter;
import com.jnbot.client.ui.UiTheme;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.GuiGraphics;

/** The proxy's status line (spectating, reconnecting), pinned to the top of the screen. */
public final class ProxyStatusHud {
  private ProxyStatusHud() {}

  public static void render(GuiGraphics ctx) {
    String status = ProxyControlChannel.status();
    if (status == null) return;
    Minecraft mc = Minecraft.getInstance();
    int w = mc.font.width(status) + 22;
    int x = (ctx.guiWidth() - w) / 2;
    int y = 4;
    int color = status.startsWith("Reconnecting") ? UiTheme.WARN : UiTheme.INFO;
    UiPainter.panel(ctx, x, y, w, 15, UiTheme.BG_HUD, UiTheme.alpha(color, 0xAA));
    UiPainter.statusDot(ctx, x + 6, y + 4, color);
    ctx.drawString(mc.font, status, x + 16, y + 4, UiTheme.TEXT_PRIMARY, false);
  }
}
