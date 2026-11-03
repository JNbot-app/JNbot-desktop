package com.jnbot.client.automation;

import com.jnbot.client.compat.ClientCompat;
import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import com.jnbot.client.bridge.JnbotMcBridgeClient;
import com.jnbot.client.bridge.api.EntityJson;
import com.jnbot.client.bridge.api.ItemStackJson;
import com.jnbot.client.bridge.api.services.McPathfinderService;
import com.mojang.blaze3d.platform.InputConstants;
import net.fabricmc.fabric.api.client.keybinding.v1.KeyBindingHelper;
import net.fabricmc.fabric.api.client.message.v1.ClientSendMessageEvents;
import net.minecraft.client.KeyMapping;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.screens.inventory.AbstractContainerScreen;
import net.minecraft.core.BlockPos;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.network.protocol.Packet;
import net.minecraft.network.protocol.game.ServerboundContainerButtonClickPacket;
import net.minecraft.network.protocol.game.ServerboundEditBookPacket;
import net.minecraft.network.protocol.game.ServerboundPickItemFromBlockPacket;
import net.minecraft.network.protocol.game.ServerboundPickItemFromEntityPacket;
import net.minecraft.network.protocol.game.ServerboundPlayerActionPacket;
import net.minecraft.network.protocol.game.ServerboundPlayerCommandPacket;
import net.minecraft.network.protocol.game.ServerboundRenameItemPacket;
import net.minecraft.network.protocol.game.ServerboundSelectBundleItemPacket;
import net.minecraft.network.protocol.game.ServerboundSelectTradePacket;
import net.minecraft.network.protocol.game.ServerboundSignUpdatePacket;
import net.minecraft.util.Mth;
import net.minecraft.world.InteractionHand;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.inventory.ClickType;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.phys.BlockHitResult;

public final class AutomationRecorderController {
  public static final AutomationRecorderController INSTANCE = new AutomationRecorderController();

  private KeyMapping toggleRecording;
  private KeyMapping togglePause;
  private boolean recording;
  private boolean paused;
  private boolean playback;
  private boolean playbackPaused;
  private int syntheticDepth;
  private int stepCount;
  private int captureTick;
  private long startedAt;
  private double lastX = Double.NaN;
  private double lastY = Double.NaN;
  private double lastZ = Double.NaN;
  private float lastYaw = Float.NaN;
  private float lastPitch = Float.NaN;
  private int lastHotbar = -1;
  private boolean manualInputSent;
  private boolean motionWasActive;
  private JsonArray motionFrames = new JsonArray();
  private int motionIndex;
  private int motionDriftTicks;
  private boolean motionActive;
  private String motionError;
  private boolean motionRecovering;
  private int motionRecoveryIndex;
  private int motionRecoveryAttempts;
  private int motionRecoveryGraceTicks;
  private long motionRecoveryStartedAt;

  private AutomationRecorderController() {}

  public void register() {
    toggleRecording = KeyBindingHelper.registerKeyBinding(new KeyMapping(
        "key.jnbot.automation.toggle_recording",
        InputConstants.Type.KEYSYM,
        InputConstants.KEY_F8,
        KeyMapping.Category.MISC));
    togglePause = KeyBindingHelper.registerKeyBinding(new KeyMapping(
        "key.jnbot.automation.toggle_pause",
        InputConstants.Type.KEYSYM,
        InputConstants.KEY_F9,
        KeyMapping.Category.MISC));

    ClientSendMessageEvents.CHAT.register(message -> recordChat(message));
    ClientSendMessageEvents.COMMAND.register(command -> recordChat("/" + command));
  }

