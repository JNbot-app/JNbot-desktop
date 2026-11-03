package com.jnbot.client.proxy;

import com.jnbot.client.ui.UiPainter;
import com.jnbot.client.ui.UiTheme;
import net.minecraft.client.gui.GuiGraphics;
import net.minecraft.client.gui.components.Button;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.network.chat.Component;

import java.util.List;

/**
 * The JNbot proxy sessions (one per server connection) this client can move
 * into. Clicking one hands the connection over without reconnecting.
 */
public final class ProxySessionsScreen extends Screen {
  private static final int PANEL_W = 300;
  private static final int ROW_H = 24;
  private static final int HEADER_H = 32;

  private final Screen parent;
  private List<ProxyControlChannel.Session> shown;

  public ProxySessionsScreen(Screen parent) {
    super(Component.literal("Proxy sessions"));
    this.parent = parent;
  }

  @Override
  protected void init() {
    shown = ProxyControlChannel.sessions();
    int panelX = (width - PANEL_W) / 2;
    int y = panelY() + HEADER_H + 8;
    for (ProxyControlChannel.Session session : shown) {
      boolean here = session.id().equals(ProxyControlChannel.currentSession());
      Button button = Button.builder(Component.literal(label(session, here)), btn -> {
        ProxyControlChannel.join(session.id());
        onClose();
      }).bounds(panelX + 10, y, PANEL_W - 20, 20).build();
      button.active = !here && session.joinable();
      addRenderableWidget(button);
      y += ROW_H;
    }
    addRenderableWidget(Button.builder(Component.literal("Back"), btn -> onClose())
        .bounds(panelX + (PANEL_W - 96) / 2, y + 6, 96, 20).build());
  }

  @Override
  public void tick() {
    // The proxy pushes updates; rebuild the rows when they change.
    if (shown != ProxyControlChannel.sessions()) rebuildWidgets();
  }

  @Override
  public void onClose() {
    minecraft.setScreen(parent);
  }

  @Override
  public void renderBackground(GuiGraphics ctx, int mouseX, int mouseY, float delta) {
    ctx.fill(0, 0, width, height, UiTheme.BG_SCRIM);
  }

  @Override
  public void render(GuiGraphics ctx, int mouseX, int mouseY, float delta) {
    int panelX = (width - PANEL_W) / 2;
    int panelY = panelY();
    int panelH = HEADER_H + 8 + shown.size() * ROW_H + 36;
    UiPainter.panel(ctx, panelX, panelY, PANEL_W, panelH);
    UiPainter.roundedFill(ctx, panelX, panelY, PANEL_W, HEADER_H, UiTheme.BG_PANEL_INSET);
    UiPainter.accentStripe(ctx, panelX, panelY, HEADER_H, UiTheme.ACCENT);
    ctx.drawString(font, "Proxy sessions", panelX + 12, panelY + 6, UiTheme.TEXT_PRIMARY, false);
    ctx.drawString(font, shown.isEmpty() ? "No other sessions" : "Pick a connection to play",
        panelX + 12, panelY + 18, UiTheme.TEXT_MUTED, false);
    super.render(ctx, mouseX, mouseY, delta);
  }

  private int panelY() {
    return Math.max(20, height / 2 - (HEADER_H + shown.size() * ROW_H + 44) / 2);
  }

  private static String label(ProxyControlChannel.Session session, boolean here) {
    String who = session.driver() == null ? "nobody playing" : session.driver() + " playing";
    return session.account() + "  ·  " + (here ? "you are here" : who);
  }
}
