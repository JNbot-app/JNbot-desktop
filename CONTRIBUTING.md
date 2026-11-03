# Contributing to JNbot

Thanks for your interest in contributing! Bug reports, feature ideas and pull
requests are all welcome.

## Getting started

Requirements: Node.js 20 (see `.nvmrc`) and npm.

```sh
nvm use
npm install
npm start
```

`npm start` builds the main process and starts the Vite renderer with hot
reload. Building the Fabric mod (`npm run build:mods`) additionally needs a JDK.

## Project layout

| Path | What it is |
| --- | --- |
| `src/main` | Electron main process, bot runtime, scripts and IPC |
| `src/renderer` | React + Ant Design UI |
| `src/cli` | Headless CLI (`jnbot`) |
| `minecraft-mods` | Fabric mod used by the JNbot client |
| `cloud` | Cloudflare relay for remote access |
| `docs` | Plugin authoring docs and architecture decision records |
| `examples` | Example plugins and profile UI extensions |
| `test` | Jest and protocol tests |

## Before opening a pull request

- Run `npm run lint` and `npm test`.
- Keep changes focused; one feature or fix per pull request.
- UI changes: use Ant Design components and theme tokens instead of hardcoded
  colors, and include a screenshot in the pull request.
- Changes to the React UI should also be made in the mobile app
  (`jnbot-mobile`) where the feature exists there.

## Reporting bugs

Open an issue with your JNbot version, operating system, steps to reproduce and
any relevant logs. For security issues, see [SECURITY.md](SECURITY.md).

By contributing you agree that your contributions are licensed under the
[MIT License](LICENSE).