  public void tick(Minecraft client) {
    while (toggleRecording != null && toggleRecording.consumeClick())
      sendHotkey("toggleRecording");
    while (togglePause != null && togglePause.consumeClick())
      sendHotkey("togglePause");

    if (client == null || client.player == null) return;
    if (playback && !isSynthetic() && physicalGameplayInput(client)) {
      if (!manualInputSent) {
        manualInputSent = true;
        JsonObject data = new JsonObject();
        data.addProperty("ts", System.currentTimeMillis());
        JnbotMcBridgeClient.getInstance().sendEvent("mc.automation.manualInput", data);
      }
    } else {
      manualInputSent = false;
    }

    if (playback && !playbackPaused && motionActive) tickMotion(client);
    if (!recording || paused || isSynthetic()) return;
    if (client.screen != null) {
      motionWasActive = false;
      int hotbar = client.player.getInventory().getSelectedSlot();
      if (lastHotbar >= 0 && hotbar != lastHotbar) {
        JsonObject action = base("hotbar");
        action.addProperty("slot", hotbar);
        sendAction(action);
      }
      lastHotbar = hotbar;
      return;
    }

    captureTick++;
    double x = client.player.getX();
    double y = client.player.getY();
    double z = client.player.getZ();
    float yaw = client.player.getYRot();
    float pitch = client.player.getXRot();
    boolean moved = Double.isNaN(lastX)
        || Math.abs(x - lastX) > 0.04
        || Math.abs(y - lastY) > 0.04
        || Math.abs(z - lastZ) > 0.04;
    boolean looked = Float.isNaN(lastYaw)
        || Math.abs(yaw - lastYaw) > 1f
        || Math.abs(pitch - lastPitch) > 1f;
    boolean forward = client.options.keyUp.isDown();
    boolean back = client.options.keyDown.isDown();
    boolean left = client.options.keyLeft.isDown();
    boolean right = client.options.keyRight.isDown();
    boolean jump = client.options.keyJump.isDown();
    boolean sneak = client.options.keyShift.isDown() || client.player.isShiftKeyDown();
    boolean sprint = client.options.keySprint.isDown() || client.player.isSprinting();
    net.minecraft.world.phys.Vec3 vel = client.player.getDeltaMovement();
    boolean hasHorizVel = vel != null && (vel.x * vel.x + vel.z * vel.z) > 0.0004;
    boolean hasVertVel = vel != null && !client.player.onGround() && Math.abs(vel.y + 0.0784) > 0.01;
    boolean motionActive = moved || looked || forward || back || left || right
        || jump || sneak || sprint || hasHorizVel || hasVertVel;
    if (motionActive || motionWasActive) {
      JsonObject action = base("move");
      JsonObject pos = new JsonObject();
      pos.addProperty("x", x);
      pos.addProperty("y", y);
      pos.addProperty("z", z);
      action.add("position", pos);
      JsonObject velocity = new JsonObject();
      velocity.addProperty("x", client.player.getDeltaMovement().x);
      velocity.addProperty("y", client.player.getDeltaMovement().y);
      velocity.addProperty("z", client.player.getDeltaMovement().z);
      action.add("velocity", velocity);
      action.addProperty("tick", captureTick);
      action.addProperty("yaw", yaw);
      action.addProperty("pitch", pitch);
      action.addProperty("onGround", client.player.onGround());
      action.addProperty("riding", client.player.getVehicle() != null);
      action.addProperty("forward", forward);
      action.addProperty("back", back);
      action.addProperty("left", left);
      action.addProperty("right", right);
      action.addProperty("jump", jump);
      action.addProperty("sprint", sprint);
      action.addProperty("sneak", sneak);
      sendAction(action);
      lastX = x;
      lastY = y;
      lastZ = z;
      lastYaw = yaw;
      lastPitch = pitch;
    }
    motionWasActive = motionActive;

    int hotbar = client.player.getInventory().getSelectedSlot();
    if (lastHotbar >= 0 && hotbar != lastHotbar) {
      JsonObject action = base("hotbar");
      action.addProperty("slot", hotbar);
      sendAction(action);
    }
    lastHotbar = hotbar;
  }

  public JsonObject startCapture(Minecraft client, JsonObject params) {
    recording = true;
    paused = false;
    stepCount = 0;
    captureTick = 0;
    startedAt = System.currentTimeMillis();
    resetSamples();
    if (client != null && client.player != null && client.player.getInventory() != null) {
      int initialHotbar = client.player.getInventory().getSelectedSlot();
      lastHotbar = initialHotbar;
      JsonObject action = base("hotbar");
      action.addProperty("slot", initialHotbar);
      sendAction(action);
    }
    return status();
  }

