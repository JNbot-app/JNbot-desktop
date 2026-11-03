package com.jnbot.client.hud.sidebar;

import java.util.List;

public record SidebarStats(String gamemodeTitle, List<StatItem> items) {
  public SidebarStats {
    gamemodeTitle = gamemodeTitle == null ? "" : gamemodeTitle;
    items = items == null ? List.of() : List.copyOf(items);
  }

  public boolean isEmpty() {
    return items.isEmpty();
  }

  public record StatItem(String key, String value) {
    public StatItem {
      key = key == null ? "" : key;
      value = value == null ? "" : value;
    }
  }
}
