package com.jnbot.client.mixin;

import com.jnbot.client.hud.sidebar.ServerSidebarOverlay;
import net.minecraft.client.Minecraft;
//? if >=26.1 {
/*import net.minecraft.client.gui.Hud;
*///?} else
import net.minecraft.client.gui.Gui;
import net.minecraft.client.gui.GuiGraphics;
import net.minecraft.world.scores.Objective;
import com.jnbot.client.config.JnbotClientConfigStore;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

//? if >=26.1 {
/*@Mixin(Hud.class)
*///?} else
@Mixin(Gui.class)
public abstract class InGameHudMixin {
  @Inject(
      method = "displayScoreboardSidebar(Lnet/minecraft/client/gui/GuiGraphics;Lnet/minecraft/world/scores/Objective;)V",
      at = @At("HEAD"),
      cancellable = true
  )
  private void jnbot$renderScoreboardSidebar(GuiGraphics context, Objective objective, CallbackInfo ci) {
    Minecraft mc = Minecraft.getInstance();
    if (mc == null || mc.player == null || mc.level == null) return;
    if (mc.options.hideGui) return;
    if (mc.getDebugOverlay().showDebugScreen()) return;

    if (!JnbotClientConfigStore.getInstance().get().isSidebarHudEnabled()) return;

    boolean handled = ServerSidebarOverlay.getInstance().render(context, objective);
    if (handled) {
      ci.cancel();
    }
  }
}
