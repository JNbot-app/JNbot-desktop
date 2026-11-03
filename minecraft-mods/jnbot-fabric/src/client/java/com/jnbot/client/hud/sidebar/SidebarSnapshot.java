package com.jnbot.client.hud.sidebar;

import java.util.List;
import java.util.Objects;
import net.minecraft.network.chat.Component;

public record SidebarSnapshot(Component titleText, String titlePlain, List<SidebarLine> lines) {
  public SidebarSnapshot {
    titleText = titleText == null ? Component.empty() : titleText;
    titlePlain = titlePlain == null ? "" : titlePlain;
    lines = lines == null ? List.of() : List.copyOf(lines);
  }

  @Override
  public boolean equals(Object o) {
    if (this == o) return true;
    if (!(o instanceof SidebarSnapshot other)) return false;
    // Intentionally ignore titleText in equality. The plain string and lines are enough
    // to detect meaningful sidebar changes, and avoids Text equality surprises.
    return Objects.equals(titlePlain, other.titlePlain) && Objects.equals(lines, other.lines);
  }

  @Override
  public int hashCode() {
    return Objects.hash(titlePlain, lines);
  }
}
