package com.jnbot.client.bridge.api;

import com.google.gson.JsonElement;
import com.google.gson.JsonNull;
import com.google.gson.JsonObject;

public final class McBridgeApiUtils {
  private McBridgeApiUtils() {}

  public static JsonObject obj(JsonElement el) {
    return el != null && el.isJsonObject() ? el.getAsJsonObject() : new JsonObject();
  }

  public static boolean getBool(JsonObject obj, String key, boolean def) {
    if (obj == null || !obj.has(key)) return def;
    JsonElement el = obj.get(key);
    if (el == null || !el.isJsonPrimitive()) return def;
    try {
      return el.getAsBoolean();
    } catch (Exception e) {
      return def;
    }
  }

  public static Boolean getOptionalBool(JsonObject obj, String key) {
    if (obj == null || !obj.has(key)) return null;
    JsonElement el = obj.get(key);
    if (el == null || !el.isJsonPrimitive()) return null;
    try {
      return el.getAsBoolean();
    } catch (Exception e) {
      return null;
    }
  }

  public static int getInt(JsonObject obj, String key, int def) {
    if (obj == null || !obj.has(key)) return def;
    JsonElement el = obj.get(key);
    if (el == null || !el.isJsonPrimitive()) return def;
    try {
      return el.getAsInt();
    } catch (Exception e) {
      return def;
    }
  }

  public static double getDouble(JsonObject obj, String key, double def) {
    if (obj == null || !obj.has(key)) return def;
    JsonElement el = obj.get(key);
    if (el == null || !el.isJsonPrimitive()) return def;
    try {
      return el.getAsDouble();
    } catch (Exception e) {
      return def;
    }
  }

  public static String getString(JsonObject obj, String key, String def) {
    if (obj == null || !obj.has(key)) return def;
    JsonElement el = obj.get(key);
    if (el == null || !el.isJsonPrimitive()) return def;
    try {
      return el.getAsString();
    } catch (Exception e) {
      return def;
    }
  }

  public static JsonElement nullToJsonNull(JsonElement el) {
    return el != null ? el : JsonNull.INSTANCE;
  }
}
