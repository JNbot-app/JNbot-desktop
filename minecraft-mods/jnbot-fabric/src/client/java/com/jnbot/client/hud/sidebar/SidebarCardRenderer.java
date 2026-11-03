package com.jnbot.client.hud.sidebar;

import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import net.minecraft.client.gui.Font;
import net.minecraft.client.gui.GuiGraphics;
import net.minecraft.network.chat.Component;
import net.minecraft.util.FormattedCharSequence;

public final class SidebarCardRenderer {
  private static final int RIGHT_MARGIN = 0;
  private static final int TOP_OFFSET = 36;
  private static final int PADDING = 6;
  private static final int LINE_HEIGHT = 9;
  private static final int GAP_AFTER_HEADER = 5;
  private static final int GAP_BEFORE_RANK = 2;

  private static final int BG = 0x33000000;
  private static final int HEADER_BG = 0x44000000;

  private static final Pattern RANK_PATTERN = Pattern.compile("#\\d+");

  private static final float BRAND_SCALE = 0.6f;

  public boolean render(GuiGraphics ctx, Font tr, SidebarViewModel vm) {
    if (ctx == null || tr == null || vm == null) return false;

    int screenW = ctx.guiWidth();
    int screenH = ctx.guiHeight();

    String titlePlain = vm.titlePlain() == null ? "" : vm.titlePlain().trim();
    Component titleText = vm.titleText();
    if (titlePlain.isBlank()) {
      titlePlain = "Server";
      titleText = Component.literal(titlePlain);
    }

    final String brand = "JNbot";

    boolean statsMode = vm.hasStats();
    boolean hasRankLine = vm.rankLine() != null && !vm.rankLine().namePlain().isBlank();

    int width;
    int height;

    if (statsMode) {
      width = computeStatsWidth(tr, titlePlain, hasRankLine ? vm.rankLine() : null, vm.stats().items());
      height = computeStatsHeight(vm.stats().items().size(), hasRankLine);
    } else {
      List<SidebarLine> lines = vm.filteredLines();
      int max = Math.min(8, lines.size());
      width = computeLinesWidth(tr, titlePlain, lines, max);
      height = computeLinesHeight(max);
    }

    width = Math.min(width, screenW);

    int x2 = screenW - RIGHT_MARGIN;
    int x1 = x2 - width;
    int y1 = TOP_OFFSET;
    int y2 = y1 + height;

    if (y2 > screenH - 8) {
      y1 = Math.max(8, screenH - 8 - height);
      y2 = y1 + height;
    }

    // Background
    ctx.fill(x1, y1, x2, y2, BG);
    // Header band
    ctx.fill(x1, y1, x2, y1 + PADDING + LINE_HEIGHT + 2, HEADER_BG);

    int cursorY = y1 + PADDING;

    int brandW = tr.width(brand);
    int brandScaledW = (int) Math.ceil(brandW * BRAND_SCALE);
    int availableTitleW = Math.max(0, width - (PADDING * 2) - brandScaledW - 8);
    FormattedCharSequence titleLine;
    if (availableTitleW <= 0) {
      titleLine = FormattedCharSequence.EMPTY;
    } else {
      List<FormattedCharSequence> wrappedTitle = tr.split(titleText, availableTitleW);
      titleLine = wrappedTitle.isEmpty() ? FormattedCharSequence.EMPTY : wrappedTitle.get(0);
    }

    ctx.drawString(tr, titleLine, x1 + PADDING, cursorY, 0xFFFFFFFF);

    // Render brand smaller than the rest of the header.
    ctx.pose().pushMatrix();
    ctx.pose().scale(BRAND_SCALE, BRAND_SCALE);
    int brandX = Math.round((x2 - PADDING - (brandW * BRAND_SCALE)) / BRAND_SCALE);
    int brandY = Math.round(cursorY / BRAND_SCALE);
    ctx.drawString(tr, brand, brandX, brandY, 0xFFB0B0B0);
    ctx.pose().popMatrix();

    cursorY += LINE_HEIGHT + GAP_AFTER_HEADER;

    if (statsMode) {
      int innerW = width - PADDING * 2;

      cursorY = renderStats(ctx, tr, vm.stats().items(), x1 + PADDING, cursorY, innerW);

      if (hasRankLine) {
        RankParts parts = splitRankPlain(vm.rankLine().namePlain());
        if (parts != null) {
          cursorY += GAP_BEFORE_RANK;
          renderStatRow(ctx, tr, parts.label(), parts.value(), x1 + PADDING, cursorY, innerW);
        }
      }
    } else {
      renderLines(ctx, tr, vm.filteredLines(), x1 + PADDING, cursorY, width - PADDING * 2);
    }

    return true;
  }

