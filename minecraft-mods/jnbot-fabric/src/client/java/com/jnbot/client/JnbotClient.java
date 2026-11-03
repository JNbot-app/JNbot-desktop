package com.jnbot.client;

import net.fabricmc.api.ClientModInitializer;

import net.fabricmc.fabric.api.client.screen.v1.ScreenEvents;
import net.fabricmc.fabric.api.client.screen.v1.Screens;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.components.AbstractWidget;
import net.minecraft.client.gui.components.Button;
import net.minecraft.client.gui.screens.PauseScreen;
import net.minecraft.client.gui.screens.TitleScreen;
import net.minecraft.network.chat.Component;
import net.minecraft.resources.Identifier;
import net.fabricmc.fabric.api.client.event.lifecycle.v1.ClientLifecycleEvents;
import net.fabricmc.fabric.api.client.event.lifecycle.v1.ClientTickEvents;
import net.fabricmc.fabric.api.client.message.v1.ClientReceiveMessageEvents;
import net.fabricmc.fabric.api.client.networking.v1.ClientPlayConnectionEvents;
import net.fabricmc.fabric.api.client.rendering.v1.hud.HudElementRegistry;
import com.jnbot.client.bridge.JnbotMcBridgeClient;
import com.jnbot.client.bridge.api.services.McPathfinderService;
import com.jnbot.client.bridge.api.services.McBlockWatchService;
import com.jnbot.client.bridge.api.services.McEntityAutomationService;
import com.jnbot.client.bridge.api.services.McLookService;
import com.jnbot.client.bridge.api.services.McMiningService;
import com.jnbot.client.bridge.api.services.McPlayerActionService;
import com.jnbot.client.bridge.events.McClientEventEmitter;
import com.jnbot.client.features.AutoLoginController;
import com.jnbot.client.hud.MarkerOverlay;
import com.jnbot.client.hud.ScriptProgressHudOverlay;
import com.jnbot.client.hud.JnbotStatusOverlay;
import com.jnbot.client.hud.ToastOverlay;
import com.jnbot.client.screens.JnbotInfoScreen;
import com.jnbot.client.ui.UiPainter;
import com.jnbot.client.ui.UiTheme;
import com.jnbot.client.automation.AutomationRecorderController;
import com.jnbot.client.proxy.ProxyControlChannel;
import com.jnbot.client.proxy.ProxySessionsScreen;
import com.jnbot.client.proxy.ProxyStatusHud;
import com.jnbot.client.hud.AutomationHudOverlay;

public final class JnbotClient implements ClientModInitializer {
  public static final String MOD_ID = "jnbot";

  @Override
  public void onInitializeClient() {
    AutomationRecorderController.INSTANCE.register();
    ProxyControlChannel.register();
    HudElementRegistry.addLast(Identifier.fromNamespaceAndPath(MOD_ID, "overlays"), (drawContext, tickDelta) -> {
      MarkerOverlay.getInstance().render(drawContext);
      ScriptProgressHudOverlay.getInstance().render(drawContext);
      ToastOverlay.getInstance().render(drawContext);
      JnbotStatusOverlay.getInstance().render(drawContext);
      AutomationHudOverlay.getInstance().render(drawContext);
      ProxyStatusHud.render(drawContext);
    });

    ClientTickEvents.END_CLIENT_TICK.register(client -> {
      JnbotMcBridgeClient.getInstance().start();
      AutoLoginController.getInstance().tick(client);
      McClientEventEmitter emitter = McClientEventEmitter.getInstance();
      emitter.tick(client);
      emitter.tickHealth(client);
      emitter.tickEntities(client);
      McBlockWatchService.INSTANCE.tick(client);
      McEntityAutomationService.INSTANCE.tick(client);
      McPathfinderService.EXECUTOR.tick(client);
      McLookService.INSTANCE.tick(client);
      McMiningService.INSTANCE.tick(client);
      McPlayerActionService.tick(client);
      AutomationRecorderController.INSTANCE.tick(client);
    });

    ClientReceiveMessageEvents.CHAT.register((message, signedMessage, sender, params, receivedAt) ->
      McClientEventEmitter.getInstance().onChat(message != null ? message.getString() : "", "chat")
    );

    ClientReceiveMessageEvents.GAME.register((message, overlay) ->
      McClientEventEmitter.getInstance().onChat(
        message != null ? message.getString() : "",
        overlay ? "actionbar" : "game"
      )
    );

    ClientLifecycleEvents.CLIENT_STARTED.register(client -> {
      client.getWindow().setTitle("JNbot Client - Minecraft");
    });

    ScreenEvents.AFTER_INIT.register((client, screen, scaledWidth, scaledHeight) -> {
      if (screen instanceof TitleScreen) {
        installTitleScreenButton(screen, client, scaledWidth, scaledHeight);
      }

      if (screen instanceof PauseScreen) {
        installGameMenuButton(screen, client, scaledWidth, scaledHeight);
      }
    });

    ClientPlayConnectionEvents.JOIN.register((handler, sender, client) -> {
      McClientEventEmitter.getInstance().reset();
      String serverAddress = "singleplayer";
      String serverKind = "singleplayer";

      try {
        if (client.getCurrentServer() != null && client.getCurrentServer().ip != null) {
          serverAddress = client.getCurrentServer().ip;
          serverKind = "multiplayer";
        }
      } catch (Exception ignored) {
        serverAddress = "unknown";
        serverKind = "unknown";
      }

      JnbotMcBridgeClient.getInstance().sendSessionJoined(serverKind, serverAddress);
      AutoLoginController.getInstance().onSessionJoined(serverKind, serverAddress);
    });

    ClientPlayConnectionEvents.DISCONNECT.register((handler, client) -> {
      McClientEventEmitter.getInstance().onDisconnected("disconnected");
      McPathfinderService.EXECUTOR.stop("disconnected");
      McBlockWatchService.INSTANCE.reset();
      McEntityAutomationService.INSTANCE.reset();
      McLookService.INSTANCE.reset();
      McMiningService.INSTANCE.reset();
      JnbotMcBridgeClient.getInstance().sendSessionLeft();
      AutoLoginController.getInstance().onSessionLeft();
      McClientEventEmitter.getInstance().reset();
    });
  }