  public JsonObject pauseCapture(Minecraft client, JsonObject params) {
    if (recording) paused = true;
    return status();
  }

  public JsonObject resumeCapture(Minecraft client, JsonObject params) {
    if (recording) paused = false;
    resetSamples();
    return status();
  }

  public JsonObject stopCapture(Minecraft client, JsonObject params) {
    recording = false;
    paused = false;
    return status();
  }

  public JsonObject startPlayback(Minecraft client, JsonObject params) {
    playback = true;
    playbackPaused = false;
    manualInputSent = false;
    stopMotionInternal(client);
    return status();
  }

  public JsonObject pausePlayback(Minecraft client, JsonObject params) {
    if (playback) {
      playbackPaused = true;
      releaseMotionKeys(client);
    }
    return status();
  }

  public JsonObject resumePlayback(Minecraft client, JsonObject params) {
    if (playback) playbackPaused = false;
    return status();
  }

  public JsonObject stopPlayback(Minecraft client, JsonObject params) {
    playback = false;
    playbackPaused = false;
    manualInputSent = false;
    stopMotionInternal(client);
    return status();
  }

  public JsonObject startMotion(Minecraft client, JsonObject params) {
    if (!playback) throw new IllegalStateException("Playback is not active");
    JsonArray frames = params.getAsJsonArray("frames");
    if (frames == null || frames.isEmpty())
      throw new IllegalArgumentException("Motion frames are required");
    motionFrames = frames.deepCopy();
    motionIndex = 0;
    motionDriftTicks = 0;
    motionError = null;
    motionRecovering = false;
    motionRecoveryIndex = 0;
    motionRecoveryAttempts = 0;
    motionRecoveryGraceTicks = 0;
    motionRecoveryStartedAt = 0;
    motionActive = true;
    return motionStatus(client, params);
  }

  public JsonObject motionStatus(Minecraft client, JsonObject params) {
    JsonObject out = new JsonObject();
    out.addProperty("active", motionActive);
    out.addProperty("index", motionIndex);
    out.addProperty("total", motionFrames.size());
    if (motionError != null) out.addProperty("error", motionError);
    return out;
  }

  public JsonObject stopMotion(Minecraft client, JsonObject params) {
    stopMotionInternal(client);
    return motionStatus(client, params);
  }

  public JsonObject replayScreenAction(Minecraft client, JsonObject params) {
    if (client == null || client.player == null || client.player.connection == null)
      throw new IllegalStateException("Minecraft client is unavailable");
    String action = params.has("action") ? params.get("action").getAsString() : "";
    JsonObject data = params.has("data") && params.get("data").isJsonObject()
        ? params.getAsJsonObject("data") : new JsonObject();
    switch (action) {
      case "button" -> {
        int button = data.has("button") ? data.get("button").getAsInt() : 0;
        client.gameMode.handleInventoryButtonClick(client.player.containerMenu.containerId, button);
      }
      case "trade" -> client.player.connection.send(new ServerboundSelectTradePacket(
          data.has("trade") ? data.get("trade").getAsInt() : 0));
      case "rename" -> client.player.connection.send(new ServerboundRenameItemPacket(
          data.has("name") ? data.get("name").getAsString() : ""));
      case "bundle" -> client.player.connection.send(new ServerboundSelectBundleItemPacket(
          data.has("slot") ? data.get("slot").getAsInt() : 0,
          data.has("selected") ? data.get("selected").getAsInt() : 0));
      case "book" -> {
        JsonArray pages = data.has("pages") && data.get("pages").isJsonArray() ? data.getAsJsonArray("pages") : new JsonArray();
        java.util.List<String> values = new java.util.ArrayList<>();
        for (var page : pages) values.add(page.getAsString());
        java.util.Optional<String> title = data.has("title") ? java.util.Optional.of(data.get("title").getAsString()) : java.util.Optional.empty();
        client.player.connection.send(new ServerboundEditBookPacket(
            data.has("slot") ? data.get("slot").getAsInt() : 0, values, title));
      }
      case "sign" -> {
        JsonObject position = data.has("position") ? data.getAsJsonObject("position") : new JsonObject();
        JsonArray lines = data.has("lines") && data.get("lines").isJsonArray() ? data.getAsJsonArray("lines") : new JsonArray();
        String[] text = {"", "", "", ""};
        for (int i = 0; i < Math.min(4, lines.size()); i++) text[i] = lines.get(i).getAsString();
        client.player.connection.send(ClientCompat.signUpdatePacket(new BlockPos(
            position.has("x") ? position.get("x").getAsInt() : 0,
            position.has("y") ? position.get("y").getAsInt() : 0,
            position.has("z") ? position.get("z").getAsInt() : 0),
            !data.has("front") || data.get("front").getAsBoolean(), text));
      }
      case "pickItem" -> {
        if (data.has("entityId")) client.player.connection.send(new ServerboundPickItemFromEntityPacket(
            data.get("entityId").getAsInt(), data.has("includeData") && data.get("includeData").getAsBoolean()));
        else {
          JsonObject position = data.has("position") ? data.getAsJsonObject("position") : new JsonObject();
          client.player.connection.send(new ServerboundPickItemFromBlockPacket(new BlockPos(
              position.has("x") ? position.get("x").getAsInt() : 0,
              position.has("y") ? position.get("y").getAsInt() : 0,
              position.has("z") ? position.get("z").getAsInt() : 0),
              data.has("includeData") && data.get("includeData").getAsBoolean()));
        }
      }
      default -> throw new IllegalArgumentException("Unsupported screen action: " + action);
    }
    return status();
  }

