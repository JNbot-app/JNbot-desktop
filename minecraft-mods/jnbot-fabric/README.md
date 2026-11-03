# JNbot Fabric Mod

Client + managed-server mod used by the JNbot launcher ("JNbot client").

One source tree targets several Minecraft versions with
[Stonecutter](https://stonecutter.kikugie.dev/):

- Supported versions: `settings.gradle.kts`; per-version dependencies: `stonecutter.properties.toml`.
- Sources use Mojang mappings and are written against the active version (`stonecutter.gradle.kts`).
- Pure renames between versions are string/regex replacements in `stonecutter.gradle.kts`;
  behavior differences use `//? if >=26.1` blocks, mostly in `compat/ClientCompat.java`.
- Switch the version your IDE sees with the `Set active project to <version>` Gradle task.

## Build

```bash
./build.sh            # all versions -> build/libs/jnbot-fabric-<mod>+<mc>.jar
./gradlew 26.3:build  # a single version
```

Gradle downloads the JDKs it needs (Java 25 for 26.x, Java 21 for 1.21.11).

## Publish

The app downloads the mod at launch instead of bundling it. Bump `mod.version` in
`stonecutter.properties.toml`, then from the app root:

```bash
GH_TOKEN=... node scripts/publishMods.mjs
```

This pushes the jars and `manifest.json` to the `jnbot-mods` branch of JNbot-updater,
served through the Cloudflare proxy at `/mods/...` (`scripts/cloudflare-jndata`).

## Add a Minecraft version

1. Add it to `versions(...)` in `settings.gradle.kts` and a section in `stonecutter.properties.toml`.
2. `./gradlew <version>:build` and fix differences with replacements / `//? if` blocks.
3. Publish — the app picks the new version up from the manifest automatically.
