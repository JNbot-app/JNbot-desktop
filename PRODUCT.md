# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

React and Electron with Ant Design; the same desktop-focused interface also runs in a browser.

## Users

Primarily Minecraft players aged 25 and below who want to automate recurring gameplay and server tasks.

## Product Purpose

JNbot helps Minecraft players run bots, scripts, macros, profiles, and related server workflows from one desktop interface. Success means players can configure and operate useful automation with less repetitive manual work.

## Positioning

JNbot combines multiple layers of automation with built-in scripts tailored to specific Minecraft servers. Its feature-rich, server-aware approach distinguishes it from more generic automation tools.

## Operating Context

Users operate JNbot alongside Minecraft and configure server profiles, scripts, macros, connections, and bot behavior. The product is used on desktop computers running macOS, Windows, or Linux, and can also run in a desktop browser context.

## Capabilities and Constraints

- The interface is desktop-only; phone layouts are out of scope.
- Ant Design is the incumbent UI system and should remain the default component foundation.
- The application supports multiple themes.
- Colors must come from the active theme and design tokens; UI work must not introduce static hard-coded colors.
- The codebase includes server-specific scripts and automation features, so terminology and feature behavior should remain grounded in the existing implementation.

## Brand Commitments

There is no separate brand system currently established. JNbot already has multiple themes; future work should preserve theme flexibility rather than impose a single fixed visual identity.

## Evidence on Hand

The existing React/Electron renderer contains pages and components for dashboards, bots, profiles, macros, connections, server details, code editing, settings, and related automation workflows. Ant Design and theme files are already present in the renderer. No external brand assets or proof claims were provided; future work must not fabricate them.

## Product Principles

- Make powerful automation understandable and controllable.
- Keep server-specific workflows discoverable without hiding advanced capability.
- Preserve consistency through Ant Design and shared theme tokens.
- Optimize for focused desktop operation rather than mobile adaptation.
- Let themes change expression without changing product meaning or usability.