  public void onPacket(Packet<?> packet) {
    if (!recording || paused || isSynthetic() || packet == null) return;
    JsonObject action = base("screenAction");
    JsonObject data = new JsonObject();
    if (packet instanceof ServerboundPlayerActionPacket value
        && value.getAction() == ServerboundPlayerActionPacket.Action.SWAP_ITEM_WITH_OFFHAND) {
      sendAction(base("swapHands"));
      return;
    } else if (packet instanceof ServerboundPlayerCommandPacket value
        && value.getAction() == ServerboundPlayerCommandPacket.Action.STOP_SLEEPING) {
      sendAction(base("wake"));
      return;
    } else if (packet instanceof ServerboundContainerButtonClickPacket value) {
      action.addProperty("action", "button"); data.addProperty("button", value.buttonId());
    } else if (packet instanceof ServerboundSelectTradePacket value) {
      action.addProperty("action", "trade"); data.addProperty("trade", value.getItem());
    } else if (packet instanceof ServerboundRenameItemPacket value) {
      action.addProperty("action", "rename"); data.addProperty("name", value.getName());
    } else if (packet instanceof ServerboundSelectBundleItemPacket value) {
      action.addProperty("action", "bundle"); data.addProperty("slot", value.slotId()); data.addProperty("selected", value.selectedItemIndex());
    } else if (packet instanceof ServerboundEditBookPacket value) {
      action.addProperty("action", "book"); data.addProperty("slot", value.slot());
      JsonArray pages = new JsonArray(); for (String page : value.pages()) pages.add(page); data.add("pages", pages);
      value.title().ifPresent(title -> data.addProperty("title", title));
    } else if (packet instanceof ServerboundSignUpdatePacket value) {
      action.addProperty("action", "sign");
      JsonObject pos = new JsonObject(); pos.addProperty("x", ClientCompat.signPos(value).getX()); pos.addProperty("y", ClientCompat.signPos(value).getY()); pos.addProperty("z", ClientCompat.signPos(value).getZ()); data.add("position", pos);
      data.addProperty("front", ClientCompat.signIsFront(value)); JsonArray lines = new JsonArray(); for (String line : ClientCompat.signLines(value)) lines.add(line); data.add("lines", lines);
    } else if (packet instanceof ServerboundPickItemFromBlockPacket value) {
      action.addProperty("action", "pickItem"); JsonObject pos = new JsonObject(); pos.addProperty("x", value.pos().getX()); pos.addProperty("y", value.pos().getY()); pos.addProperty("z", value.pos().getZ()); data.add("position", pos); data.addProperty("includeData", value.includeData());
    } else if (packet instanceof ServerboundPickItemFromEntityPacket value) {
      action.addProperty("action", "pickItem"); data.addProperty("entityId", value.id()); data.addProperty("includeData", value.includeData());
    } else {
      return;
    }
    action.add("data", data);
    sendAction(action);
  }

