package com.jnbot.client.bridge.api;

import com.google.gson.JsonElement;
import com.google.gson.JsonNull;
import com.google.gson.JsonObject;
import com.jnbot.client.bridge.api.services.McApiService;
import com.jnbot.client.bridge.api.services.McBlockService;
import com.jnbot.client.bridge.api.services.McEntityService;
import com.jnbot.client.bridge.api.services.McGameWindowService;
import com.jnbot.client.bridge.api.services.McHudService;
import com.jnbot.client.bridge.api.services.McInputService;
import com.jnbot.client.bridge.api.services.McInventoryService;
import com.jnbot.client.bridge.api.services.McPathfinderService;
import com.jnbot.client.bridge.api.services.McPlayerActionService;
import com.jnbot.client.bridge.api.services.McPlayerInfoService;
import com.jnbot.client.bridge.api.services.McWorldService;
import com.jnbot.client.bridge.api.services.McBlockWatchService;
import com.jnbot.client.bridge.api.services.McUiService;
import com.jnbot.client.bridge.api.services.McEntityAutomationService;
import com.jnbot.client.bridge.api.services.McLookService;
import com.jnbot.client.bridge.api.services.McMiningService;
import com.jnbot.client.bridge.api.services.McServerService;
import com.jnbot.client.automation.AutomationRecorderController;
import java.util.LinkedHashMap;
import java.util.Map;
import net.minecraft.client.Minecraft;

/**
 * Central registry of remote method handlers. Adding a new feature is a one
 * line registration here plus the implementation in a service class.
 */
public final class McBridgeApiRouter {
  public interface MethodHandler {
    JsonElement handle(Minecraft client, JsonObject params) throws Exception;
  }

  public static final class MethodNotFoundException extends Exception {
    public MethodNotFoundException(String method) {
      super("Unknown method: " + method);
    }
  }

  private final Map<String, MethodHandler> methods = new LinkedHashMap<>();