  private static int renderStats(GuiGraphics ctx, Font tr, List<SidebarStats.StatItem> items, int x, int y, int innerW) {
    int max = Math.min(8, items.size());

    int keyMaxW = 0;
    for (int i = 0; i < max; i++) {
      keyMaxW = Math.max(keyMaxW, tr.width(items.get(i).key()));
    }

    for (int i = 0; i < max; i++) {
      SidebarStats.StatItem it = items.get(i);
      y += renderStatRow(ctx, tr, it.key(), it.value(), x, y, innerW, keyMaxW);
    }

    return y;
  }

  private static int renderStatRow(GuiGraphics ctx, Font tr, String key, String val, int x, int y, int innerW) {
    int keyW = tr.width(key);
    return renderStatRow(ctx, tr, key, val, x, y, innerW, keyW);
  }

  private static int renderStatRow(GuiGraphics ctx, Font tr, String key, String val, int x, int y, int innerW, int keyMaxW) {
    int keyColor = 0xFFB0B0B0;
    int valueColor = 0xFFFFFFFF;

    int gap = 8;
    int valueX = Math.min(x + keyMaxW + gap, x + innerW / 2);

    ctx.drawString(tr, key, x, y, keyColor);
    ctx.drawString(tr, val, valueX, y, valueColor);
    return LINE_HEIGHT;
  }

  private static void renderLines(GuiGraphics ctx, Font tr, List<SidebarLine> lines, int x, int y, int innerW) {
    int max = Math.min(8, lines.size());

    for (int i = 0; i < max; i++) {
      SidebarLine line = lines.get(i);
      if (line == null || line.name() == null) continue;
      if (line.namePlain().isBlank()) continue;

      // Keep formatting/colors from the server scoreboard text.
      FormattedCharSequence clipped = firstWrappedLine(tr, line.name(), innerW);
      if (clipped == FormattedCharSequence.EMPTY) continue;
      ctx.drawString(tr, clipped, x, y, 0xFFFFFFFF);
      y += LINE_HEIGHT;
    }
  }

  private static int computeStatsWidth(Font tr, String title, SidebarLine rankLine, List<SidebarStats.StatItem> items) {
    int max = Math.min(8, items.size());
    int titleW = tr.width(title);

    int rankStatW = 0;
    if (rankLine != null) {
      RankParts parts = splitRankPlain(rankLine.namePlain());
      if (parts != null) {
        rankStatW = parts.label().isBlank()
            ? tr.width(parts.value())
            : (tr.width(parts.label()) + 8 + tr.width(parts.value()));
      }
    }

    int keyW = 0;
    int valueW = 0;
    for (int i = 0; i < max; i++) {
      SidebarStats.StatItem it = items.get(i);
      keyW = Math.max(keyW, tr.width(it.key()));
      valueW = Math.max(valueW, tr.width(it.value()));
    }

    int inner = Math.max(Math.max(titleW, rankStatW), Math.min(320, keyW + 8 + valueW));
    return inner + PADDING * 2;
  }

  private static int computeStatsHeight(int statCount, boolean hasRankLine) {
    int lines = Math.min(8, statCount);
    int rankH = hasRankLine ? (GAP_BEFORE_RANK + LINE_HEIGHT) : 0;
    return PADDING + LINE_HEIGHT + GAP_AFTER_HEADER + (lines * LINE_HEIGHT) + rankH + PADDING;
  }

  private static RankParts splitRankPlain(String rawPlain) {
    if (rawPlain == null) return null;

    String trimmed = rawPlain.trim().replaceAll("\\s+", " ");
    if (trimmed.isBlank()) return null;

    Matcher m = RANK_PATTERN.matcher(trimmed);
    if (!m.find()) return null;

    String label = trimmed.substring(0, m.start()).trim();
    String value = m.group().trim();

    String suffix = trimmed.substring(m.end()).trim();
    if (!suffix.isBlank()) value = value + " " + suffix;

    if (label.isBlank()) label = "Rank";
    return new RankParts(label, value);
  }

  private record RankParts(String label, String value) {
  }

  private static FormattedCharSequence firstWrappedLine(Font tr, Component text, int width) {
    if (text == null || width <= 0) return FormattedCharSequence.EMPTY;
    List<FormattedCharSequence> wrapped = tr.split(text, width);
    return wrapped.isEmpty() ? FormattedCharSequence.EMPTY : wrapped.get(0);
  }

  private static int computeLinesWidth(Font tr, String title, List<SidebarLine> lines, int max) {
    int w = tr.width(title);
    for (int i = 0; i < max; i++) {
      SidebarLine line = lines.get(i);
      if (line == null) continue;
      w = Math.max(w, tr.width(line.namePlain()));
    }

    return Math.min(w + PADDING * 2, 320);
  }

  private static int computeLinesHeight(int lineCount) {
    return PADDING + LINE_HEIGHT + GAP_AFTER_HEADER + (lineCount * LINE_HEIGHT) + PADDING;
  }
}