  public void onExternalAction(JsonObject action) {
    if (!recording || paused || isSynthetic() || action == null) return;
    sendAction(action);
  }

  public void onDropItem(boolean entireStack) {
    JsonObject action = new JsonObject();
    action.addProperty("kind", "dropItem");
    action.addProperty("entireStack", entireStack);
    action.addProperty("ts", System.currentTimeMillis());
    onExternalAction(action);
  }

  public void beginSynthetic() {
    syntheticDepth++;
  }

  public void endSynthetic() {
    syntheticDepth = Math.max(0, syntheticDepth - 1);
  }

  public boolean isRecording() {
    return recording;
  }

  public boolean isPaused() {
    return paused;
  }

  public boolean isPlayback() {
    return playback;
  }

  public boolean isPlaybackPaused() {
    return playbackPaused;
  }

  public int getStepCount() {
    return stepCount;
  }

  public long getElapsedMs() {
    return recording ? Math.max(0, System.currentTimeMillis() - startedAt) : 0;
  }

  public void onWindowClick(
      Minecraft client,
      int syncId,
      int slot,
      int button,
      ClickType actionType
  ) {
    if (!recording || paused || isSynthetic() || client == null || client.player == null) return;
    try {
      JsonObject action = base("windowClick");
      action.addProperty("slot", slot);
      action.addProperty("button", button);
      action.addProperty("actionType", actionType != null ? actionType.name() : "PICKUP");
      if (client.screen instanceof AbstractContainerScreen<?> handled) {
        action.addProperty("windowTitle", handled.getTitle().getString());
        if (client.screen instanceof net.minecraft.client.gui.screens.inventory.InventoryScreen) {
          action.addProperty("inventory", true);
        } else {
          try {
            var handler = client.player.containerMenu;
            var type = handler != null ? handler.getType() : null;
            if (type != null) {
              var id = BuiltInRegistries.MENU.getKey(type);
              if (id != null) action.addProperty("windowType", id.toString());
            }
          } catch (Throwable ignored) {}
        }
      }
      if (client.player.containerMenu != null
          && slot >= 0
          && slot < client.player.containerMenu.slots.size()) {
        action.add("item", ItemStackJson.serializeDetailed(
            client.player.containerMenu.slots.get(slot).getItem()));
      }
      sendAction(action);
    } catch (Throwable ignored) {}
  }

  public void onWindowClosed() {
    if (!recording || paused || isSynthetic()) return;
    sendAction(base("closeWindow"));
  }

  public void onInventoryOpened() {
    if (!recording || paused || isSynthetic()) return;
    sendAction(base("openInventory"));
  }

  public void onReleaseUseItem() {
    if (!recording || paused || isSynthetic()) return;
    sendAction(base("releaseUseItem"));
  }

  public void onInteractBlock(InteractionHand hand, BlockHitResult hit) {
    if (!recording || paused || isSynthetic() || hit == null) return;
    JsonObject action = base("useBlock");
    action.add("position", position(hit.getBlockPos()));
    action.addProperty("face", hit.getDirection().getSerializedName());
    action.addProperty("hand", handName(hand));
    Minecraft client = Minecraft.getInstance();
    if (client != null && client.level != null) {
      BlockState before = client.level.getBlockState(hit.getBlockPos());
      action.addProperty("blockBefore", BuiltInRegistries.BLOCK.getKey(before.getBlock()).toString());
    }
    sendAction(action);
  }

  public void onInteractItem(InteractionHand hand) {
    if (!recording || paused || isSynthetic()) return;
    JsonObject action = base("useItem");
    action.addProperty("hand", handName(hand));
    sendAction(action);
  }

