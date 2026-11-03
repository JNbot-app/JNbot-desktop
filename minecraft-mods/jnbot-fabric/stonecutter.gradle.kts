plugins {
  id("dev.kikugie.stonecutter")
}

stonecutter active "1.21.11"

stonecutter parameters {
  // Pure renames between versions. Sources are written against 1.21.11;
  // behavior changes live in //? if blocks (mostly in ClientCompat).
  replacements {
    string(current.parsed >= "26.1") {
      replace("GuiGraphics", "GuiGraphicsExtractor")
      replace("ClickType", "ContainerInput")
      replace("handleInventoryMouseClick", "handleContainerInput")
      replace(".drawString(", ".text(")
      replace(".drawCenteredString(", ".centeredText(")
      replace("renderBackground(", "extractBackground(")
      replace("renderListBackground(", "extractListBackground(")
      replace("renderListSeparators(", "extractListSeparators(")
      replace("renderContent(", "extractContent(")
      replace("super.render(", "super.extractRenderState(")
      replace("button.render(", "button.extractRenderState(")
      replace("ScreenEvents.afterRender(", "ScreenEvents.afterExtract(")
      replace("Screens.getButtons(", "Screens.getWidgets(")
      replace("PayloadTypeRegistry.playS2C()", "PayloadTypeRegistry.clientboundPlay()")
      replace("PayloadTypeRegistry.playC2S()", "PayloadTypeRegistry.serverboundPlay()")
      replace("keybinding.v1.KeyBindingHelper", "keymapping.v1.KeyMappingHelper")
      replace("KeyBindingHelper.registerKeyBinding(", "KeyMappingHelper.registerKeyMapping(")
      replace("InputConstants.Type.KEYSYM", "InputConstants.Type.KEYBOARD")
      replace("getMainCamera()", "mainCamera()")
      replace(".options.hideGui", ".gui.hud.isHidden()")
      replace("mc.gui.getChat().addMessage(", "mc.gui.hud.getChat().addClientSystemMessage(")
      replace("mc.gui.setTitle(", "mc.gui.hud.setTitle(")
      replace("mc.gui.setSubtitle(", "mc.gui.hud.setSubtitle(")
      replace("mc.gui.setTimes(", "mc.gui.hud.setTimes(")
    }

    // Screen state moved from Minecraft to Minecraft.gui.
    regex(current.parsed >= "26.1") {
      replace(
        "(?<![.\\w])(client|mc)\\.screen\\b", "$1.gui.screen()",
        "(?<![.\\w])(client|mc)\\.gui\\.screen\\(\\)", "$1.screen",
      )
      replace(
        "(?<![.\\w])(client|minecraft|Minecraft\\.getInstance\\(\\))\\.setScreen\\(", "$1.gui.setScreen(",
        "(?<![.\\w])(client|minecraft|Minecraft\\.getInstance\\(\\))\\.gui\\.setScreen\\(", "$1.setScreen(",
      )
      // Screen.render override (overlay render(GuiGraphics) helpers keep their name).
      replace(
        "public void render\\((?=GuiGraphics\\w* \\w+, int)", "public void extractRenderState(",
        "public void extractRenderState\\((?=GuiGraphics\\w* \\w+, int)", "public void render(",
      )
    }
  }
}
