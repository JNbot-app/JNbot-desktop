pluginManagement {
  repositories {
    mavenCentral()
    gradlePluginPortal()
    maven("https://maven.fabricmc.net/")
    maven("https://maven.kikugie.dev/releases")
  }
}

plugins {
  id("dev.kikugie.stonecutter") version "0.9.8"
  // Applies the right Loom variant: remapping for obfuscated versions, plain for 26.1+.
  id("dev.kikugie.loom-back-compat") version "0.4.2"
  // Auto-downloads the JDK a target needs (26.x requires Java 25).
  id("org.gradle.toolchains.foojay-resolver-convention") version "1.0.0"
}

stonecutter {
  create(rootProject) {
    // Supported Minecraft versions; per-version deps live in stonecutter.properties.toml.
    versions("1.21.11", "26.3")
    vcsVersion = "1.21.11"
  }
}

rootProject.name = "jnbot-fabric"
