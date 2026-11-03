package com.jnbot.client.screens;

import com.jnbot.client.ui.UiPainter;
import com.jnbot.client.ui.UiTheme;
import java.util.function.BooleanSupplier;
import java.util.function.Consumer;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.Font;
import net.minecraft.client.gui.GuiGraphics;
import net.minecraft.client.gui.components.AbstractWidget;
import net.minecraft.client.gui.components.Button;
import net.minecraft.client.gui.components.ObjectSelectionList;
import net.minecraft.client.input.MouseButtonEvent;
import net.minecraft.network.chat.Component;

public final class JnbotSettingsListWidget extends ObjectSelectionList<JnbotSettingsListWidget.Entry> {
  private static final int ROW_HEIGHT = 38;
  private static final int ROW_PADDING_LEFT = 10;
  private static final int ROW_GAP_TO_BUTTON = 12;

  public JnbotSettingsListWidget(Minecraft client, int width, int height, int y) {
    super(client, width, height, y, ROW_HEIGHT);
    this.centerListVertically = false;
  }

  public void addSettingEntry(com.jnbot.client.screens.JnbotSettingsListWidget.Entry entry) {
    this.addEntry(entry);
  }

  @Override
  public int getRowWidth() {
    return this.getWidth();
  }

  @Override
  public int getRowLeft() {
    return this.getX();
  }

  @Override
  protected int scrollBarX() {
    return this.getX() + this.getWidth() - 4;
  }

  @Override
  protected void renderListBackground(GuiGraphics context) {
    // No boxed background — drawn by the parent screen panel.
  }

  @Override
  protected void renderListSeparators(GuiGraphics context) {
    // Drawn by the parent screen panel.
  }

  public abstract static class Entry extends ObjectSelectionList.Entry<com.jnbot.client.screens.JnbotSettingsListWidget.Entry> {
    @Override
    public boolean mouseClicked(MouseButtonEvent click, boolean doubled) {
      return super.mouseClicked(click, doubled);
    }
  }

  /** Section header — uppercase muted label with subtle underline. */
  public static final class SectionEntry extends com.jnbot.client.screens.JnbotSettingsListWidget.Entry {
    private final Component text;

    public SectionEntry(Component text) {
      this.text = text;
    }

    @Override
    public Component getNarration() {
      return text;
    }

    @Override
    public void visitWidgets(Consumer<AbstractWidget> consumer) {}

    @Override
    public void renderContent(GuiGraphics ctx, int mouseX, int mouseY, boolean hovered, float deltaTicks) {
      Font tr = Minecraft.getInstance().font;
      int x = this.getContentX() + ROW_PADDING_LEFT;
      int y = this.getContentY() + this.getContentHeight() - 14;
      String label = text.getString().toUpperCase();
      ctx.drawString(tr, label, x, y, UiTheme.TEXT_MUTED, false);
      UiPainter.hr(ctx, x, y + 11, this.getContentWidth() - ROW_PADDING_LEFT * 2, UiTheme.BORDER);
    }
  }

  /** A toggle row with title, description, and right-aligned ON/OFF button. */
  public static final class ToggleEntry extends com.jnbot.client.screens.JnbotSettingsListWidget.Entry {
    private final Component title;
    private final Component description;
    private final Button button;
    private final BooleanSupplier valueProvider;

    public ToggleEntry(Component title, Component description, Button button, BooleanSupplier valueProvider) {
      this.title = title;
      this.description = description;
      this.button = button;
      this.valueProvider = valueProvider;
    }

    @Override
    public Component getNarration() {
      return title;
    }

    @Override
    public void visitWidgets(Consumer<AbstractWidget> consumer) {
      consumer.accept(button);
    }

    @Override
    public boolean mouseClicked(MouseButtonEvent click, boolean doubled) {
      if (button.mouseClicked(click, doubled)) return true;
      return super.mouseClicked(click, doubled);
    }

    @Override
    public boolean mouseReleased(MouseButtonEvent click) {
      if (button.mouseReleased(click)) return true;
      return super.mouseReleased(click);
    }

    @Override
    public boolean mouseDragged(MouseButtonEvent click, double deltaX, double deltaY) {
      if (button.mouseDragged(click, deltaX, deltaY)) return true;
      return super.mouseDragged(click, deltaX, deltaY);
    }

    @Override
    public void renderContent(GuiGraphics ctx, int mouseX, int mouseY, boolean hovered, float deltaTicks) {
      Font tr = Minecraft.getInstance().font;

      int x = this.getContentX();
      int y = this.getContentY();
      int w = this.getContentWidth();
      int h = this.getContentHeight();

      int buttonW = 56;
      int buttonH = 18;
      int buttonX = x + w - buttonW - 4;
      int buttonY = y + (h - buttonH) / 2;

      // Subtle hover background
      if (hovered) {
        UiPainter.roundedFill(ctx, x + 2, y + 1, w - 4, h - 2, UiTheme.BG_ROW_HOVER);
      }

      // Status accent stripe shows whether the toggle is on
      boolean on = valueProvider.getAsBoolean();
      int stripeColor = on ? UiTheme.ACCENT : UiTheme.alpha(UiTheme.BORDER_STRONG, 0xCC);
      UiPainter.accentStripe(ctx, x + 4, y + 4, h - 8, stripeColor);

      int textX = x + ROW_PADDING_LEFT;
      int textMaxWidth = Math.max(0, (buttonX - ROW_GAP_TO_BUTTON) - textX);

      String titleStr = UiPainter.clip(tr, title.getString(), textMaxWidth);
      String descStr = UiPainter.clip(tr, description.getString(), textMaxWidth);

      ctx.drawString(tr, titleStr, textX, y + 6, UiTheme.TEXT_PRIMARY, false);
      ctx.drawString(tr, descStr, textX, y + 18, UiTheme.TEXT_MUTED, false);

      button.setX(buttonX);
      button.setY(buttonY);
      button.setWidth(buttonW);
      button.setHeight(buttonH);
      button.render(ctx, mouseX, mouseY, deltaTicks);
    }
  }
}
