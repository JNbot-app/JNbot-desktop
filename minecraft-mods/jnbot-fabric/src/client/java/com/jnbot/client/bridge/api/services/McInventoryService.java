package com.jnbot.client.bridge.api.services;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonNull;
import com.google.gson.JsonObject;
import com.jnbot.client.bridge.api.McBridgeApiUtils;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.screens.inventory.AbstractContainerScreen;
import net.minecraft.client.gui.screens.inventory.InventoryScreen;
import net.minecraft.network.protocol.game.ServerboundSetCarriedItemPacket;
import net.minecraft.world.entity.player.Inventory;
import net.minecraft.world.inventory.AbstractContainerMenu;
import net.minecraft.world.inventory.ClickType;
import net.minecraft.world.inventory.Slot;
import net.minecraft.world.item.ItemStack;
import com.jnbot.client.bridge.api.ItemStackJson;

public final class McInventoryService {
  private static JsonObject serializeStack(ItemStack stack) {
    return ItemStackJson.serialize(stack);
  }

  public JsonElement getCurrentWindow(Minecraft client, JsonObject params) {
    if (client == null || client.player == null) return JsonNull.INSTANCE;

    AbstractContainerMenu handler = client.player.containerMenu;
    if (handler == null) return JsonNull.INSTANCE;

    JsonObject out = new JsonObject();
    out.addProperty("syncId", handler.containerId);
    out.addProperty("inventory", client.screen instanceof InventoryScreen);
    try {
      var type = handler.getType();
      if (type != null) {
        var id = net.minecraft.core.registries.BuiltInRegistries.MENU.getKey(type);
        if (id != null) out.addProperty("type", id.toString());
      }
    } catch (Throwable ignored) {}

    if (client.screen instanceof AbstractContainerScreen<?> screen) {
      out.addProperty("title", screen.getTitle().getString());
      out.addProperty("screenClass", screen.getClass().getName());
    }

    JsonArray slots = new JsonArray();
    for (int i = 0; i < handler.slots.size(); i++) {
      Slot slot = handler.slots.get(i);
      JsonObject s = new JsonObject();
      s.addProperty("slot", i);
      s.addProperty("id", slot.index);
      s.addProperty("x", slot.x);
      s.addProperty("y", slot.y);
      s.add("stack", serializeStack(slot.getItem()));
      slots.add(s);
    }

    out.add("slots", slots);
    out.add("cursorStack", serializeStack(handler.getCarried()));
    out.add("properties", readContainerProperties(handler));

    int selectedSlot = 0;
    try {
      if (client.player.getInventory() != null) selectedSlot = client.player.getInventory().getSelectedSlot();
    } catch (Exception ignored) {}
    out.addProperty("selectedHotbarSlot", selectedSlot);

    return out;
  }

  public JsonElement clickSlot(Minecraft client, JsonObject params) {
    if (client == null || client.player == null || client.gameMode == null) return JsonNull.INSTANCE;

    AbstractContainerMenu handler = client.player.containerMenu;
    if (handler == null) return JsonNull.INSTANCE;

    int slot = McBridgeApiUtils.getInt(params, "slot", -1);
    int button = McBridgeApiUtils.getInt(params, "button", 0);
    String actionTypeRaw = McBridgeApiUtils.getString(params, "actionType", "PICKUP");

    if (slot < 0 && slot != -999 && slot != AbstractContainerMenu.SLOT_CLICKED_OUTSIDE) return JsonNull.INSTANCE;

    ClickType actionType = parseSlotActionType(actionTypeRaw);

    client.gameMode.handleInventoryMouseClick(handler.containerId, slot, button, actionType, client.player);
    return JsonNull.INSTANCE;
  }

