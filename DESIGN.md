---
name: JNbot
description: Calm, themeable Minecraft automation for focused desktop operation.
colors:
  night-base: "#050505"
  night-container: "#0f0f10"
  night-elevated: "#151518"
  night-border: "#27272a"
  obsidian-primary: "#7f5af0"
  gold-primary: "#f5b50a"
  light-primary: "#3461ff"
  mocha-primary: "#94e2d5"
  light-surface: "#f5f6fb"
  light-container: "#ffffff"
  success: "#22c55e"
  warning: "#f59e0b"
  error: "#ef4444"
typography:
  display:
    fontFamily: "'Space Grotesk', 'Geist', sans-serif"
    fontWeight: 600
  body:
    fontFamily: "'Exo 2', sans-serif"
    fontSize: "14px"
    fontWeight: 400
  mono:
    fontFamily: "'IBM Plex Mono', 'Menlo Regular', monospace"
rounded:
  sm: "6px"
  md: "8px"
  lg: "10px"
  panel: "12px"
spacing:
  control: "40px"
  header: "48px"
components:
  button-primary:
    backgroundColor: "{colors.gold-primary}"
    textColor: "#1a1200"
    rounded: "{rounded.sm}"
    height: "{spacing.control}"
  card:
    backgroundColor: "{colors.night-container}"
    rounded: "{rounded.md}"
---

# Design System: JNbot

## Overview

**Creative North Star: "The Minecraft Automation App"**

JNbot is a calm, approachable control surface for Minecraft automation. The interface should feel like a reliable automation station: atmospheric enough to acknowledge the game world, but quiet enough that users can always tell which bot, profile, script, or server state they are operating.

The system is themeable rather than tied to one fixed palette. Ant Design provides the shared interaction grammar while the active theme controls surfaces, accents, semantic states, and contrast. Dark themes use layered near-black or tinted surfaces; the light theme uses cool, pale surfaces. Atmospheric depth comes from restrained tonal separation, borders, and soft shadows—not decoration that competes with controls.

**Key Characteristics:**
- Calm, operational, and readable
- Theme-driven accents with no single mandatory brand hue
- Layered surfaces with controlled atmospheric depth
- Desktop-first density and clear state feedback

## Colors

Color is an active-theme concern. Use Ant Design tokens and the selected theme rather than hard-coded colors in new UI.

