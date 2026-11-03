package com.jnbot.client.bridge.api.services;

import com.google.gson.JsonElement;
import com.google.gson.JsonNull;
import com.google.gson.JsonObject;
import com.google.gson.JsonArray;
import com.jnbot.client.bridge.api.McBridgeApiUtils;
import net.minecraft.client.Minecraft;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.resources.Identifier;
import net.minecraft.world.effect.MobEffectInstance;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.phys.Vec3;

public final class McPlayerInfoService {
  public JsonElement getPosition(Minecraft client, JsonObject params) {
    if (client == null || client.player == null) return JsonNull.INSTANCE;

    JsonObject out = new JsonObject();
    out.addProperty("x", client.player.getX());
    out.addProperty("y", client.player.getY());
    out.addProperty("z", client.player.getZ());
    out.addProperty("yaw", client.player.getYRot());
    out.addProperty("pitch", client.player.getXRot());
    out.addProperty("onGround", client.player.onGround());

    Vec3 v = client.player.getDeltaMovement();
    if (v != null) {
      JsonObject vel = new JsonObject();
      vel.addProperty("x", v.x);
      vel.addProperty("y", v.y);
      vel.addProperty("z", v.z);
      out.add("velocity", vel);
    }

    Identifier dimension = client.level != null ? client.level.dimension().identifier() : null;
    if (dimension != null) out.addProperty("dimension", dimension.toString());

    return out;
  }

  public JsonElement getHealth(Minecraft client, JsonObject params) {
    if (client == null || client.player == null) return JsonNull.INSTANCE;

    JsonObject out = new JsonObject();
    out.addProperty("health", client.player.getHealth());
    out.addProperty("maxHealth", client.player.getMaxHealth());

    if (client.player.getFoodData() != null) {
      out.addProperty("food", client.player.getFoodData().getFoodLevel());
      out.addProperty("saturation", client.player.getFoodData().getSaturationLevel());
    }

    out.addProperty("air", client.player.getAirSupply());
    out.addProperty("armor", client.player.getArmorValue());
    return out;
  }

  /** XP level/progress. */
  public JsonElement getExperience(Minecraft client, JsonObject params) {
    if (client == null || client.player == null) return JsonNull.INSTANCE;
    JsonObject out = new JsonObject();
    out.addProperty("level", client.player.experienceLevel);
    out.addProperty("progress", client.player.experienceProgress);
    out.addProperty("total", client.player.totalExperience);
    return out;
  }

  /** Currently held items: main hand + off hand. */
  public JsonElement getHeldItems(Minecraft client, JsonObject params) {
    if (client == null || client.player == null) return JsonNull.INSTANCE;

    JsonObject out = new JsonObject();
    out.add("mainHand", serializeStack(client.player.getMainHandItem()));
    out.add("offHand", serializeStack(client.player.getOffhandItem()));
    try {
      out.addProperty("selectedHotbarSlot", client.player.getInventory().getSelectedSlot());
    } catch (Exception ignored) {}
    return out;
  }

  /** Active status effects (potions). */
  public JsonElement getStatusEffects(Minecraft client, JsonObject params) {
    if (client == null || client.player == null) return JsonNull.INSTANCE;
    JsonArray arr = new JsonArray();
    for (MobEffectInstance effect : client.player.getActiveEffects()) {
      JsonObject e = new JsonObject();
      e.addProperty("id", effect.getDescriptionId());
      e.addProperty("amplifier", effect.getAmplifier());
      e.addProperty("duration", effect.getDuration());
      e.addProperty("ambient", effect.isAmbient());
      e.addProperty("showParticles", effect.isVisible());
      arr.add(e);
    }
    JsonObject out = new JsonObject();
    out.add("effects", arr);
    return out;
  }

  public JsonElement getState(Minecraft client, JsonObject params) {
    if (client == null || client.player == null) return JsonNull.INSTANCE;
    JsonObject out = new JsonObject();
    out.addProperty("username", client.player.getName().getString());
    out.addProperty("uuid", client.player.getStringUUID());
    out.addProperty("onGround", client.player.onGround());
    out.addProperty("onFire", client.player.isOnFire());
    out.addProperty("swimming", client.player.isSwimming());
    out.addProperty("sneaking", client.player.isShiftKeyDown());
    out.addProperty("sprinting", client.player.isSprinting());
    out.addProperty("gliding", client.player.isFallFlying());
    out.addProperty("flying", client.player.getAbilities().flying);
    out.addProperty("usingItem", client.player.isUsingItem());
    out.addProperty("sleeping", client.player.isSleeping());
    out.addProperty("hasVehicle", client.player.isPassenger());
    out.addProperty("air", client.player.getAirSupply());
    out.addProperty("fallDistance", client.player.fallDistance);
    if (client.gameMode != null && client.gameMode.getPlayerMode() != null) {
      out.addProperty("gameMode", client.gameMode.getPlayerMode().toString().toLowerCase());
    }
    if (client.player.getVehicle() != null) out.addProperty("vehicleId", client.player.getVehicle().getId());
    return out;
  }

  private static JsonObject serializeStack(ItemStack stack) {
    JsonObject out = new JsonObject();
    if (stack == null || stack.isEmpty()) {
      out.addProperty("empty", true);
      return out;
    }
    out.addProperty("empty", false);
    out.addProperty("count", stack.getCount());
    out.addProperty("itemId", BuiltInRegistries.ITEM.getKey(stack.getItem()).toString());
    out.addProperty("name", stack.getHoverName().getString());
    return out;
  }
}
