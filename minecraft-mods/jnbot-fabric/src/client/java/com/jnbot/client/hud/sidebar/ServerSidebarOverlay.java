package com.jnbot.client.hud.sidebar;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.Font;
import net.minecraft.client.gui.GuiGraphics;
import net.minecraft.network.chat.Component;
import net.minecraft.network.chat.numbers.NumberFormat;
import net.minecraft.world.scores.Objective;
import net.minecraft.world.scores.PlayerScoreEntry;
import net.minecraft.world.scores.PlayerTeam;
import net.minecraft.world.scores.Scoreboard;

public final class ServerSidebarOverlay {
  private static final ServerSidebarOverlay INSTANCE = new ServerSidebarOverlay();

  public static ServerSidebarOverlay getInstance() {
    return INSTANCE;
  }

  private static final Comparator<PlayerScoreEntry> ENTRY_COMPARATOR =
      Comparator.comparing(PlayerScoreEntry::value)
          .reversed()
          .thenComparing(PlayerScoreEntry::owner, String.CASE_INSENSITIVE_ORDER);

  private final SidebarLineFilter filter = new SidebarLineFilter();
  private final SidebarStatsParser statsParser = new SidebarStatsParser();
  private final SidebarCardRenderer cardRenderer = new SidebarCardRenderer();

  private SidebarSnapshot lastSnapshot;
  private SidebarViewModel lastViewModel;

  private ServerSidebarOverlay() {
  }

  /**
   * @return true if JNbot rendered the sidebar and vanilla should be cancelled
   */
  public boolean render(GuiGraphics context, Objective objective) {
    Minecraft mc = Minecraft.getInstance();
    if (mc == null || mc.player == null || mc.level == null) return false;

    SidebarSnapshot snapshot = buildSnapshot(mc, objective);
    if (snapshot == null) return false;

    if (!snapshot.equals(lastSnapshot)) {
      lastSnapshot = snapshot;

      List<SidebarLine> filtered = filter.filter(snapshot.lines());
      SidebarStats stats = statsParser.parse(snapshot.titlePlain(), filtered);
      lastViewModel = SidebarViewModel.from(snapshot.titleText(), snapshot.titlePlain(), filtered, stats);
    }

    if (lastViewModel == null) return false;

    // If the server sidebar is entirely noise (online count / voteparty / IP / separators),
    // hide it completely rather than showing an empty box.
    if (lastViewModel.filteredLines().isEmpty() && !lastViewModel.hasStats()) {
      return true;
    }

    Font tr = mc.font;
    return cardRenderer.render(context, tr, lastViewModel);
  }

  private static SidebarSnapshot buildSnapshot(Minecraft mc, Objective objective) {
    if (objective == null) return null;

    Scoreboard scoreboard = objective.getScoreboard();
    NumberFormat numberFormat = objective.numberFormatOrDefault(net.minecraft.network.chat.numbers.StyledFormat.SIDEBAR_DEFAULT);

    Component title = objective.getDisplayName();
    String titlePlain = title != null ? title.getString() : "";

    List<SidebarLine> lines = new ArrayList<>();

    scoreboard.listPlayerScores(objective)
        .stream()
        .filter(e -> !e.isHidden())
        .sorted(ENTRY_COMPARATOR)
        .limit(15)
        .forEach(entry -> {
          PlayerTeam team = scoreboard.getPlayersTeam(entry.owner());
          Component name = PlayerTeam.formatNameForTeam(team, entry.ownerName());
          Component score = entry.formatValue(numberFormat);
          lines.add(new SidebarLine(name, score));
        });

    return new SidebarSnapshot(title, titlePlain, lines);
  }
}
