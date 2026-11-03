package com.jnbot.client.mixin;

import com.jnbot.client.automation.AutomationRecorderController;
import net.minecraft.client.Minecraft;
//? if >=26.1
/*import net.minecraft.client.gui.Gui;*/
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.client.gui.screens.inventory.AbstractContainerScreen;
import net.minecraft.client.gui.screens.inventory.InventoryScreen;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

//? if >=26.1 {
/*@Mixin(Gui.class)
*///?} else
@Mixin(Minecraft.class)
public abstract class MinecraftClientAutomationMixin {
  @Inject(method = "setScreen", at = @At("HEAD"))
  private void jnbot$recordWindowClose(Screen nextScreen, CallbackInfo ci) {
    Minecraft client = Minecraft.getInstance();
    if (client.screen instanceof AbstractContainerScreen<?> && nextScreen == null)
      AutomationRecorderController.INSTANCE.onWindowClosed();
    if (nextScreen instanceof InventoryScreen && !(client.screen instanceof InventoryScreen))
      AutomationRecorderController.INSTANCE.onInventoryOpened();
  }
}
