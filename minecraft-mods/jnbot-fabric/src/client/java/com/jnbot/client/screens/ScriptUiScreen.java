package com.jnbot.client.screens;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.jnbot.client.bridge.JnbotMcBridgeClient;
import com.jnbot.client.ui.UiPainter;
import com.jnbot.client.ui.UiTheme;
import net.minecraft.client.gui.GuiGraphics;
import net.minecraft.client.gui.components.Button;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.network.chat.Component;

/** Small declarative plugin UI. Only interactions are sent over the bridge. */
public final class ScriptUiScreen extends Screen {
  private static final int PANEL_W = 340;
  private final Screen parent;
  private final String uiId;
  private final JsonArray elements;

  public ScriptUiScreen(Screen parent, String uiId, String title, JsonArray elements) {
    super(Component.literal(title == null || title.isBlank() ? "Plugin controls" : title));
    this.parent = parent;
    this.uiId = uiId;
    this.elements = elements == null ? new JsonArray() : elements.deepCopy();
  }

  public String uiId() { return uiId; }

  @Override
  protected void init() {
    super.init();
    int panelX = (width - PANEL_W) / 2;
    int y = Math.max(28, (height - panelHeight()) / 2) + 42;

    for (JsonElement raw : elements) {
      if (!raw.isJsonObject()) continue;
      JsonObject element = raw.getAsJsonObject();
      String type = string(element, "type", "label");
      String id = string(element, "id", "");
      String label = string(element, "label", id);
      if ("label".equals(type)) {
        y += 20;
        continue;
      }
      if ("toggle".equals(type)) {
        boolean value = bool(element, "value", false);
        Button toggle = addRenderableWidget(Button.builder(toggleText(label, value), button -> {
          boolean next = !bool(element, "value", false);
          element.addProperty("value", next);
          button.setMessage(toggleText(label, next));
          emit(id, "change", next);
        }).bounds(panelX + 18, y, PANEL_W - 36, 20).build());
        y += 26;
        if (getFocused() == null) setFocused(toggle);
        continue;
      }
      if ("button".equals(type)) {
        addRenderableWidget(Button.builder(Component.literal(label), button -> emit(id, "click", true))
            .bounds(panelX + 18, y, PANEL_W - 36, 20).build());
        y += 26;
      }
    }

    addRenderableWidget(Button.builder(Component.literal("Close"), button -> onClose())
        .bounds(panelX + (PANEL_W - 100) / 2, Math.max(y + 6, (height + panelHeight()) / 2 - 34), 100, 20)
        .build());
  }

  private int panelHeight() {
    int controls = 0;
    for (JsonElement raw : elements) if (raw.isJsonObject()) controls++;
    return Math.min(height - 32, Math.max(130, 90 + controls * 26));
  }

  @Override
  public void renderBackground(GuiGraphics context, int mouseX, int mouseY, float delta) {
    context.fill(0, 0, width, height, UiTheme.BG_SCRIM);
  }

  @Override
  public void render(GuiGraphics context, int mouseX, int mouseY, float delta) {
    int panelX = (width - PANEL_W) / 2;
    int panelY = Math.max(16, (height - panelHeight()) / 2);
    UiPainter.panel(context, panelX, panelY, PANEL_W, panelHeight());
    UiPainter.accentStripe(context, panelX, panelY, 34, UiTheme.ACCENT);
    context.drawCenteredString(font, title, width / 2, panelY + 12, UiTheme.TEXT_PRIMARY);

    int labelY = panelY + 46;
    for (JsonElement raw : elements) {
      if (!raw.isJsonObject()) continue;
      JsonObject element = raw.getAsJsonObject();
      if ("label".equals(string(element, "type", "label"))) {
        context.drawString(font, string(element, "label", ""), panelX + 18, labelY + 5,
            UiTheme.TEXT_SECONDARY, false);
      }
      labelY += "label".equals(string(element, "type", "label")) ? 20 : 26;
    }
    super.render(context, mouseX, mouseY, delta);
  }

  @Override
  public void onClose() {
    emit("", "close", true);
    if (minecraft != null) minecraft.setScreen(parent);
  }

  private void emit(String elementId, String action, boolean value) {
    JnbotMcBridgeClient bridge = JnbotMcBridgeClient.getInstance();
    if (!bridge.isEventSubscribed("mc.ui.action")) return;
    JsonObject data = new JsonObject();
    data.addProperty("uiId", uiId);
    data.addProperty("elementId", elementId);
    data.addProperty("action", action);
    data.addProperty("value", value);
    data.addProperty("ts", System.currentTimeMillis());
    bridge.sendEvent("mc.ui.action", data);
  }

  private static Component toggleText(String label, boolean value) {
    return Component.literal(label + ": " + (value ? "ON" : "OFF"));
  }

  private static String string(JsonObject object, String key, String fallback) {
    try { return object.has(key) ? object.get(key).getAsString() : fallback; }
    catch (Exception ignored) { return fallback; }
  }

  private static boolean bool(JsonObject object, String key, boolean fallback) {
    try { return object.has(key) ? object.get(key).getAsBoolean() : fallback; }
    catch (Exception ignored) { return fallback; }
  }
}
