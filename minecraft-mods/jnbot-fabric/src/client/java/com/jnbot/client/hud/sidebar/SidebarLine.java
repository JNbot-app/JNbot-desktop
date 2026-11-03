package com.jnbot.client.hud.sidebar;

import java.util.Objects;
import net.minecraft.network.chat.Component;

public final class SidebarLine {
  private final Component name;
  private final Component score;

  public SidebarLine(Component name, Component score) {
    this.name = name;
    this.score = score;
  }

  public Component name() {
    return name;
  }

  public Component score() {
    return score;
  }

  public String namePlain() {
    return name != null ? name.getString() : "";
  }

  public String scorePlain() {
    return score != null ? score.getString() : "";
  }

  @Override
  public boolean equals(Object o) {
    if (this == o) return true;
    if (!(o instanceof SidebarLine other)) return false;
    return Objects.equals(namePlain(), other.namePlain()) && Objects.equals(scorePlain(), other.scorePlain());
  }

  @Override
  public int hashCode() {
    return Objects.hash(namePlain(), scorePlain());
  }
}
