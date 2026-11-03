package com.jnbot.client.hud.sidebar;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

public final class SidebarLineFilter {
  public List<SidebarLine> filter(List<SidebarLine> input) {
    if (input == null || input.isEmpty()) return List.of();

    List<SidebarLine> out = new ArrayList<>(input.size());
    for (SidebarLine line : input) {
      if (line == null) continue;
      String plain = normalize(line.namePlain());
      if (plain.isBlank()) continue;

      if (isJunk(plain)) continue;
      out.add(line);
    }

    return List.copyOf(out);
  }

  private static boolean isJunk(String plainLower) {
    // Decorative separators
    if (plainLower.replace("-", "").isBlank()) return true;
    if (plainLower.replace("_", "").isBlank()) return true;

    // Always hide these common server-marketing / noise lines
    if (plainLower.contains("online:")) return true;
    if (plainLower.contains("voteparty")) return true;
    if (plainLower.contains("vote party")) return true;

    // Server IP lines (e.g. play.example.com, play.jartexnetwork.com)
    if (plainLower.startsWith("play.")) return true;
    // Heuristic: if it looks like a host and is short, treat as IP/host line
    if (!plainLower.contains(":") && plainLower.length() <= 32) {
      if (plainLower.contains(".com") || plainLower.contains(".net") || plainLower.contains(".org")) return true;
    }

    return false;
  }

  private static String normalize(String s) {
    if (s == null) return "";
    return s.trim().toLowerCase(Locale.ROOT);
  }
}
