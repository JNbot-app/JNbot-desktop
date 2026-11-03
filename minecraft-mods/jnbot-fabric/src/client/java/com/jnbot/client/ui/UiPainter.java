package com.jnbot.client.ui;

import net.minecraft.client.gui.Font;
import net.minecraft.client.gui.GuiGraphics;

/**
 * Tiny helper for drawing common building blocks — panels, soft borders,
 * status pills, progress bars, etc. Centralising these makes it easy to
 * rev the look of every screen in one place.
 */
public final class UiPainter {
  private UiPainter() {}

  /** Faux-rounded filled rectangle (clips 1px corners). */
  public static void roundedFill(GuiGraphics ctx, int x, int y, int w, int h, int color) {
    if (w <= 0 || h <= 0) return;
    int x2 = x + w;
    int y2 = y + h;
    ctx.fill(x + 1, y, x2 - 1, y2, color);
    ctx.fill(x, y + 1, x + 1, y2 - 1, color);
    ctx.fill(x2 - 1, y + 1, x2, y2 - 1, color);
  }

  /** Faux-rounded outline. */
  public static void roundedOutline(GuiGraphics ctx, int x, int y, int w, int h, int color) {
    if (w <= 0 || h <= 0) return;
    int x2 = x + w;
    int y2 = y + h;
    // top/bottom
    ctx.fill(x + 1, y, x2 - 1, y + 1, color);
    ctx.fill(x + 1, y2 - 1, x2 - 1, y2, color);
    // left/right
    ctx.fill(x, y + 1, x + 1, y2 - 1, color);
    ctx.fill(x2 - 1, y + 1, x2, y2 - 1, color);
  }

  /** A filled panel with a subtle border on top. */
  public static void panel(GuiGraphics ctx, int x, int y, int w, int h, int fill, int border) {
    roundedFill(ctx, x, y, w, h, fill);
    roundedOutline(ctx, x, y, w, h, border);
  }

  public static void panel(GuiGraphics ctx, int x, int y, int w, int h) {
    panel(ctx, x, y, w, h, UiTheme.BG_PANEL, UiTheme.BORDER);
  }

  /** Horizontal divider 1px tall. */
  public static void hr(GuiGraphics ctx, int x, int y, int w, int color) {
    ctx.fill(x, y, x + w, y + 1, color);
  }

  public static void hr(GuiGraphics ctx, int x, int y, int w) {
    hr(ctx, x, y, w, UiTheme.DIVIDER);
  }

  /** Accent strip on the left side of a row. */
  public static void accentStripe(GuiGraphics ctx, int x, int y, int h, int color) {
    ctx.fill(x, y, x + 2, y + h, color);
  }

  /** A status pill — small rounded rectangle with text inside. */
  public static int pill(GuiGraphics ctx, Font tr, int x, int y, String text, int bgColor, int textColor) {
    int padX = 4;
    int textWidth = tr.width(text);
    int width = textWidth + padX * 2;
    int height = 11;
    roundedFill(ctx, x, y, width, height, bgColor);
    ctx.drawString(tr, text, x + padX, y + 2, textColor, false);
    return width;
  }

  /** Filled progress bar with track + accent gradient. */
  public static void progressBar(GuiGraphics ctx, int x, int y, int w, int h, double pct, int trackColor, int fillColor) {
    if (w <= 0 || h <= 0) return;
    double clamped = pct < 0 ? 0 : (pct > 1 ? 1 : pct);
    int fillW = (int) Math.round(w * clamped);

    roundedFill(ctx, x, y, w, h, trackColor);
    if (fillW > 0) {
      roundedFill(ctx, x, y, fillW, h, fillColor);
    }
  }

  /** Status dot (small filled circle, faked with a 6×6 square + clipped corners). */
  public static void statusDot(GuiGraphics ctx, int x, int y, int color) {
    ctx.fill(x + 1, y, x + 5, y + 6, color);
    ctx.fill(x, y + 1, x + 6, y + 5, color);
  }

  /** Returns the text trimmed with an ellipsis if it would exceed `maxWidth`. */
  public static String clip(Font tr, String text, int maxWidth) {
    if (text == null) return "";
    if (tr.width(text) <= maxWidth) return text;

    String ellipsis = "…";
    int ellWidth = tr.width(ellipsis);
    if (maxWidth <= ellWidth) return ellipsis;
    return tr.plainSubstrByWidth(text, maxWidth - ellWidth) + ellipsis;
  }
}
