package com.jnbot.client.screens;

import com.jnbot.client.config.JnbotClientConfigStore;
import com.jnbot.client.ui.UiPainter;
import com.jnbot.client.ui.UiTheme;
import net.minecraft.client.gui.GuiGraphics;
import net.minecraft.client.gui.components.Button;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.network.chat.Component;

public final class JnbotSettingsScreen extends Screen {
  private static final int PANEL_W = 360;
  private static final int HEADER_H = 36;
  private static final int FOOTER_H = 44;
  private static final int PANEL_PADDING = 8;

  private final Screen parent;
  private JnbotSettingsListWidget list;

  public JnbotSettingsScreen(Screen parent) {
    super(Component.literal("JNbot Settings"));
    this.parent = parent;
  }

  @Override
  protected void init() {
    super.init();

    final int panelX = (width - PANEL_W) / 2;
    final int panelY = Math.max(20, (height - panelHeight()) / 2);
    final int panelH = panelHeight();

    final int listX = panelX + PANEL_PADDING;
    final int listY = panelY + HEADER_H + 2;
    final int listW = PANEL_W - PANEL_PADDING * 2;
    final int listH = panelH - HEADER_H - FOOTER_H - 4;

    list = new JnbotSettingsListWidget(minecraft, listW, listH, listY);
    list.setPosition(listX, listY);

    addSection("General");
    addToggle(
      "Auto Login",
      "Uses your JNbot stored server password when joining a server",
      () -> JnbotClientConfigStore.getInstance().get().isAutoLoginEnabled(),
      v -> JnbotClientConfigStore.getInstance().get().setAutoLoginEnabled(v)
    );

    addSection("HUD");
    addToggle(
      "Script Progress HUD",
      "Live progress bars for scripts currently running",
      () -> JnbotClientConfigStore.getInstance().get().isScriptProgressHudEnabled(),
      v -> JnbotClientConfigStore.getInstance().get().setScriptProgressHudEnabled(v)
    );
    addToggle(
      "Compact Server Sidebar",
      "Replaces noisy server scoreboards with a cleaner card",
      () -> JnbotClientConfigStore.getInstance().get().isSidebarHudEnabled(),
      v -> JnbotClientConfigStore.getInstance().get().setSidebarHudEnabled(v)
    );

    addRenderableWidget(list);

    int btnW = 120;
    int btnH = 20;
    int btnY = panelY + panelH - btnH - 12;
    Button back = addRenderableWidget(Button.builder(Component.literal("Back"), btn ->
        minecraft.setScreen(parent)
    ).bounds(panelX + (PANEL_W - btnW) / 2, btnY, btnW, btnH).build());
    setFocused(back);
  }

  private int panelHeight() {
    return Math.min(height - 40, 260);
  }

  private void addSection(String name) {
    list.addSettingEntry(new JnbotSettingsListWidget.SectionEntry(Component.literal(name)));
  }

  private void addToggle(String title, String description,
                          java.util.function.BooleanSupplier getter,
                          java.util.function.Consumer<Boolean> setter) {
    Button toggle = Button.builder(getOnOffLabel(getter.getAsBoolean()), btn -> {
      boolean next = !getter.getAsBoolean();
      setter.accept(next);
      JnbotClientConfigStore.getInstance().save();
      btn.setMessage(getOnOffLabel(next));
    }).bounds(0, 0, 60, 18).build();

    list.addSettingEntry(new JnbotSettingsListWidget.ToggleEntry(
        Component.literal(title), Component.literal(description), toggle, getter));
  }

  private static Component getOnOffLabel(boolean enabled) {
    return Component.literal(enabled ? "ON" : "OFF");
  }

  @Override
  public void renderBackground(GuiGraphics ctx, int mouseX, int mouseY, float delta) {
    ctx.fill(0, 0, width, height, UiTheme.BG_SCRIM);
  }

  @Override
  public void render(GuiGraphics ctx, int mouseX, int mouseY, float delta) {
    int panelX = (width - PANEL_W) / 2;
    int panelY = Math.max(20, (height - panelHeight()) / 2);
    int panelH = panelHeight();

    UiPainter.panel(ctx, panelX, panelY, PANEL_W, panelH);

    // Header
    UiPainter.roundedFill(ctx, panelX, panelY, PANEL_W, HEADER_H, UiTheme.BG_PANEL_INSET);
    UiPainter.accentStripe(ctx, panelX, panelY, HEADER_H, UiTheme.ACCENT);
    UiPainter.hr(ctx, panelX + 1, panelY + HEADER_H, PANEL_W - 2, UiTheme.BORDER);
    ctx.drawString(font, "Settings", panelX + 12, panelY + 8, UiTheme.TEXT_PRIMARY, false);
    ctx.drawString(font, "Configure JNbot client features", panelX + 12, panelY + 20,
        UiTheme.TEXT_MUTED, false);

    // Footer separator
    UiPainter.hr(ctx, panelX + 1, panelY + panelH - FOOTER_H + 4, PANEL_W - 2, UiTheme.BORDER);

    super.render(ctx, mouseX, mouseY, delta);
  }
}
