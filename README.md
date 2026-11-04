<p align="center">
  <img src="assets/icon.png" width="96" alt="JNbot logo" />
</p>

<h1 align="center">JNbot</h1>

<p align="center">
  Desktop app for running Minecraft bots, scripts and macros, with built-in
  automation.
</p>

<p align="center">
  <a href="https://github.com/usserwout/JNbot-updater/releases/latest">Download</a> ·
  <a href="src/common/types/plugin-authoring.md">Plugin docs</a> ·
  <a href="CONTRIBUTING.md">Contributing</a>
</p>

<!-- TODO: add a screenshot or GIF of the app here -->

## Features

- **Bots** – run and manage multiple Minecraft bots from one dashboard.
- **Scripts & macros** – built-in server-specific scripts plus your own.
- **Profiles** – per-server configuration, action slots and scripts.
- **Plugins** – extend JNbot with signed plugins ([authoring guide](src/common/types/plugin-authoring.md)).
- **Triggers** – react to in-game events, e.g. with Discord webhook notifications.
- **Recording & learned bots** – record gameplay and train bots to imitate it.
- **Remote access** – control JNbot from the mobile app, a browser or the CLI.
- **Themes** – multiple built-in themes.

Runs on Windows, macOS and Linux.

## Installation

Download the latest installer for your platform from the
[releases page](https://github.com/usserwout/JNbot-updater/releases/latest).
The app updates itself automatically.

## Building from source

Requirements: Node.js 22 (see `.nvmrc`) and npm. Building the Fabric mod also
requires a JDK.

```sh
git clone https://github.com/JNbot-app/JNbot-desktop.git
cd JNbot-desktop
nvm use
npm install
npm start          # development mode with hot reload
npm run package    # build installers into release/build
```

Run the tests with `npm test` and the linter with `npm run lint`.

Service credentials (cloud backups and the TURN relay) are not part of the
repository. Builds work without them; to enable those features, put
`JNBOT_B2_KEY_ID`, `JNBOT_B2_SECRET`, `JNBOT_TURN_USERNAME` and
`JNBOT_TURN_CREDENTIAL` in a `.env` file at the repository root.

## CLI

Build the CLI with `npm run build:cli`, then start the dashboard with:

```sh
./release/app/dist/cli/jnbot
```

The dashboard is designed for narrow SSH and phone terminals. Logs and errors
appear in its Activity view instead of overwriting your input.

For automation or servers, use explicit commands:

```sh
jnbot serve --remote-access
jnbot script list --json
jnbot plugin import plugin.jnp --trust-unverified
jnbot data export JNbotBackup.json
jnbot cloud import --user USER_ID --share-key SHARE_KEY --yes
```

Run `jnbot --help` for all commands. Headless processes remain in the
foreground; use tmux, systemd, or Docker to keep them running. Closing the
owning CLI stops its scripts, bots, and remote access.

## Project structure

| Path | Description |
| --- | --- |
| `src/main` | Electron main process, bot runtime, scripts and IPC |
| `src/renderer` | React + Ant Design UI |
| `src/cli` | Headless CLI |
| `minecraft-mods` | Fabric mod used by the JNbot client |
| `cloud` | Cloudflare relay for remote access |
| `docs` | Plugin docs and architecture decision records |
| `examples` | Example plugins and profile UI extensions |

## Contributing

Contributions are welcome! Read [CONTRIBUTING.md](CONTRIBUTING.md) to get
started, and [SECURITY.md](SECURITY.md) for reporting vulnerabilities.

## Disclaimer

JNbot is not affiliated with Mojang, Microsoft, JartexNetwork or PikaNetwork.
Using bots or automation may break the rules of the server you play on. You are
responsible for how you use this software.

## License

[MIT](LICENSE)
