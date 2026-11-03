#!/usr/bin/env bash
# Builds the JNbot mod for every Minecraft version in settings.gradle.kts into build/libs/.
# Publish the jars with: node scripts/publishMods.mjs (from the app root).
set -euo pipefail
cd "$(dirname "$0")"

rm -rf build/libs
./gradlew buildAndCollect
