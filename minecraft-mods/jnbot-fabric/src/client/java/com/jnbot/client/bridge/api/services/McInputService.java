package com.jnbot.client.bridge.api.services;

import com.jnbot.client.compat.ClientCompat;
import com.google.gson.JsonElement;
import com.google.gson.JsonNull;
import com.google.gson.JsonObject;
import com.jnbot.client.bridge.api.McBridgeApiUtils;
import com.mojang.blaze3d.platform.InputConstants;
import java.lang.reflect.Field;
import java.lang.reflect.Method;
import net.minecraft.client.KeyMapping;
import net.minecraft.client.Minecraft;
import net.minecraft.world.InteractionHand;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.phys.BlockHitResult;
import net.minecraft.world.phys.EntityHitResult;
import net.minecraft.world.phys.HitResult;


public final class McInputService {

  private static InputConstants.Key tryGetKeyBindingKey(KeyMapping binding) {
    if (binding == null) return null;

    // Try public accessors first (mapping/version dependent)
    try {
      Method m = KeyMapping.class.getMethod("getBoundKey");
      Object v = m.invoke(binding);
      if (v instanceof InputConstants.Key k) return k;
    } catch (Exception ignored) {}

    try {
      Method m = KeyMapping.class.getMethod("getDefaultKey");
      Object v = m.invoke(binding);
      if (v instanceof InputConstants.Key k) return k;
    } catch (Exception ignored) {}

    // Fallback to reflective field access (mapping/version dependent)
    for (String fieldName : new String[] { "boundKey", "defaultKey" }) {
      try {
        Field f = KeyMapping.class.getDeclaredField(fieldName);
        f.setAccessible(true);
        Object v = f.get(binding);
        if (v instanceof InputConstants.Key k) return k;
      } catch (Exception ignored) {}
    }

    return null;
  }

  private static void setKeyIfProvided(KeyMapping binding, Boolean pressed) {
    if (binding == null || pressed == null) return;
    InputConstants.Key key = tryGetKeyBindingKey(binding);
    if (key != null) KeyMapping.set(key, pressed);
    binding.setDown(pressed);
  }

  public JsonElement chat(Minecraft client, JsonObject params) {
    if (client == null || client.player == null || client.player.connection == null) return JsonNull.INSTANCE;
    String message = McBridgeApiUtils.getString(params, "message", "");
    if (message == null || message.isBlank()) return JsonNull.INSTANCE;
    client.player.connection.sendChat(message);
    return JsonNull.INSTANCE;
  }

  public JsonElement setMovement(Minecraft client, JsonObject params) {
    if (client == null || client.options == null) return JsonNull.INSTANCE;
    releaseAutomationForManualInput();

    setKeyIfProvided(client.options.keyUp, McBridgeApiUtils.getOptionalBool(params, "forward"));
    setKeyIfProvided(client.options.keyDown, McBridgeApiUtils.getOptionalBool(params, "back"));
    setKeyIfProvided(client.options.keyLeft, McBridgeApiUtils.getOptionalBool(params, "left"));
    setKeyIfProvided(client.options.keyRight, McBridgeApiUtils.getOptionalBool(params, "right"));
    setKeyIfProvided(client.options.keyJump, McBridgeApiUtils.getOptionalBool(params, "jump"));
    setKeyIfProvided(client.options.keyShift, McBridgeApiUtils.getOptionalBool(params, "sneak"));
    setKeyIfProvided(client.options.keySprint, McBridgeApiUtils.getOptionalBool(params, "sprint"));

    return JsonNull.INSTANCE;
  }

  public JsonElement setKey(Minecraft client, JsonObject params) {
    if (client == null || client.options == null) return JsonNull.INSTANCE;
    String key = McBridgeApiUtils.getString(params, "key", "");
    boolean pressed = McBridgeApiUtils.getBool(params, "pressed", false);
    if (pressed && ("forward".equals(key) || "back".equals(key) || "left".equals(key)
        || "right".equals(key) || "jump".equals(key) || "sneak".equals(key) || "sprint".equals(key))) {
      releaseAutomationForManualInput();
    }

    KeyMapping binding = switch (key) {
      case "forward" -> client.options.keyUp;
      case "back" -> client.options.keyDown;
      case "left" -> client.options.keyLeft;
      case "right" -> client.options.keyRight;
      case "jump" -> client.options.keyJump;
      case "sneak" -> client.options.keyShift;
      case "sprint" -> client.options.keySprint;
      case "attack" -> client.options.keyAttack;
      case "use" -> client.options.keyUse;
      default -> null;
    };

    setKeyIfProvided(binding, pressed);
    return JsonNull.INSTANCE;
  }

  private static void releaseAutomationForManualInput() {
    McEntityAutomationService.INSTANCE.reset();
    McMiningService.INSTANCE.cancelForManualInput();
    if (McPathfinderService.EXECUTOR.isActive()) McPathfinderService.EXECUTOR.stop("input_override");
  }

  public JsonElement look(Minecraft client, JsonObject params) {
    if (client == null || client.player == null) return JsonNull.INSTANCE;
    McLookService.INSTANCE.cancelForManualInput();

    String mode = McBridgeApiUtils.getString(params, "mode", "absolute");
    double yaw = McBridgeApiUtils.getDouble(params, "yaw", 0);
    double pitch = McBridgeApiUtils.getDouble(params, "pitch", 0);

    float newYaw = mode.equals("delta") ? (client.player.getYRot() + (float) yaw) : (float) yaw;
    float newPitch = mode.equals("delta") ? (client.player.getXRot() + (float) pitch) : (float) pitch;

    if (newPitch > 90) newPitch = 90;
    if (newPitch < -90) newPitch = -90;

    client.player.setYRot(newYaw);
    client.player.setXRot(newPitch);
    client.player.setYHeadRot(newYaw);
    return JsonNull.INSTANCE;
  }

  public JsonElement click(Minecraft client, JsonObject params) {
    if (client == null || client.player == null || client.gameMode == null) return JsonNull.INSTANCE;
    String button = McBridgeApiUtils.getString(params, "button", "left");

    HitResult hit = client.hitResult;

    if ("right".equals(button)) {
      if (hit instanceof EntityHitResult ehr) {
        Entity e = ehr.getEntity();
        ClientCompat.interact(client, e, InteractionHand.MAIN_HAND);
      } else if (hit instanceof BlockHitResult bhr) {
        client.gameMode.useItemOn(client.player, InteractionHand.MAIN_HAND, bhr);
      } else {
        client.gameMode.useItem(client.player, InteractionHand.MAIN_HAND);
      }
      return JsonNull.INSTANCE;
    }

    // Left click
    if (hit instanceof EntityHitResult ehr) {
      Entity e = ehr.getEntity();
      client.gameMode.attack(client.player, e);
      ClientCompat.swing(client.player, InteractionHand.MAIN_HAND);
      return JsonNull.INSTANCE;
    }

    if (hit instanceof BlockHitResult bhr) {
      client.gameMode.startDestroyBlock(bhr.getBlockPos(), bhr.getDirection());
      ClientCompat.swing(client.player, InteractionHand.MAIN_HAND);
      return JsonNull.INSTANCE;
    }

    ClientCompat.swing(client.player, InteractionHand.MAIN_HAND);
    return JsonNull.INSTANCE;
  }
}