  public void onBreakBlock(BlockPos pos) {
    if (!recording || paused || isSynthetic() || pos == null) return;
    Minecraft client = Minecraft.getInstance();
    JsonObject action = base("breakBlock");
    action.add("position", position(pos));
    action.addProperty("face", "up");
    action.addProperty("hand", "main");
    if (client != null && client.level != null) {
      BlockState before = client.level.getBlockState(pos);
      action.addProperty("blockBefore", BuiltInRegistries.BLOCK.getKey(before.getBlock()).toString());
    }
    sendAction(action);
  }

  public void onAttackEntity(InteractionHand hand, Entity entity) {
    if (!recording || paused || isSynthetic() || entity == null) return;
    sendEntityAction("attackEntity", hand, entity);
  }

  public void onUseEntity(InteractionHand hand, Entity entity) {
    if (!recording || paused || isSynthetic() || entity == null) return;
    sendEntityAction("useEntity", hand, entity);
  }

  private void recordChat(String message) {
    if (!recording || paused || isSynthetic()) return;
    JsonObject action = base("chat");
    action.addProperty("message", message);
    sendAction(action);
  }

  private void sendEntityAction(String kind, InteractionHand hand, Entity entity) {
    Minecraft client = Minecraft.getInstance();
    JsonObject serialized = EntityJson.serialize(client, entity, true);
    JsonObject entityData = new JsonObject();
    entityData.addProperty("sourceRuntimeId", entity.getId());
    if (serialized.has("uuid")) entityData.add("uuid", serialized.get("uuid"));
    entityData.add("type", serialized.get("type"));
    entityData.add("name", serialized.get("name"));
    JsonObject pos = new JsonObject();
    pos.add("x", serialized.get("x"));
    pos.add("y", serialized.get("y"));
    pos.add("z", serialized.get("z"));
    entityData.add("position", pos);
    entityData.addProperty("radius", 16);
    JsonObject action = base(kind);
    action.add("entity", entityData);
    action.addProperty("hand", handName(hand));
    sendAction(action);
  }

  private boolean physicalGameplayInput(Minecraft client) {
    return isPhysicallyPressed(client, client.options.keyUp)
        || isPhysicallyPressed(client, client.options.keyDown)
        || isPhysicallyPressed(client, client.options.keyLeft)
        || isPhysicallyPressed(client, client.options.keyRight)
        || isPhysicallyPressed(client, client.options.keyJump)
        || isPhysicallyPressed(client, client.options.keyShift)
        || isPhysicallyPressed(client, client.options.keySprint)
        || isPhysicallyPressed(client, client.options.keyAttack)
        || isPhysicallyPressed(client, client.options.keyUse);
  }

  private boolean isPhysicallyPressed(
      Minecraft client,
      KeyMapping binding
  ) {
    if (binding == null || binding.isUnbound()) return false;
    InputConstants.Key key = InputConstants.getKey(
        binding.saveString());
    if (key.getType() == InputConstants.Type.MOUSE)
      return ClientCompat.isMouseButtonDown(client, key.getValue());
    if (key.getType() == InputConstants.Type.KEYSYM)
      return ClientCompat.isKeyDown(client, key.getValue());
    return false;
  }

  private boolean isSynthetic() {
    return syntheticDepth > 0;
  }