  private static ClickType parseSlotActionType(String raw) {
    if (raw == null || raw.isBlank()) return ClickType.PICKUP;
    String s = raw.trim().toUpperCase().replace("-", "_");
    return switch (s) {
      case "QUICK_MOVE", "QUICKMOVE", "SHIFT", "SHIFT_CLICK", "SHIFTCLICK", "1" -> ClickType.QUICK_MOVE;
      case "SWAP", "NUMBER", "HOTBAR", "2" -> ClickType.SWAP;
      case "CLONE", "MIDDLE", "3" -> ClickType.CLONE;
      case "THROW", "DROP", "4" -> ClickType.THROW;
      case "QUICK_CRAFT", "QUICKCRAFT", "DRAG", "5" -> ClickType.QUICK_CRAFT;
      case "PICKUP_ALL", "PICKUPALL", "DOUBLE_CLICK", "DOUBLECLICK", "DOUBLE", "6" -> ClickType.PICKUP_ALL;
      case "PICKUP", "0" -> ClickType.PICKUP;
      default -> {
        try {
          yield ClickType.valueOf(s);
        } catch (Exception e) {
          yield ClickType.PICKUP;
        }
      }
    };
  }

  public JsonElement openInventory(Minecraft client, JsonObject params) {
    if (client == null || client.player == null) return JsonNull.INSTANCE;
    if (!(client.screen instanceof InventoryScreen))
      client.setScreen(new InventoryScreen(client.player));
    return JsonNull.INSTANCE;
  }

  public JsonElement closeWindow(Minecraft client, JsonObject params) {
    if (client == null || client.player == null) return JsonNull.INSTANCE;
    client.player.closeContainer();
    return JsonNull.INSTANCE;
  }

  public JsonElement setHotbarSlot(Minecraft client, JsonObject params) {
    if (client == null || client.player == null || client.player.connection == null) return JsonNull.INSTANCE;

    int slot = McBridgeApiUtils.getInt(params, "slot", 0);
    if (slot < 0) slot = 0;
    if (slot > 8) slot = 8;

    if (client.player.getInventory() != null) {
      try {
        client.player.getInventory().setSelectedSlot(slot);
      } catch (Exception ignored) {
        // Some mappings expose selectedSlot field; but in this workspace it's private.
      }
    }

    client.player.connection.send(new ServerboundSetCarriedItemPacket(slot));
    return JsonNull.INSTANCE;
  }

  public JsonElement findItems(Minecraft client, JsonObject params) {
    JsonObject out = new JsonObject();
    JsonArray matches = new JsonArray();
    out.add("items", matches);
    if (client == null || client.player == null) return out;

    String matching = McBridgeApiUtils.getString(params, "matching", "");
    int limit = Math.min(128, Math.max(1, McBridgeApiUtils.getInt(params, "limit", 128)));
    Inventory inventory = client.player.getInventory();
    int total = 0;
    for (int slot = 0; slot < inventory.getContainerSize(); slot++) {
      ItemStack stack = inventory.getItem(slot);
      if (!ItemStackJson.matches(stack, matching)) continue;
      total += stack.getCount();
      if (matches.size() >= limit) continue;
      JsonObject item = ItemStackJson.serializeDetailed(stack);
      item.addProperty("slot", slot);
      matches.add(item);
    }
    out.addProperty("totalCount", total);
    out.addProperty("matchedSlots", matches.size());
    return out;
  }

  public JsonElement countItem(Minecraft client, JsonObject params) {
    JsonObject found = findItems(client, params).getAsJsonObject();
    JsonObject out = new JsonObject();
    out.addProperty("count", found.has("totalCount") ? found.get("totalCount").getAsInt() : 0);
    return out;
  }

  public JsonElement moveSlot(Minecraft client, JsonObject params) {
    if (client == null || client.player == null || client.gameMode == null) return failed("no_client");
    AbstractContainerMenu handler = client.player.containerMenu;
    int from = McBridgeApiUtils.getInt(params, "from", -1);
    int to = McBridgeApiUtils.getInt(params, "to", -1);
    if (!validSlot(handler, from) || !validSlot(handler, to)) return failed("invalid_slot");
    if (handler.getCarried() != null && !handler.getCarried().isEmpty()) return failed("cursor_not_empty");

    client.gameMode.handleInventoryMouseClick(handler.containerId, from, 0, ClickType.PICKUP, client.player);
    client.gameMode.handleInventoryMouseClick(handler.containerId, to, 0, ClickType.PICKUP, client.player);
    if (handler.getCarried() != null && !handler.getCarried().isEmpty()) {
      client.gameMode.handleInventoryMouseClick(handler.containerId, from, 0, ClickType.PICKUP, client.player);
    }
    return ok(1);
  }

