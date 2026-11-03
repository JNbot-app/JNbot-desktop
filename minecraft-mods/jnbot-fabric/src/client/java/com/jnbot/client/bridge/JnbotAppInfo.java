package com.jnbot.client.bridge;

public final class JnbotAppInfo {
  public final String productName;
  public final String version;
  public final String platform;
  public final long pid;
  public final long uptimeMs;
  public final String websocketHost;
  public final int websocketPort;
  public final int clients;

  public JnbotAppInfo(
      String productName,
      String version,
      String platform,
      long pid,
      long uptimeMs,
      String websocketHost,
      int websocketPort,
      int clients
  ) {
    this.productName = productName;
    this.version = version;
    this.platform = platform;
    this.pid = pid;
    this.uptimeMs = uptimeMs;
    this.websocketHost = websocketHost;
    this.websocketPort = websocketPort;
    this.clients = clients;
  }
}