  private void tickMotion(Minecraft client) {
    if (motionRecovering) {
      if (System.currentTimeMillis() - motionRecoveryStartedAt > 10_000) {
        McPathfinderService.EXECUTOR.stop("automation_recovery_timeout");
        motionRecovering = false;
        motionActive = false;
        motionError = "Motion recovery timed out";
        releaseMotionKeys(client);
        return;
      }
      if (McPathfinderService.EXECUTOR.isActive()) return;
      motionRecovering = false;
      // The anchor itself has already been reached; continue with the next frame.
      motionIndex = Math.min(motionFrames.size(), motionRecoveryIndex + 1);
      motionDriftTicks = 0;
      motionRecoveryAttempts = 0;
      motionRecoveryGraceTicks = 20;
      return;
    }
    if (motionRecoveryGraceTicks > 0) {
      motionRecoveryGraceTicks--;
    } else if (motionIndex > 0 && !checkMotionDrift(client, motionIndex - 1)) return;
    if (motionIndex >= motionFrames.size()) {
      motionActive = false;
      releaseMotionKeys(client);
      return;
    }
    JsonObject frame = motionFrames.get(motionIndex).getAsJsonObject();
    float yaw = (float) number(frame, "yaw", client.player.getYRot());
    if (bool(frame, "forward") && !bool(frame, "back")
        && !bool(frame, "left") && !bool(frame, "right")) {
      double dx = number(frame, "x", client.player.getX()) - client.player.getX();
      double dz = number(frame, "z", client.player.getZ()) - client.player.getZ();
      if (dx * dx + dz * dz > 0.12) {
        float targetYaw = (float) Math.toDegrees(Math.atan2(-dx, dz));
        yaw += Mth.clamp(Mth.wrapDegrees(targetYaw - yaw), -8f, 8f);
      }
    }
    float pitch = (float) number(frame, "pitch", client.player.getXRot());
    client.player.setYRot(yaw);
    client.player.setXRot(Mth.clamp(pitch, -90f, 90f));
    client.player.setYHeadRot(yaw);
    setMotionKey(client.options.keyUp, bool(frame, "forward"));
    setMotionKey(client.options.keyDown, bool(frame, "back"));
    setMotionKey(client.options.keyLeft, bool(frame, "left"));
    setMotionKey(client.options.keyRight, bool(frame, "right"));
    setMotionKey(client.options.keyJump, bool(frame, "jump"));
    setMotionKey(client.options.keyShift, bool(frame, "sneak"));
    setMotionKey(client.options.keySprint, bool(frame, "sprint"));
    motionIndex++;
  }

  private boolean checkMotionDrift(Minecraft client, int expectedIndex) {
    JsonObject expected = motionFrames.get(expectedIndex).getAsJsonObject();
    if (!bool(expected, "onGround") || !client.player.onGround()
        || bool(expected, "jump") || bool(expected, "riding")
        || client.player.getVehicle() != null) return true;
    double error = distance(client, expected);
    motionDriftTicks = error > 0.5 ? motionDriftTicks + 1 : 0;
    if (motionDriftTicks < 3) return true;
    if (motionRecoveryAttempts >= 2 || !startMotionRecovery(client, expectedIndex)) {
      motionError = "Motion recovery failed after two anchor attempts (drift: " + String.format("%.3f", error) + ")";
      motionActive = false;
      releaseMotionKeys(client);
      return false;
    }
    motionRecoveryAttempts++;
    return false;
  }

  private boolean startMotionRecovery(Minecraft client, int expectedIndex) {
    releaseMotionKeys(client);
    for (int index = expectedIndex; index >= 0; index--) {
      JsonObject anchor = motionFrames.get(index).getAsJsonObject();
      if (!bool(anchor, "onGround") || bool(anchor, "jump") || bool(anchor, "riding")) continue;
      JsonObject params = new JsonObject();
      params.addProperty("x", (int) Math.floor(number(anchor, "x", client.player.getX())));
      params.addProperty("y", (int) Math.floor(number(anchor, "y", client.player.getY())));
      params.addProperty("z", (int) Math.floor(number(anchor, "z", client.player.getZ())));
      params.addProperty("arriveRadius", 0.5);
      params.addProperty("maxRange", 64);
      params.addProperty("maxNodes", 10000);
      try {
        JsonObject result = new McPathfinderService().goTo(client, params).getAsJsonObject();
        sendDebugLog("Pathfinding results: " + result.toString());
        if (!result.has("ok") || !result.get("ok").getAsBoolean()) {
          return false;
        }
        motionRecovering = true;
        motionRecoveryIndex = index;
        motionRecoveryStartedAt = System.currentTimeMillis();
        return true;
      } catch (Exception ignored) {
        sendDebugLog("Motion recovery threw an exception", ignored);
      }
    }
    return false;
  }

  private void sendDebugLog(String message) {
    sendDebugLog(message, null);
  }