  public JsonElement swapSlots(Minecraft client, JsonObject params) {
    return moveSlot(client, params);
  }

  public JsonElement quickMove(Minecraft client, JsonObject params) {
    if (client == null || client.player == null || client.gameMode == null) return failed("no_client");
    AbstractContainerMenu handler = client.player.containerMenu;
    int slot = McBridgeApiUtils.getInt(params, "slot", -1);
    if (!validSlot(handler, slot)) return failed("invalid_slot");
    client.gameMode.handleInventoryMouseClick(handler.containerId, slot, 0, ClickType.QUICK_MOVE, client.player);
    return ok(1);
  }

  public JsonElement transferMatching(Minecraft client, JsonObject params) {
    if (client == null || client.player == null || client.gameMode == null) return failed("no_client");
    AbstractContainerMenu handler = client.player.containerMenu;
    if (handler == null || handler == client.player.inventoryMenu) return failed("no_container_open");

    String matching = McBridgeApiUtils.getString(params, "matching", "*");
    String from = McBridgeApiUtils.getString(params, "from", "player");
    int limit = Math.min(128, Math.max(1, McBridgeApiUtils.getInt(params, "limit", 128)));
    Inventory playerInventory = client.player.getInventory();
    int moved = 0;

    for (int i = 0; i < handler.slots.size() && moved < limit; i++) {
      Slot slot = handler.slots.get(i);
      boolean playerSide = slot.container == playerInventory;
      if (("player".equalsIgnoreCase(from)) != playerSide) continue;
      ItemStack stack = slot.getItem();
      if (stack == null || stack.isEmpty()) continue;
      if (!"*".equals(matching) && !ItemStackJson.matches(stack, matching)) continue;
      client.gameMode.handleInventoryMouseClick(handler.containerId, i, 0, ClickType.QUICK_MOVE, client.player);
      moved++;
    }
    return ok(moved);
  }

  private static boolean validSlot(AbstractContainerMenu handler, int slot) {
    return handler != null && slot >= 0 && slot < handler.slots.size();
  }

  private static JsonObject readContainerProperties(AbstractContainerMenu handler) {
    JsonObject properties = new JsonObject();
    int added = 0;
    for (java.lang.reflect.Method method : handler.getClass().getMethods()) {
      if (added >= 32 || method.getParameterCount() != 0) continue;
      String name = method.getName();
      if (!(name.startsWith("get") || name.startsWith("is") || name.startsWith("can"))) continue;
      if (name.equals("getClass") || name.equals("getSlots") || name.equals("getCursorStack")) continue;
      Class<?> resultType = method.getReturnType();
      if (!(resultType.isPrimitive() || Number.class.isAssignableFrom(resultType)
          || resultType == Boolean.class || resultType == String.class || resultType.isEnum())) continue;
      try {
        Object value = method.invoke(handler);
        if (value instanceof Number number) properties.addProperty(name, number);
        else if (value instanceof Boolean bool) properties.addProperty(name, bool);
        else if (value != null) properties.addProperty(name, value.toString());
        added++;
      } catch (Exception ignored) {}
    }
    return properties;
  }

  private static JsonObject ok(int affected) {
    JsonObject out = new JsonObject();
    out.addProperty("ok", true);
    out.addProperty("affected", affected);
    return out;
  }

  private static JsonObject failed(String reason) {
    JsonObject out = ok(0);
    out.addProperty("ok", false);
    out.addProperty("reason", reason);
    return out;
  }
}
