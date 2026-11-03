package com.jnbot.client.mixin;

import com.jnbot.client.automation.AutomationRecorderController;
import net.minecraft.client.player.LocalPlayer;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;

@Mixin(LocalPlayer.class)
public abstract class ClientPlayerEntityAutomationMixin {
  // 26.1+ moved dropping to MultiPlayerGameMode.dropItem, see ClientPlayerInteractionManagerMixin.
  //? if <26.1 {
  @Inject(method = "drop(Z)Z", at = @At("HEAD"))
  private void jnbot$recordDrop(boolean entireStack, CallbackInfoReturnable<Boolean> cir) {
    AutomationRecorderController.INSTANCE.onDropItem(entireStack);
  }
  //?}

  @Inject(method = "respawn", at = @At("HEAD"))
  private void jnbot$recordRespawn(CallbackInfo ci) {
    var action = new com.google.gson.JsonObject();
    action.addProperty("kind", "respawn");
    action.addProperty("ts", System.currentTimeMillis());
    AutomationRecorderController.INSTANCE.onExternalAction(action);
  }
}