  /**
   * Replace the Realms button (or insert a JNbot button) on the title screen,
   * plus paint a small branded watermark in the corner that includes the
   * bridge connection status.
   */
  private static void installTitleScreenButton(
      net.minecraft.client.gui.screens.Screen screen,
      Minecraft client,
      int scaledWidth,
      int scaledHeight
  ) {
    var buttons = Screens.getButtons(screen);
    AbstractWidget realmsButton = null;
    for (var button : buttons) {
      if (button.getMessage().getString().contains("Realms")) {
        realmsButton = button;
        break;
      }
    }

    if (realmsButton != null) {
      buttons.remove(realmsButton);
      buttons.add(
          Button.builder(Component.literal("JNbot"), btn ->
              Minecraft.getInstance().setScreen(new JnbotInfoScreen(screen))
          ).bounds(realmsButton.getX(), realmsButton.getY(), realmsButton.getWidth(), realmsButton.getHeight())
              .build());
    } else {
      final int buttonWidth = 200;
      final int buttonHeight = 20;
      final int x = (scaledWidth - buttonWidth) / 2;
      final int y = scaledHeight - 80;

      buttons.add(
          Button.builder(Component.literal("JNbot"), btn ->
              Minecraft.getInstance().setScreen(new JnbotInfoScreen(screen))
          ).bounds(x, y, buttonWidth, buttonHeight).build());
    }

    ScreenEvents.afterRender(screen).register((scr, ctx, mouseX, mouseY, tickDelta) -> {
      JnbotMcBridgeClient bridge = JnbotMcBridgeClient.getInstance();
      String status = bridge.isConnected() ? "Bridge online"
          : (bridge.isConnecting() ? "Bridge connecting…" : "Bridge offline");
      int statusColor = bridge.isConnected() ? UiTheme.OK
          : (bridge.isConnecting() ? UiTheme.WARN : UiTheme.ERROR);

      int padX = 4;
      int padY = 3;
      int textW = client.font.width(status) + 10;
      int boxW = textW + padX * 2;
      int boxH = 11 + padY * 2;
      int bx = 6;
      int by = scaledHeight - boxH - 6;

      UiPainter.panel(ctx, bx, by, boxW, boxH, UiTheme.BG_HUD, UiTheme.BORDER);
      UiPainter.statusDot(ctx, bx + padX, by + (boxH - 6) / 2, statusColor);
      ctx.drawString(client.font, status, bx + padX + 10, by + padY + 1, UiTheme.TEXT_PRIMARY, false);
    });
  }

  /**
   * Adds a small corner JNbot button to the game menu (esc), positioned so
   * it cannot overlap the vanilla button column.
   */
  private static void installGameMenuButton(
      net.minecraft.client.gui.screens.Screen screen,
      Minecraft client,
      int scaledWidth,
      int scaledHeight
  ) {
    final int buttonWidth = 70;
    final int buttonHeight = 20;
    final int margin = 6;
    // Top-right corner — visible but out of the way of vanilla content.
    final int x = scaledWidth - buttonWidth - margin;
    final int y = margin;

    Screens.getButtons(screen).add(
        Button.builder(Component.literal("JNbot"), btn ->
            Minecraft.getInstance().setScreen(new JnbotInfoScreen(screen))
        ).bounds(x, y, buttonWidth, buttonHeight).tooltip(
            net.minecraft.client.gui.components.Tooltip.create(Component.literal("Open JNbot client panel"))
        ).build());

    if (ProxyControlChannel.linked()) {
      Screens.getButtons(screen).add(
          Button.builder(Component.literal("Sessions"), btn ->
              Minecraft.getInstance().setScreen(new ProxySessionsScreen(screen))
          ).bounds(x, y + buttonHeight + 4, buttonWidth, buttonHeight).tooltip(
              net.minecraft.client.gui.components.Tooltip.create(Component.literal("Switch to another JNbot proxy connection"))
          ).build());
    }
  }
}
