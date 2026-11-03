package com.jnbot.client.hud.sidebar;

import java.util.List;
import java.util.regex.Pattern;
import net.minecraft.network.chat.Component;

public record SidebarViewModel(Component titleText, String titlePlain, List<SidebarLine> filteredLines, SidebarLine rankLine, SidebarStats stats) {
  private static final Pattern RANK_PATTERN = Pattern.compile("#\\d+");

  public SidebarViewModel {
    titleText = titleText == null ? Component.empty() : titleText;
    titlePlain = titlePlain == null ? "" : titlePlain;
    filteredLines = filteredLines == null ? List.of() : List.copyOf(filteredLines);
    stats = stats == null ? new SidebarStats(titlePlain, List.of()) : stats;
  }

  public static SidebarViewModel from(Component titleText, String titlePlain, List<SidebarLine> filtered, SidebarStats stats) {
    SidebarLine rankLine = extractRankLine(filtered);
    return new SidebarViewModel(titleText, titlePlain, filtered, rankLine, stats);
  }

  private static SidebarLine extractRankLine(List<SidebarLine> filtered) {
    if (filtered == null || filtered.isEmpty()) return null;

    for (SidebarLine line : filtered) {
      if (line == null || line.name() == null) continue;
      String plain = line.namePlain();
      if (plain == null) continue;

      String trimmed = plain.trim();
      if (trimmed.isBlank()) continue;

      // Many servers show rank/position as "... #<number>" (e.g. "Island Top #4").
      if (RANK_PATTERN.matcher(trimmed).find()) {
        return line;
      }
    }

    return null;
  }

  public boolean hasStats() {
    return stats != null && !stats.isEmpty();
  }
}