  private void sendDebugLog(String message, Exception error) {
    JsonObject data = new JsonObject();
    data.addProperty("message", message);
    if (error != null && error.getMessage() != null)
      data.addProperty("error", error.getMessage());
    if (error != null)
      data.addProperty("stack", java.util.Arrays.toString(error.getStackTrace()));
    JnbotMcBridgeClient.getInstance().sendEvent("mc.debug.log", data);
  }

  private double distance(Minecraft client, JsonObject frame) {
    return Math.sqrt(
        Math.pow(client.player.getX() - number(frame, "x", client.player.getX()), 2)
            + Math.pow(client.player.getY() - number(frame, "y", client.player.getY()), 2)
            + Math.pow(client.player.getZ() - number(frame, "z", client.player.getZ()), 2));
  }

  private double motionScore(
      Minecraft client,
      JsonObject frame,
      double positionError
  ) {
    if (!frame.has("velocity") || !frame.get("velocity").isJsonObject())
      return positionError;
    JsonObject velocity = frame.getAsJsonObject("velocity");
    double dx = client.player.getDeltaMovement().x - number(velocity, "x", 0);
    double dy = client.player.getDeltaMovement().y - number(velocity, "y", 0);
    double dz = client.player.getDeltaMovement().z - number(velocity, "z", 0);
    return positionError + Math.sqrt(dx * dx + dy * dy + dz * dz) * 0.75;
  }

  private double number(JsonObject object, String key, double fallback) {
    return object.has(key) ? object.get(key).getAsDouble() : fallback;
  }

  private boolean bool(JsonObject object, String key) {
    return object.has(key) && object.get(key).getAsBoolean();
  }

  private void setMotionKey(KeyMapping binding, boolean pressed) {
    if (binding != null) binding.setDown(pressed);
  }

  private void releaseMotionKeys(Minecraft client) {
    if (client == null || client.options == null) return;
    setMotionKey(client.options.keyUp, false);
    setMotionKey(client.options.keyDown, false);
    setMotionKey(client.options.keyLeft, false);
    setMotionKey(client.options.keyRight, false);
    setMotionKey(client.options.keyJump, false);
    setMotionKey(client.options.keyShift, false);
    setMotionKey(client.options.keySprint, false);
  }

  private void stopMotionInternal(Minecraft client) {
    motionActive = false;
    motionFrames = new JsonArray();
    motionIndex = 0;
    motionDriftTicks = 0;
    motionError = null;
    motionRecovering = false;
    motionRecoveryIndex = 0;
    motionRecoveryAttempts = 0;
    motionRecoveryGraceTicks = 0;
    motionRecoveryStartedAt = 0;
    releaseMotionKeys(client);
  }

  private void sendAction(JsonObject action) {
    stepCount++;
    JnbotMcBridgeClient.getInstance().sendEvent("mc.automation.action", action);
  }

  private void sendHotkey(String action) {
    JsonObject data = new JsonObject();
    data.addProperty("action", action);
    data.addProperty("ts", System.currentTimeMillis());
    JnbotMcBridgeClient.getInstance().sendEvent("mc.automation.hotkey", data);
  }

  private JsonObject base(String kind) {
    JsonObject action = new JsonObject();
    action.addProperty("kind", kind);
    action.addProperty("ts", System.currentTimeMillis());
    return action;
  }

  private JsonObject position(BlockPos pos) {
    JsonObject out = new JsonObject();
    out.addProperty("x", pos.getX());
    out.addProperty("y", pos.getY());
    out.addProperty("z", pos.getZ());
    return out;
  }

  private String handName(InteractionHand hand) {
    return hand == InteractionHand.OFF_HAND ? "off" : "main";
  }

  private void resetSamples() {
    lastX = Double.NaN;
    lastY = Double.NaN;
    lastZ = Double.NaN;
    lastYaw = Float.NaN;
    lastPitch = Float.NaN;
    lastHotbar = -1;
    motionWasActive = false;
  }

  private JsonObject status() {
    JsonObject out = new JsonObject();
    out.addProperty("recording", recording);
    out.addProperty("paused", paused);
    out.addProperty("playback", playback);
    out.addProperty("stepCount", stepCount);
    return out;
  }
}
