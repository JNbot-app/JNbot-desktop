package com.jnbot.client.ui;

/**
 * Central palette for the JNbot client UI. Keep colors here so every screen
 * and HUD shares the same look.
 */
public final class UiTheme {
  private UiTheme() {}

  // Backgrounds
  public static final int BG_SCRIM = 0xCC0A0E14;
  public static final int BG_PANEL = 0xEE111720;
  public static final int BG_PANEL_INSET = 0xFF0E141C;
  public static final int BG_ROW_HOVER = 0x22FFFFFF;
  public static final int BG_ROW_ALT = 0x10FFFFFF;
  public static final int BG_HUD = 0xC8101620;
  public static final int BG_HUD_INSET = 0xE60A0F16;

  // Borders / dividers
  public static final int BORDER = 0xFF2A3340;
  public static final int BORDER_STRONG = 0xFF3A4554;
  public static final int DIVIDER = 0x33FFFFFF;

  // Brand accent (cyan/teal)
  public static final int ACCENT = 0xFF38BDF8;
  public static final int ACCENT_DIM = 0xFF1E7AA8;
  public static final int ACCENT_GLOW = 0x6638BDF8;

  // Status
  public static final int OK = 0xFF22C55E;
  public static final int WARN = 0xFFFACC15;
  public static final int ERROR = 0xFFEF4444;
  public static final int INFO = 0xFF60A5FA;

  // Text
  public static final int TEXT_PRIMARY = 0xFFE6EDF3;
  public static final int TEXT_SECONDARY = 0xFFB8C2CC;
  public static final int TEXT_MUTED = 0xFF8090A0;
  public static final int TEXT_FAINT = 0xFF5A6470;

  // Common metrics
  public static final int RADIUS = 1; // we draw faux-rounded by trimming corners

  public static int alpha(int color, int alpha0to255) {
    int a = (alpha0to255 & 0xFF) << 24;
    return a | (color & 0x00FFFFFF);
  }
}
