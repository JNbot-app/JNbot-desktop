package com.jnbot.client.bridge.api;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import java.lang.reflect.Field;
import java.lang.reflect.Modifier;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import net.minecraft.client.Minecraft;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.network.syncher.EntityDataAccessor;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.entity.EquipmentSlot;
import net.minecraft.world.entity.LivingEntity;
import net.minecraft.world.entity.monster.Monster;
import net.minecraft.world.entity.player.Player;

/** Consistent bounded entity payload used by queries and events. */
public final class EntityJson {
  private EntityJson() {}

  /** per entity class: synced value id -> name */
  private static final Map<Class<?>, Map<Integer, String>> DATA_NAMES = new ConcurrentHashMap<>();

  /** DATA_WOOL_ID -> wool, as minecraft-data names them; none when the game's names are obfuscated */
  private static Map<Integer, String> dataNames(Class<?> type) {
    return DATA_NAMES.computeIfAbsent(type, t -> {
      Map<Integer, String> names = new HashMap<>();
      for (Class<?> c = t; c != null && c != Object.class; c = c.getSuperclass()) {
        for (Field field : c.getDeclaredFields()) {
          if (!Modifier.isStatic(field.getModifiers())
              || field.getType() != EntityDataAccessor.class
              || !field.getName().startsWith("DATA_")) continue;
          try {
            field.setAccessible(true);
            EntityDataAccessor<?> accessor = (EntityDataAccessor<?>) field.get(null);
            names.putIfAbsent(accessor.id(), field.getName()
                .replaceFirst("^DATA_", "").replaceFirst("_ID$", "").toLowerCase(Locale.ROOT));
          } catch (ReflectiveOperationException | RuntimeException ignored) {
            // not readable: sent by id
          }
        }
      }
      return names;
    });
  }

  /** the synced numbers and flags that differ from the entity's defaults (wool, baby, is_ignited…), "#id" when unnamed */
  public static JsonObject data(Entity entity) {
    JsonObject out = new JsonObject();
    var values = entity.getEntityData().getNonDefaultValues();
    if (values == null) return out;
    Map<Integer, String> names = dataNames(entity.getClass());
    for (var value : values) {
      String name = names.getOrDefault(value.id(), "#" + value.id());
      if (value.value() instanceof Boolean flag) out.addProperty(name, flag);
      else if (value.value() instanceof Number number) out.addProperty(name, number);
    }
    return out;
  }

  public static JsonObject serialize(Minecraft client, Entity entity, boolean details) {
    JsonObject out = new JsonObject();
    out.addProperty("id", entity.getId());
    out.addProperty("type", BuiltInRegistries.ENTITY_TYPE.getKey(entity.getType()).toString());
    out.addProperty("name", entity.getName().getString());
    out.addProperty("x", entity.getX());
    out.addProperty("y", entity.getY());
    out.addProperty("z", entity.getZ());
    out.addProperty("isAlive", entity.isAlive());
    out.addProperty("hostile", entity instanceof Monster);
    if (client != null && client.player != null) {
      out.addProperty("distance", client.player.distanceTo(entity));
    }
    if (!details) return out;

    out.addProperty("yaw", entity.getYRot());
    out.addProperty("pitch", entity.getXRot());
    out.addProperty("onGround", entity.onGround());
    out.addProperty("sneaking", entity.isShiftKeyDown());
    out.addProperty("sprinting", entity.isSprinting());
    out.addProperty("onFire", entity.isOnFire());
    out.addProperty("vehicle", entity.isPassenger());

    if (entity instanceof LivingEntity living) {
      out.addProperty("health", living.getHealth());
      out.addProperty("maxHealth", living.getMaxHealth());
      JsonArray equipment = new JsonArray();
      for (EquipmentSlot slot : EquipmentSlot.values()) {
        var stack = living.getItemBySlot(slot);
        if (stack == null || stack.isEmpty()) continue;
        JsonObject item = ItemStackJson.serialize(stack);
        item.addProperty("slot", slot.getName());
        equipment.add(item);
      }
      out.add("equipment", equipment);
    }
    if (entity instanceof Player player) out.addProperty("uuid", player.getStringUUID());
    return out;
  }
}
