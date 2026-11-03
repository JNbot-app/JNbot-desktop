package com.jnbot.client.config;

public final class JnbotClientConfig {
  private boolean autoLoginEnabled;
  private Boolean scriptProgressHudEnabled;
  private Boolean sidebarHudEnabled;

  public JnbotClientConfig(boolean autoLoginEnabled, Boolean scriptProgressHudEnabled, Boolean sidebarHudEnabled) {
    this.autoLoginEnabled = autoLoginEnabled;
    this.scriptProgressHudEnabled = scriptProgressHudEnabled;
    this.sidebarHudEnabled = sidebarHudEnabled;
  }

  public static JnbotClientConfig defaults() {
    return new JnbotClientConfig(true, true, true);
  }

  public boolean isAutoLoginEnabled() {
    return autoLoginEnabled;
  }

  public void setAutoLoginEnabled(boolean autoLoginEnabled) {
    this.autoLoginEnabled = autoLoginEnabled;
  }

  public boolean isScriptProgressHudEnabled() {
    return scriptProgressHudEnabled == null ? true : scriptProgressHudEnabled;
  }

  public void setScriptProgressHudEnabled(boolean scriptProgressHudEnabled) {
    this.scriptProgressHudEnabled = scriptProgressHudEnabled;
  }

  public boolean isSidebarHudEnabled() {
    return sidebarHudEnabled == null ? true : sidebarHudEnabled;
  }

  public void setSidebarHudEnabled(boolean sidebarHudEnabled) {
    this.sidebarHudEnabled = sidebarHudEnabled;
  }
}
