package com.jnbot.client.hud;

import com.jnbot.client.ui.UiPainter;
import com.jnbot.client.ui.UiTheme;
import java.util.ArrayDeque;
import java.util.Deque;
import java.util.Iterator;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.Font;
import net.minecraft.client.gui.GuiGraphics;

/**
 * Small stacking toast notifications in the top-right corner. Themed via
 * UiTheme so kind=ok/warn/error pick up consistent colors.
 */
public final class ToastOverlay {
  private static final ToastOverlay INSTANCE = new ToastOverlay();

  public static ToastOverlay getInstance() { return INSTANCE; }

  private static final int MAX_TOASTS = 5;

  private final Deque<Toast> toasts = new ArrayDeque<>();

  private ToastOverlay() {}

  public synchronized void push(String title, String body, String kind, long durationMs) {
    if (durationMs <= 0) durationMs = 5_000;
    if (toasts.size() >= MAX_TOASTS) toasts.pollFirst();
    toasts.addLast(new Toast(title, body, kind, System.currentTimeMillis() + durationMs));
  }

  public synchronized void clear() { toasts.clear(); }

  public void render(GuiGraphics ctx) {
    Minecraft mc = Minecraft.getInstance();
    if (mc == null) return;
    if (mc.options.hideGui) return;

    long now = System.currentTimeMillis();
    synchronized (this) {
      Iterator<Toast> it = toasts.iterator();
      while (it.hasNext()) if (it.next().expiresAt < now) it.remove();
    }
    if (toasts.isEmpty()) return;

    Font tr = mc.font;
    int screenW = mc.getWindow().getGuiScaledWidth();

    int w = 220;
    int marginX = 6;
    int gap = 4;
    int x = screenW - w - marginX;
    int y = 6;

    synchronized (this) {
      for (Toast t : toasts) {
        int h = renderOne(ctx, tr, t, x, y, w, now);
        y += h + gap;
      }
    }
  }

  private static int renderOne(GuiGraphics ctx, Font tr, Toast t, int x, int y, int w, long now) {
    int padX = 8;
    int padY = 6;

    boolean hasBody = t.body != null && !t.body.isBlank();
    int h = hasBody ? 32 : 20;

    int accent = colorFor(t.kind);

    UiPainter.panel(ctx, x, y, w, h, UiTheme.BG_HUD, UiTheme.BORDER);
    UiPainter.accentStripe(ctx, x, y + 2, h - 4, accent);

    String title = UiPainter.clip(tr, t.title == null ? "" : t.title, w - padX * 2 - 2);
    ctx.drawString(tr, title, x + padX, y + padY, UiTheme.TEXT_PRIMARY, false);

    if (hasBody) {
      String body = UiPainter.clip(tr, t.body, w - padX * 2 - 2);
      ctx.drawString(tr, body, x + padX, y + padY + 11, UiTheme.TEXT_SECONDARY, false);
    }

    // Slim progress strip at the bottom showing time left
    long total = Math.max(1, t.expiresAt - t.createdAt);
    long left = Math.max(0, t.expiresAt - now);
    double pct = (double) left / (double) total;
    UiPainter.progressBar(ctx, x + 2, y + h - 2, w - 4, 1, pct,
        UiTheme.BG_HUD_INSET, accent);

    return h;
  }

  private static int colorFor(String kind) {
    if (kind == null) return UiTheme.ACCENT;
    return switch (kind.toLowerCase()) {
      case "ok", "success" -> UiTheme.OK;
      case "warn", "warning" -> UiTheme.WARN;
      case "error", "danger" -> UiTheme.ERROR;
      case "info" -> UiTheme.INFO;
      default -> UiTheme.ACCENT;
    };
  }

  private static final class Toast {
    final String title;
    final String body;
    final String kind;
    final long createdAt;
    final long expiresAt;

    Toast(String title, String body, String kind, long expiresAt) {
      this.title = title;
      this.body = body;
      this.kind = kind;
      this.createdAt = System.currentTimeMillis();
      this.expiresAt = expiresAt;
    }
  }
}
