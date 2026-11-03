package com.jnbot.client.compat;

import com.mojang.blaze3d.platform.InputConstants;
import java.util.Arrays;
import java.util.List;
import net.minecraft.client.Minecraft;
import net.minecraft.client.player.LocalPlayer;
import net.minecraft.client.server.IntegratedServer;
import net.minecraft.core.BlockPos;
import net.minecraft.network.protocol.game.ServerboundSignUpdatePacket;
import net.minecraft.world.InteractionHand;
import net.minecraft.world.InteractionResult;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.level.block.entity.SignBlockEntity;
import net.minecraft.world.level.block.entity.SignText;
//? if >=26.1 {
/*import net.minecraft.server.MinecraftServer;
import net.minecraft.world.item.component.SwingAnimation;
import net.minecraft.world.level.block.entity.SignTextSlot;
import net.minecraft.world.phys.EntityHitResult;
import org.lwjgl.sdl.SDLMouse;
import org.lwjgl.sdl.SDLVideo;
*///?} else
import org.lwjgl.glfw.GLFW;

/**
 * Client calls whose shape differs between supported Minecraft versions.
 * Pure renames are handled by Stonecutter replacements in stonecutter.gradle.kts.
 */
public final class ClientCompat {
  private ClientCompat() {}

  public static void swing(LocalPlayer player, InteractionHand hand) {
    //? if >=26.1 {
    /*player.swing(hand, SwingAnimation.DEFAULT, false);
    *///?} else
    player.swing(hand);
  }

  public static InteractionResult interact(Minecraft client, Entity target, InteractionHand hand) {
    //? if >=26.1 {
    /*return client.gameMode.interact(client.player, target, new EntityHitResult(target), hand);
    *///?} else
    return client.gameMode.interact(client.player, target, hand);
  }

  public static void dropSelected(Minecraft client, boolean entireStack) {
    //? if >=26.1 {
    /*client.gameMode.dropItem(client.player, entireStack);
    *///?} else
    client.player.drop(entireStack);
  }

  public static boolean isKeyDown(Minecraft client, int key) {
    //? if >=26.1 {
    /*return InputConstants.isKeyDown(key);
    *///?} else
    return InputConstants.isKeyDown(client.getWindow(), key);
  }

  public static boolean isMouseButtonDown(Minecraft client, int button) {
    //? if >=26.1 {
    /*return (SDLMouse.nSDL_GetMouseState(0L, 0L) & (1 << (button - 1))) != 0;
    *///?} else
    return GLFW.glfwGetMouseButton(client.getWindow().handle(), button) == GLFW.GLFW_PRESS;
  }

  public static boolean isFullscreen(Minecraft client) {
    //? if >=26.1 {
    /*return client.options.fullscreen().get();
    *///?} else
    return client.getWindow().isFullscreen();
  }

  public static void setFullscreen(Minecraft client, boolean fullscreen) {
    if (fullscreen == isFullscreen(client)) return;
    //? if >=26.1 {
    /*client.options.fullscreen().set(fullscreen);
    *///?} else
    client.getWindow().toggleFullScreen();
  }

  /** Flashes the taskbar / dock icon. */
  public static void requestWindowAttention(Minecraft client) {
    //? if >=26.1 {
    /*SDLVideo.SDL_FlashWindow(client.getWindow().handle(), SDLVideo.SDL_FLASH_BRIEFLY);
    *///?} else
    GLFW.glfwRequestWindowAttention(client.getWindow().handle());
  }

  public static SignText signText(SignBlockEntity sign, boolean front) {
    //? if >=26.1 {
    /*return sign.getText(front ? SignTextSlot.FRONT : SignTextSlot.BACK);
    *///?} else
    return sign.getText(front);
  }

  public static ServerboundSignUpdatePacket signUpdatePacket(BlockPos pos, boolean front, String[] lines) {
    //? if >=26.1 {
    /*return new ServerboundSignUpdatePacket(pos, List.of(lines), front ? SignTextSlot.FRONT : SignTextSlot.BACK);
    *///?} else
    return new ServerboundSignUpdatePacket(pos, front, lines[0], lines[1], lines[2], lines[3]);
  }

  public static BlockPos signPos(ServerboundSignUpdatePacket packet) {
    //? if >=26.1 {
    /*return packet.pos();
    *///?} else
    return packet.getPos();
  }

  public static boolean signIsFront(ServerboundSignUpdatePacket packet) {
    //? if >=26.1 {
    /*return packet.slot() == SignTextSlot.FRONT;
    *///?} else
    return packet.isFrontText();
  }

  public static List<String> signLines(ServerboundSignUpdatePacket packet) {
    //? if >=26.1 {
    /*return packet.lines();
    *///?} else
    return Arrays.asList(packet.getLines());
  }

  public static boolean publishLan(IntegratedServer server, boolean cheatsAllowed, int port) {
    //? if >=26.1 {
    /*return server.publishServer(MinecraftServer.MultiplayerScope.LAN, cheatsAllowed, port);
    *///?} else
    return server.publishServer(server.getDefaultGameType(), cheatsAllowed, port);
  }
}