  public McBridgeApiRouter() {
    McInputService input = new McInputService();
    McPlayerInfoService playerInfo = new McPlayerInfoService();
    McInventoryService inventory = new McInventoryService();
    McWorldService world = new McWorldService();
    McBlockService block = new McBlockService();
    McPlayerActionService action = new McPlayerActionService();
    McGameWindowService gameWindow = new McGameWindowService();
    McPathfinderService pathfinder = new McPathfinderService();
    McEntityService entity = new McEntityService();
    McHudService hud = new McHudService();
    McApiService api = new McApiService(this);
    McBlockWatchService blockWatches = McBlockWatchService.INSTANCE;
    McUiService ui = new McUiService();
    McEntityAutomationService entityTasks = McEntityAutomationService.INSTANCE;
    McLookService look = McLookService.INSTANCE;
    McMiningService mining = McMiningService.INSTANCE;
    McServerService server = new McServerService();

    // ---- Control ----
    register("mc.chat", input::chat);
    register("mc.input.setMovement", input::setMovement);
    register("mc.input.setKey", input::setKey);
    register("mc.input.look", input::look);
    register("mc.input.smoothLook", look::smoothLook);
    register("mc.input.smoothLookAt", look::smoothLookAt);
    register("mc.input.stopSmoothLook", look::stop);
    register("mc.input.smoothLookStatus", look::status);
    register("mc.input.click", input::click);

    // ---- Inventory windows ----
    register("mc.inventory.open", inventory::openInventory);
    register("mc.inventory.clickSlot", inventory::clickSlot);
    register("mc.inventory.closeWindow", inventory::closeWindow);
    register("mc.inventory.setHotbarSlot", inventory::setHotbarSlot);
    register("mc.inventory.getItems", action::getInventory);
    register("mc.inventory.find", inventory::findItems);
    register("mc.inventory.count", inventory::countItem);
    register("mc.inventory.move", inventory::moveSlot);
    register("mc.inventory.swap", inventory::swapSlots);
    register("mc.inventory.quickMove", inventory::quickMove);
    register("mc.inventory.transferMatching", inventory::transferMatching);

    // ---- Player info ----
    register("mc.getPosition", playerInfo::getPosition);
    register("mc.getHealth", playerInfo::getHealth);
    register("mc.player.experience", playerInfo::getExperience);
    register("mc.player.heldItems", playerInfo::getHeldItems);
    register("mc.player.effects", playerInfo::getStatusEffects);
    register("mc.player.state", playerInfo::getState);

    // ---- Player actions ----
    register("mc.player.swingArm", action::swingArm);
    register("mc.player.dropItem", action::dropItem);
    register("mc.player.dig", action::dig);
    register("mc.player.stopDig", action::stopDig);
    register("mc.player.placeBlock", action::placeBlock);
    register("mc.player.useOnLooked", action::useOnLooked);
    register("mc.player.equip", action::equip);
    register("mc.player.activateBlock", action::activateBlock);
    register("mc.player.sleep", action::sleep);
    register("mc.player.wake", action::wake);
    register("mc.player.lookAt", action::lookAt);
    register("mc.player.useItem", action::useItem);
    register("mc.player.releaseUseItem", action::releaseUseItem);
    register("mc.player.swapHands", action::swapHands);
    register("mc.player.respawn", action::respawn);
    register("mc.player.canRespawn", action::canRespawn);

    // ---- World info ----
    register("mc.getCurrentWindow", inventory::getCurrentWindow);
    register("mc.getNearbyEntities", world::getNearbyEntities);
    register("mc.getOnlinePlayers", world::getOnlinePlayers);
    register("mc.world.info", world::getWorldInfo);
    register("mc.world.light", world::getLight);
    register("mc.world.scan", world::scanBox);
    register("mc.world.cube", world::blockCube);
    register("mc.world.column", world::getColumn);
    register("mc.world.biome", world::getBiome);

    // ---- Blocks ----
    register("mc.world.blockAt", block::getBlockAt);
    register("mc.world.blockAtCursor", block::getBlockAtCursor);
    register("mc.world.raycast", block::raycast);
    register("mc.world.findBlock", block::findBlock);
    register("mc.world.findBlocks", block::findBlocks);
    register("mc.world.signText", block::getSignText);

    // ---- Mining automation ----
    register("mc.mining.mineBlock", mining::mineBlock);
    register("mc.mining.mineNearest", mining::mineNearest);
    register("mc.mining.veinMine", mining::veinMine);
    register("mc.mining.stop", mining::stop);
    register("mc.mining.status", mining::status);

    // ---- Entities ----
    register("mc.entity.attack", entity::attack);
    register("mc.entity.use", entity::use);
    register("mc.entity.getById", entity::getById);
    register("mc.entity.find", entity::find);
    register("mc.entity.nearest", entity::nearest);
    register("mc.entity.lookAt", entity::lookAt);
    register("mc.entity.follow", entityTasks::follow);
    register("mc.entity.attackUntilDead", entityTasks::attackUntilDead);
    register("mc.task.stop", entityTasks::stop);
    register("mc.task.status", entityTasks::status);

    // ---- Pathfinder ----
    register("mc.pathfinder.goto", pathfinder::goTo);
    register("mc.pathfinder.stop", pathfinder::stop);
    register("mc.pathfinder.status", pathfinder::status);
    register("mc.pathfinder.gotoEntity", pathfinder::goToEntity);
    register("mc.pathfinder.gotoBlock", pathfinder::goToBlock);
    register("mc.pathfinder.flee", pathfinder::flee);

    // ---- Efficient world subscriptions ----
    register("mc.world.watch", blockWatches::watch);
    register("mc.world.unwatch", blockWatches::unwatch);
    register("mc.world.clearWatches", blockWatches::clear);

    // ---- Game window (the desktop window itself) ----
    register("mc.window.info", gameWindow::getInfo);
    register("mc.window.setTitle", gameWindow::setTitle);
    register("mc.window.setFullscreen", gameWindow::setFullscreen);

    // ---- Integrated server / Open to LAN ----
    register("mc.server.status", server::status);
    register("mc.server.openToLan", server::openToLan);

    // ---- HUD / OS ----
    register("mc.hud.toast", hud::toast);
    register("mc.hud.clearToasts", hud::clearToasts);
    register("mc.hud.marker", hud::addMarker);
    register("mc.hud.removeMarker", hud::removeMarker);
    register("mc.hud.clearMarkers", hud::clearMarkers);
    register("mc.audio.beep", hud::beep);
    register("mc.window.flash", hud::flashWindow);

    // ---- Declarative plugin UI ----
    register("mc.ui.open", ui::open);
    register("mc.ui.close", ui::close);

    // ---- Diagnostics ----
    register("mc.api.list", api::list);
    register("mc.api.version", api::version);
    register("mc.api.capabilities", api::capabilities);
    register("mc.automation.batch", api::batch);
    register("mc.automation.capture.start", AutomationRecorderController.INSTANCE::startCapture);
    register("mc.automation.capture.pause", AutomationRecorderController.INSTANCE::pauseCapture);
    register("mc.automation.capture.resume", AutomationRecorderController.INSTANCE::resumeCapture);
    register("mc.automation.capture.stop", AutomationRecorderController.INSTANCE::stopCapture);
    register("mc.automation.playback.start", AutomationRecorderController.INSTANCE::startPlayback);
    register("mc.automation.playback.pause", AutomationRecorderController.INSTANCE::pausePlayback);
    register("mc.automation.playback.resume", AutomationRecorderController.INSTANCE::resumePlayback);
    register("mc.automation.playback.stop", AutomationRecorderController.INSTANCE::stopPlayback);
    register("mc.automation.motion.start", AutomationRecorderController.INSTANCE::startMotion);
    register("mc.automation.motion.status", AutomationRecorderController.INSTANCE::motionStatus);
    register("mc.automation.motion.stop", AutomationRecorderController.INSTANCE::stopMotion);
    register("mc.automation.screenAction", AutomationRecorderController.INSTANCE::replayScreenAction);
  }

  public void register(String method, MethodHandler handler) {
    if (method == null || method.isBlank() || handler == null) return;
    methods.put(method, handler);
  }

  public JsonElement invoke(Minecraft client, String method, JsonObject params) throws Exception {
    MethodHandler handler = methods.get(method);
    if (handler == null) throw new MethodNotFoundException(method);
    AutomationRecorderController.INSTANCE.beginSynthetic();
    try {
      JsonElement result = handler.handle(client, params != null ? params : new JsonObject());
      return result != null ? result : JsonNull.INSTANCE;
    } finally {
      AutomationRecorderController.INSTANCE.endSynthetic();
    }
  }

  /** All registered method names, in registration order. Useful for diagnostics. */
  public java.util.Set<String> methodNames() {
    return java.util.Collections.unmodifiableSet(methods.keySet());
  }
}
