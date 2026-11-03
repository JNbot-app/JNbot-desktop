package com.jnbot.client.bridge;

public final class JnbotBridgeProtocol {
  private JnbotBridgeProtocol() {}

  public static final int PROTOCOL_VERSION = 1;

  public static final String TYPE_HELLO = "hello";
  public static final String TYPE_HELLO_ACK = "helloAck";
  public static final String TYPE_REQUEST = "request";
  public static final String TYPE_RESPONSE = "response";
  public static final String TYPE_COMMAND = "command";
  public static final String TYPE_EVENT = "event";
  public static final String TYPE_PING = "ping";
  public static final String TYPE_PONG = "pong";
}
