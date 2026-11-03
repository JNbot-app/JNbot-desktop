package com.jnbot.client.screens;

import com.jnbot.client.bridge.JnbotAppInfo;
import com.jnbot.client.bridge.JnbotMcBridgeClient;
import com.jnbot.client.ui.UiPainter;
import com.jnbot.client.ui.UiTheme;
import net.minecraft.client.gui.GuiGraphics;
import net.minecraft.client.gui.components.Button;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.network.chat.Component;

public final class JnbotInfoScreen extends Screen {
  private final Screen parent;

  private static final int PANEL_W = 320;
  private static final int PANEL_PADDING = 14;

  public JnbotInfoScreen(Screen parent) {
    super(Component.literal("JNbot"));
    this.parent = parent;
  }

  @Override
  protected void init() {
    super.init();

    int panelX = (width - PANEL_W) / 2;
    int panelY = Math.max(20, height / 2 - 110);
    int panelH = 200;

    int btnW = 96;
    int btnH = 20;
    int btnY = panelY + panelH - btnH - PANEL_PADDING;
    int gap = 8;
    int totalW = btnW * 2 + gap;
    int firstX = panelX + (PANEL_W - totalW) / 2;

    addRenderableWidget(Button.builder(Component.literal("Settings"), btn ->
        minecraft.setScreen(new JnbotSettingsScreen(this))
    ).bounds(firstX, btnY, btnW, btnH).build());

    addRenderableWidget(Button.builder(Component.literal("Back"), btn ->
        minecraft.setScreen(parent)
    ).bounds(firstX + btnW + gap, btnY, btnW, btnH).build());

    JnbotMcBridgeClient.getInstance().requestAppInfo();
  }

  @Override
  public void renderBackground(GuiGraphics ctx, int mouseX, int mouseY, float delta) {
    ctx.fill(0, 0, width, height, UiTheme.BG_SCRIM);
  }

  @Override
  public void render(GuiGraphics ctx, int mouseX, int mouseY, float delta) {
    int panelX = (width - PANEL_W) / 2;
    int panelY = Math.max(20, height / 2 - 110);
    int panelH = 200;

    // Card
    UiPainter.panel(ctx, panelX, panelY, PANEL_W, panelH);

    // Header strip
    int headerH = 32;
    UiPainter.roundedFill(ctx, panelX, panelY, PANEL_W, headerH, UiTheme.BG_PANEL_INSET);
    UiPainter.accentStripe(ctx, panelX, panelY, headerH, UiTheme.ACCENT);
    UiPainter.hr(ctx, panelX + 1, panelY + headerH, PANEL_W - 2, UiTheme.BORDER);

    // Title + tagline
    int titleY = panelY + 6;
    ctx.drawString(font, "JNbot Client", panelX + 12, titleY, UiTheme.TEXT_PRIMARY, false);
    ctx.drawString(font, "Bridge to your JNbot app", panelX + 12, titleY + 12, UiTheme.TEXT_MUTED, false);

    final JnbotMcBridgeClient bridge = JnbotMcBridgeClient.getInstance();
    final boolean connected = bridge.isConnected();
    final boolean connecting = bridge.isConnecting();
    final String status = connected ? "ONLINE" : (connecting ? "CONNECTING" : "OFFLINE");
    final int dotColor = connected ? UiTheme.OK : (connecting ? UiTheme.WARN : UiTheme.ERROR);
    final int pillBg = UiTheme.alpha(dotColor, 0x33);

    // Status pill (right side of header)
    int pillW = font.width(status) + 18;
    int pillX = panelX + PANEL_W - pillW - 10;
    int pillY = panelY + 10;
    UiPainter.roundedFill(ctx, pillX, pillY, pillW, 12, pillBg);
    UiPainter.statusDot(ctx, pillX + 4, pillY + 3, dotColor);
    ctx.drawString(font, status, pillX + 13, pillY + 2, dotColor, false);

    // Body — list of info rows
    int rowY = panelY + headerH + 12;
    int rowX = panelX + 14;
    int valueX = panelX + 130;

    rowY = infoRow(ctx, rowX, valueX, rowY, "Connection",
        connId(bridge) == null ? "—" : connId(bridge),
        UiTheme.TEXT_SECONDARY);

    JnbotAppInfo info = bridge.getAppInfo();
    if (info != null) {
      String appLine = (info.productName != null ? info.productName : "JNbot") +
          (info.version != null ? "  v" + info.version : "");
      rowY = infoRow(ctx, rowX, valueX, rowY, "App", appLine, UiTheme.TEXT_SECONDARY);

      String ws = (info.websocketHost != null ? info.websocketHost : "?") + ":" + info.websocketPort;
      rowY = infoRow(ctx, rowX, valueX, rowY, "WebSocket", ws, UiTheme.TEXT_SECONDARY);

      rowY = infoRow(ctx, rowX, valueX, rowY, "Clients", String.valueOf(info.clients),
          UiTheme.TEXT_SECONDARY);
    } else {
      rowY = infoRow(ctx, rowX, valueX, rowY, "App",
          connected ? "(loading…)" : "(disconnected)",
          UiTheme.TEXT_MUTED);
    }

    String err = bridge.getLastError();
    if (!connected && err != null && !err.isBlank()) {
      String clipped = UiPainter.clip(font, err, PANEL_W - 28);
      ctx.drawString(font, "Last error:", rowX, rowY, UiTheme.TEXT_MUTED, false);
      ctx.drawString(font, clipped, rowX, rowY + 11, UiTheme.ERROR, false);
    }

    super.render(ctx, mouseX, mouseY, delta);
  }

  private static String connId(JnbotMcBridgeClient b) {
    return b.getConnectionId();
  }

  private int infoRow(GuiGraphics ctx, int labelX, int valueX, int y, String label, String value, int valueColor) {
    ctx.drawString(font, label, labelX, y, UiTheme.TEXT_MUTED, false);
    String clipped = UiPainter.clip(font, value, PANEL_W - (valueX - (labelX - 14)) - 14);
    ctx.drawString(font, clipped, valueX, y, valueColor, false);
    return y + 16;
  }
}