### Primary
- **Gold Accent** (#f5b50a): The strongest current branded accent; used for primary actions, links, selected states, and the Gold theme.
- **Obsidian Violet** (#7f5af0): A distinct theme accent for the Obsidian theme.
- **Cool Blue** (#3461ff): The Light theme's primary action and selection color.
- **Soft Aqua** (#94e2d5): The Mocha theme's primary accent.

### Neutral
- **Night Base** (#050505): Deepest application and layout background in the Night theme.
- **Night Container** (#0f0f10): Default dark navigation and container surface.
- **Night Elevated** (#151518): Raised dark surfaces such as dialogs and elevated panels.
- **Light Surface** (#f5f6fb): Cool light-theme application surface.
- **Light Container** (#ffffff): Light cards, inputs, drawers, and modal surfaces.
- **Theme Border** (#27272a): Quiet structural separation in the Night theme; use the active theme's border token elsewhere.

### Named Rules
**The Active Theme Rule.** Every new color assignment must come from the active Ant Design theme or an existing semantic token; do not introduce a fixed visual palette that breaks theme switching.

## Typography

**Display Font:** Space Grotesk / Geist fallback (used selectively in the Gold theme)
**Body Font:** Exo 2, sans-serif (the main theme family)
**Label/Mono Font:** IBM Plex Mono / Menlo Regular for code and console-oriented content

**Character:** The typography is compact, modern, and friendly rather than editorial. Body text favors clear scanning; stronger weights and modest size changes establish hierarchy without oversized marketing-style type.

### Hierarchy
- **Display** (600, project-dependent): Reserved for prominent titles or full-screen modal headings.
- **Headline** (600–700): Page and section headings; use Ant Design Typography levels.
- **Title** (500–600): Card titles, modal titles, and navigation labels.
- **Body** (400, 14px base): Settings, descriptions, tables, and operational copy.
- **Label** (400–600): Controls, tabs, tags, and compact status copy; preserve Ant Design's readable contrast.
- **Mono** (regular): Code editor, console logs, script output, and technical identifiers.

## Layout

JNbot is desktop-first and intentionally keeps the main workspace visible alongside Minecraft. The app shell uses a compact 48px header, persistent navigation or sidebar regions, and scrollable content panes. Settings use a two-column layout with a 190px tab rail and a flexible content area; narrower windows can stack the settings navigation vertically, but phone layouts are out of scope.

Use Ant Design Layout, Grid, Space, Flex, Tabs, and Card primitives where possible. Maintain a clear primary workspace and avoid decorative layers that obscure bot state, active server, script output, or action controls. Common spacing is token-driven; existing custom surfaces use 8px, 12px, 16px, 20px, and 24px rhythms.

## Elevation & Depth

The system uses a layered atmospheric model. Depth is established first through tonal surface steps (`colorBgLayout` → `colorBgContainer` → `colorBgElevated`), then through quiet borders, and finally through soft shadows for cards, modals, drawers, and floating panels. Dark themes commonly use shadows in the 12–48px blur range; the Light theme uses cooler, lower-opacity shadows. Depth should clarify containment and focus, never become a decorative backdrop.

### Shadow Vocabulary
- **Secondary lift:** theme `boxShadowSecondary`, typically a soft 12–32px shadow for smaller raised surfaces.
- **Primary lift:** theme `boxShadow`, typically an 18–60px shadow for cards, dialogs, and major overlays.
- **Floating panel:** `0 8px 24px rgba(0, 0, 0, 0.35)` with a subtle translucent border for compact overlays.

### Named Rules
**The Atmospheric Restraint Rule.** Use enough tonal and shadow contrast to explain hierarchy, then stop; visual atmosphere must never reduce state legibility or control discoverability.

## Shapes

The form language is softly rounded and component-led. Theme radii range from 6px to 10px, with 8px as the common control and card radius; custom floating panels use 12px. Borders are quiet and usually low-contrast. Inputs, cards, modals, drawers, tabs, and menus should inherit Ant Design shape tokens and active-theme component overrides rather than inventing one-off silhouettes.

## Components

### Buttons
- **Shape:** Softly rounded, usually 6–8px; use Ant Design Button.
- **Primary:** Active-theme primary color, with primary text selected for contrast. The PlayButton uses a primary action and switches to a danger state while a script is active.
- **Hover / Focus:** Use Ant Design token states (`colorPrimaryHover`, `colorPrimaryActive`) and visible focus treatment.
- **Secondary / Ghost / Tertiary:** Use theme-aware default, text, or ghost variants; do not simulate hierarchy with arbitrary colors.

### Chips and Tags
- **Style:** Theme-derived muted surfaces with readable text; selected or semantic states use the active primary, success, warning, or error tokens.
- **State:** Selected, active, and status tags should remain distinguishable without relying on color alone.

### Cards / Containers
- **Corner Style:** 8px by default, 10px in the Mocha theme, with 12px reserved for floating custom panels.
- **Background:** Active `colorBgContainer` or `colorBgElevated`.
- **Shadow Strategy:** Use the theme's card or elevation shadow sparingly to separate a surface from its parent.
- **Border:** Use `colorBorderSecondary` for quiet structure.
- **Internal Padding:** Follow Ant Design Card defaults or an 8/16/24px rhythm.

### Inputs / Fields
- **Style:** Active-theme container background, theme border, and readable placeholder/text tokens.
- **Focus:** Primary token border/ring treatment with clear contrast; avoid bright ambient glow as the only focus cue.
- **Error / Disabled:** Use semantic error and disabled tokens, preserving text legibility and action affordance.

### Navigation
- **Style:** Compact dark or light sidebar/header surfaces, 48px header height, and active menu backgrounds derived from the current theme.
- **States:** Hover and selected states use low-contrast fills plus text/icon changes; selection should remain obvious in monochrome or low-saturation themes.

### Settings Modal
The settings modal is a signature operational composition: a titled header, a vertical tab rail on desktop, scrollable content, and a footer for actions. It uses theme surfaces, a subtle border, controlled padding, and a deep but soft shadow. Preserve the separation between setting description and control, with the control aligned to the right on wide layouts and stacked only when necessary.

### Console and Code Surfaces
Console logs, scripts, and code use mono-oriented typography and denser spacing than general settings. Preserve clear status colors and selection behavior, but keep technical output visually subordinate to the active operation controls.

## Do's and Don'ts

### Do:
- **Do** use Ant Design components and active-theme tokens as the first implementation choice.
- **Do** preserve theme switching across Light, Dark, Obsidian, Night, and Gold variants.
- **Do** use layered surfaces and soft shadows to clarify hierarchy around active work.
- **Do** keep bot status, server context, script state, and destructive actions immediately legible.
- **Do** use mono typography for code, logs, and technical identifiers.

### Don't:
- **Don't** introduce hard-coded colors that bypass the active theme.
- **Don't** add Minecraft decoration, textures, or effects that compete with operational information.
- **Don't** make every surface equally elevated; reserve the strongest depth for dialogs, drawers, and important focus areas.
- **Don't** optimize for phone layouts or compress the desktop workspace until it becomes ambiguous.
- **Don't** use color as the sole indicator of active, error, running, or stopped state.
