package com.jnbot.client.bridge.api;

import com.google.gson.JsonObject;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.world.item.ItemStack;

/** Compact, shared item representation used by snapshots and delta events. */
public final class ItemStackJson {
  private static final int MAX_COMPONENT_TEXT = 2048;

  private ItemStackJson() {}

  public static JsonObject serialize(ItemStack stack) {
    return serialize(stack, false);
  }

  public static JsonObject serializeDetailed(ItemStack stack) {
    return serialize(stack, true);
  }

  private static JsonObject serialize(ItemStack stack, boolean includeComponents) {
    JsonObject out = new JsonObject();
    if (stack == null || stack.isEmpty()) {
      out.addProperty("empty", true);
      return out;
    }

    out.addProperty("empty", false);
    out.addProperty("count", stack.getCount());
    out.addProperty("itemId", BuiltInRegistries.ITEM.getKey(stack.getItem()).toString());
    out.addProperty("name", stack.getHoverName().getString());
    out.addProperty("maxCount", stack.getMaxStackSize());
    out.addProperty("damage", stack.getDamageValue());
    out.addProperty("maxDamage", stack.getMaxDamage());
    out.addProperty("enchantingGlint", stack.hasFoil());

    String components = includeComponents ? stack.getComponents().toString() : null;
    if (components != null && !components.equals("[]")) {
      if (components.length() > MAX_COMPONENT_TEXT) {
        components = components.substring(0, MAX_COMPONENT_TEXT);
        out.addProperty("componentsTruncated", true);
      }
      out.addProperty("components", components);
    }
    return out;
  }

  public static int signature(ItemStack stack) {
    if (stack == null || stack.isEmpty()) return 0;
    int hash = BuiltInRegistries.ITEM.getKey(stack.getItem()).hashCode();
    hash = hash * 31 + stack.getCount();
    hash = hash * 31 + stack.getDamageValue();
    hash = hash * 31 + stack.getComponents().hashCode();
    return hash;
  }

  public static boolean matches(ItemStack stack, String matching) {
    if (stack == null || stack.isEmpty() || matching == null || matching.isBlank()) return false;
    String needle = matching.toLowerCase();
    String id = BuiltInRegistries.ITEM.getKey(stack.getItem()).toString().toLowerCase();
    return id.equals(needle)
        || (!needle.contains(":") && id.endsWith(":" + needle))
        || stack.getHoverName().getString().toLowerCase().contains(needle);
  }
}
