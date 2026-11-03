package com.jnbot.client.mixin;

import com.jnbot.client.automation.AutomationRecorderController;
import net.minecraft.client.Minecraft;
import net.minecraft.client.multiplayer.MultiPlayerGameMode;
import net.minecraft.client.player.LocalPlayer;
import net.minecraft.core.BlockPos;
import net.minecraft.world.InteractionHand;
import net.minecraft.world.InteractionResult;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.inventory.ClickType;
import net.minecraft.world.phys.BlockHitResult;
import net.minecraft.world.phys.EntityHitResult;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;

@Mixin(MultiPlayerGameMode.class)
public abstract class ClientPlayerInteractionManagerMixin {
  @Inject(method = "handleInventoryMouseClick", at = @At("HEAD"))
  private void jnbot$recordSlotClick(
      int syncId,
      int slotId,
      int button,
      ClickType actionType,
      Player player,
      CallbackInfo ci
  ) {
    AutomationRecorderController.INSTANCE.onWindowClick(
        Minecraft.getInstance(), syncId, slotId, button, actionType);
  }

  @Inject(method = "releaseUsingItem", at = @At("HEAD"))
  private void jnbot$recordReleaseUseItem(Player player, CallbackInfo ci) {
    AutomationRecorderController.INSTANCE.onReleaseUseItem();
  }

  @Inject(method = "useItemOn", at = @At("RETURN"))
  private void jnbot$recordInteractBlock(
      LocalPlayer player,
      InteractionHand hand,
      BlockHitResult hitResult,
      CallbackInfoReturnable<InteractionResult> cir
  ) {
    if (cir.getReturnValue() != null && cir.getReturnValue().consumesAction()) {
      AutomationRecorderController.INSTANCE.onInteractBlock(hand, hitResult);
    }
  }

  @Inject(method = "useItem", at = @At("RETURN"))
  private void jnbot$recordInteractItem(
      Player player,
      InteractionHand hand,
      CallbackInfoReturnable<InteractionResult> cir
  ) {
    if (cir.getReturnValue() != null && cir.getReturnValue().consumesAction()) {
      AutomationRecorderController.INSTANCE.onInteractItem(hand);
    }
  }

  @Inject(method = "destroyBlock", at = @At("HEAD"))
  private void jnbot$recordBreakBlock(BlockPos pos, CallbackInfoReturnable<Boolean> cir) {
    AutomationRecorderController.INSTANCE.onBreakBlock(pos);
  }

  @Inject(method = "attack", at = @At("HEAD"))
  private void jnbot$recordAttackEntity(Player player, Entity target, CallbackInfo ci) {
    AutomationRecorderController.INSTANCE.onAttackEntity(InteractionHand.MAIN_HAND, target);
  }

  //? if >=26.1 {
  /*@Inject(method = "dropItem", at = @At("HEAD"))
  private void jnbot$recordDrop(LocalPlayer player, boolean entireStack, CallbackInfo ci) {
    AutomationRecorderController.INSTANCE.onDropItem(entireStack);
  }

  @Inject(method = "interact", at = @At("RETURN"))
  private void jnbot$recordInteractEntity(
      Player player,
      Entity entity,
      EntityHitResult hitResult,
      InteractionHand hand,
      CallbackInfoReturnable<InteractionResult> cir
  ) {
    if (cir.getReturnValue() != null && cir.getReturnValue().consumesAction()) {
      AutomationRecorderController.INSTANCE.onUseEntity(hand, entity);
    }
  }
  *///?} else {
  @Inject(method = "interact", at = @At("RETURN"))
  private void jnbot$recordInteractEntity(
      Player player,
      Entity entity,
      InteractionHand hand,
      CallbackInfoReturnable<InteractionResult> cir
  ) {
    if (cir.getReturnValue() != null && cir.getReturnValue().consumesAction()) {
      AutomationRecorderController.INSTANCE.onUseEntity(hand, entity);
    }
  }

  @Inject(method = "interactAt", at = @At("RETURN"))
  private void jnbot$recordInteractEntityAtLocation(
      Player player,
      Entity entity,
      EntityHitResult hitResult,
      InteractionHand hand,
      CallbackInfoReturnable<InteractionResult> cir
  ) {
    if (cir.getReturnValue() != null && cir.getReturnValue().consumesAction()) {
      AutomationRecorderController.INSTANCE.onUseEntity(hand, entity);
    }
  }
  //?}
}
