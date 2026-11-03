# Agent guidelines

Guidelines for AI coding agents (and humans) working in this repository.

## Workflow
- Keep context focused: only load the scripts and dependencies relevant to the task.
- Run the typecheck only after larger code changes; it is slow.

## Coding
- Write clean, readable code that follows the existing conventions. Keep it simple and maintainable, and simplify existing code where possible.
- Only implement what the task requires; avoid unnecessary code.
- Avoid duplication and remove code that is no longer needed.
- Keep changes small; reformat, deduplicate or remove code when that keeps a change lean.
- Write efficient code and avoid unnecessary overhead.
- Do not use Electron `safeStorage`; it can prompt users for their system password.

## UI (React)
- Split large components into smaller, reusable ones.
- Do not hardcode colors; use the Ant Design theme tokens.
- Use current Ant Design components. Do not use the deprecated `List` component, and only use `Alert` when it adds real value.
- Keep the UI consistent with the rest of the app.
- Avoid unnecessary re-renders. Only use `memo` when it is really needed.
- Do not use the `Drawer` component; use the side panel (`src/renderer/components/other/botSideBar/SidePanel.tsx`).

## Mobile app
The mobile app ([JNbot-mobile](https://github.com/usserwout/JNbot-mobile)) shares this backend; only the React layer differs. When changing the React UI here, make the same change in the mobile app. Mobile supports a subset of the desktop features, but shared features must behave the same.
