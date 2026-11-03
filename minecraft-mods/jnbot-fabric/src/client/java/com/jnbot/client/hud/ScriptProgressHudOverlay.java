package com.jnbot.client.hud;

import com.jnbot.client.config.JnbotClientConfigStore;
import com.jnbot.client.ui.UiPainter;
import com.jnbot.client.ui.UiTheme;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.Font;
import net.minecraft.client.gui.GuiGraphics;

public final class ScriptProgressHudOverlay {
  private static final ScriptProgressHudOverlay INSTANCE = new ScriptProgressHudOverlay();

  public static ScriptProgressHudOverlay getInstance() {
    return INSTANCE;
  }

  private static final long STALE_AFTER_MS = 10_000;
  private static final int MAX_ENTRIES = 5;

  private final Map<Integer, Entry> entries = new HashMap<>();

  private ScriptProgressHudOverlay() {}

  public void update(int scriptInstanceId, String scriptName, int current, int total) {
    if (scriptInstanceId == 0) return;
    if (total <= 0) {
      entries.remove(scriptInstanceId);
      return;
    }

    String name = (scriptName == null || scriptName.isBlank()) ? "Script" : scriptName;
    entries.put(scriptInstanceId, new Entry(scriptInstanceId, name, Math.max(0, current), total, System.currentTimeMillis()));
  }

  public void remove(int scriptInstanceId) {
    entries.remove(scriptInstanceId);
  }

  public void clear() {
    entries.clear();
  }

  public void render(GuiGraphics ctx) {
    Minecraft mc = Minecraft.getInstance();
    if (mc == null || mc.player == null || mc.level == null) return;
    if (mc.options.hideGui) return;
    if (mc.getDebugOverlay().showDebugScreen()) return;

    if (!JnbotClientConfigStore.getInstance().get().isScriptProgressHudEnabled()) return;

    long now = System.currentTimeMillis();
    entries.entrySet().removeIf(e -> now - e.getValue().updatedAtMs > STALE_AFTER_MS);

    if (entries.isEmpty()) return;

    Font tr = mc.font;

    List<Entry> list = new ArrayList<>(entries.values());
    list.sort(Comparator.comparingLong((Entry e) -> e.updatedAtMs).reversed());

    int maxEntries = Math.min(MAX_ENTRIES, list.size());

    int screenWidth = mc.getWindow().getGuiScaledWidth();
    int screenHeight = mc.getWindow().getGuiScaledHeight();

    int padX = 8;
    int padY = 8;
    int headerH = 14;
    int gapAfterHeader = 6;
    int barWidth = 120;
    int barHeight = 4;
    int entryGap = 8;
    int entryHeight = 9 + 3 + barHeight; // text + gap + bar

    int maxLineWidth = tr.width("JNBOT • PROGRESS");
    List<RenderedEntry> rendered = new ArrayList<>();
    for (int i = 0; i < maxEntries; i++) {
      Entry e = list.get(i);
      int percent = (int) Math.round(100.0 * clamp01((double) e.current / (double) e.total));
      String nameLine = e.name;
      String rightLine = e.current + "/" + e.total + " · " + percent + "%";
      int w = tr.width(nameLine) + 16 + tr.width(rightLine);
      maxLineWidth = Math.max(maxLineWidth, w);
      rendered.add(new RenderedEntry(e, nameLine, rightLine, percent));
    }

    int panelWidth = Math.min(screenWidth - 16, Math.max(maxLineWidth, barWidth) + padX * 2);
    int panelHeight = padY + headerH + gapAfterHeader
        + maxEntries * entryHeight
        + (maxEntries - 1) * entryGap
        + padY;

    int x = 8;
    int y = 8;
    if (y + panelHeight > screenHeight - 8) y = Math.max(8, screenHeight - 8 - panelHeight);

    // Panel
    UiPainter.panel(ctx, x, y, panelWidth, panelHeight, UiTheme.BG_HUD, UiTheme.BORDER);
    UiPainter.accentStripe(ctx, x, y, panelHeight, UiTheme.ACCENT);

    // Header
    ctx.drawString(tr, "JNBOT • PROGRESS", x + padX, y + padY, UiTheme.ACCENT, false);
    UiPainter.hr(ctx, x + padX, y + padY + 9, panelWidth - padX * 2, UiTheme.alpha(UiTheme.BORDER, 0x66));

    int cursorY = y + padY + headerH + gapAfterHeader;
    for (RenderedEntry re : rendered) {
      String name = UiPainter.clip(tr, re.name, panelWidth - padX * 2 - tr.width(re.right) - 8);
      ctx.drawString(tr, name, x + padX, cursorY, UiTheme.TEXT_PRIMARY, false);
      int rightX = x + panelWidth - padX - tr.width(re.right);
      ctx.drawString(tr, re.right, rightX, cursorY, UiTheme.TEXT_MUTED, false);

      int barY = cursorY + 12;
      double pct = clamp01((double) re.entry.current / (double) re.entry.total);
      UiPainter.progressBar(ctx, x + padX, barY, panelWidth - padX * 2, barHeight, pct,
          UiTheme.BG_HUD_INSET, UiTheme.ACCENT);

      cursorY += entryHeight + entryGap;
    }
  }

  private static double clamp01(double v) {
    if (v < 0) return 0;
    if (v > 1) return 1;
    return v;
  }

  private record Entry(int scriptInstanceId, String name, int current, int total, long updatedAtMs) {}

  private record RenderedEntry(Entry entry, String name, String right, int percent) {}
}
