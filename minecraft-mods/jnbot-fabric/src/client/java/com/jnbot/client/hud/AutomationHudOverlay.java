package com.jnbot.client.hud;

import com.jnbot.client.automation.AutomationRecorderController;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.GuiGraphics;

public final class AutomationHudOverlay {
  private static final AutomationHudOverlay INSTANCE = new AutomationHudOverlay();

  public static AutomationHudOverlay getInstance() {
    return INSTANCE;
  }

  private AutomationHudOverlay() {}

  public void render(GuiGraphics context) {
    Minecraft client = Minecraft.getInstance();
    if (client == null || client.player == null || client.options.hideGui) return;
    AutomationRecorderController recorder = AutomationRecorderController.INSTANCE;
    if (!recorder.isRecording() && !recorder.isPlayback()) return;

    String label;
    int color;
    if (recorder.isRecording()) {
      long seconds = recorder.getElapsedMs() / 1000;
      label = recorder.isPaused()
          ? "JNbot recording paused · F9 resume · F8 stop"
          : String.format("● REC %02d:%02d · %d steps · F9 pause · F8 stop",
              seconds / 60, seconds % 60, recorder.getStepCount());
      color = recorder.isPaused() ? 0xFFFFC107 : 0xFFFF5252;
    } else {
      label = recorder.isPlaybackPaused()
          ? "JNbot automation paused · F9 resume"
          : "JNbot automation playing · F9 pause";
      color = recorder.isPlaybackPaused() ? 0xFFFFC107 : 0xFF64B5F6;
    }

    int width = client.font.width(label) + 12;
    int x = (client.getWindow().getGuiScaledWidth() - width) / 2;
    context.fill(x, 7, x + width, 25, 0xCC101218);
    context.drawString(client.font, label, x + 6, 12, color, false);
  }
}
