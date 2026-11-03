package com.jnbot.client.hud.sidebar;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

public final class SidebarStatsParser {
  public SidebarStats parse(String titlePlain, List<SidebarLine> filteredLines) {
    String title = titlePlain == null ? "" : titlePlain.trim();

    Map<String, String> stats = new LinkedHashMap<>();

    if (filteredLines != null) {
      for (SidebarLine line : filteredLines) {
        if (line == null) continue;
        String raw = line.namePlain();
        if (raw == null) continue;

        String trimmed = raw.trim();
        if (trimmed.isBlank()) continue;

        int idx = trimmed.indexOf(':');
        if (idx <= 0 || idx >= trimmed.length() - 1) continue;

        String key = trimmed.substring(0, idx).trim();
        String value = trimmed.substring(idx + 1).trim();
        if (key.isBlank() || value.isBlank()) continue;

        String canonical = canonicalizeKey(key);
        stats.putIfAbsent(canonical, value);
      }
    }

    // Order common keys first, but keep unknowns too
    List<SidebarStats.StatItem> items = new ArrayList<>();
    addIfPresent(items, stats, "Balance");
    addIfPresent(items, stats, "Exp");
    addIfPresent(items, stats, "Stars");
    addIfPresent(items, stats, "Mobcoins");
    addIfPresent(items, stats, "Tokens");
    addIfPresent(items, stats, "Level");

    // Include remaining key/value pairs (up to a reasonable amount)
    for (Map.Entry<String, String> e : stats.entrySet()) {
      String k = e.getKey();
      if (containsKey(items, k)) continue;
      items.add(new SidebarStats.StatItem(k, e.getValue()));
      if (items.size() >= 8) break;
    }

    return new SidebarStats(title, items);
  }

  private static void addIfPresent(List<SidebarStats.StatItem> out, Map<String, String> stats, String key) {
    String v = stats.get(key);
    if (v != null && !v.isBlank()) out.add(new SidebarStats.StatItem(key, v));
  }

  private static boolean containsKey(List<SidebarStats.StatItem> items, String key) {
    for (SidebarStats.StatItem item : items) {
      if (item.key().equals(key)) return true;
    }
    return false;
  }

  private static String canonicalizeKey(String key) {
    String k = key.trim();
    String lower = k.toLowerCase(Locale.ROOT);

    if (lower.equals("exp") || lower.equals("xp") || lower.equals("experience")) return "Exp";
    if (lower.equals("mobcoins") || lower.equals("mob coins") || lower.equals("mobcoin")) return "Mobcoins";
    if (lower.equals("balance") || lower.equals("money") || lower.equals("coins")) return "Balance";
    if (lower.equals("tokens") || lower.equals("token")) return "Tokens";
    if (lower.equals("stars") || lower.equals("star")) return "Stars";
    if (lower.equals("level") || lower.equals("lvl")) return "Level";

    // Title-case fallback
    if (k.length() == 1) return k.toUpperCase(Locale.ROOT);
    return Character.toUpperCase(k.charAt(0)) + k.substring(1);
  }
}
