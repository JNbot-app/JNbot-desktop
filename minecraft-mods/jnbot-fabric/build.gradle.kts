plugins {
  id("dev.kikugie.loom-back-compat")
}

val modVersion = property("mod.version").toString()

version = "$modVersion+${sc.current.version}"
base.archivesName = "jnbot-fabric"

val requiredJava = if (sc.current.parsed >= "26.1") JavaVersion.VERSION_25 else JavaVersion.VERSION_21

dependencies {
  minecraft("com.mojang:minecraft:${sc.current.version}")
  // Applies Mojang mappings on obfuscated versions.
  loomx.applyMojangMappings()
  modImplementation("net.fabricmc:fabric-loader:${property("deps.fabric_loader")}")
  modImplementation("net.fabricmc.fabric-api:fabric-api:${property("deps.fabric_api")}")
}

loom {
  splitEnvironmentSourceSets()

  mods {
    register("jnbot") {
      sourceSet(sourceSets["main"])
      sourceSet(sourceSets["client"])
    }
  }

  runConfigs.all {
    runDirectory = rootProject.file("run")
  }
}

java {
  sourceCompatibility = requiredJava
  targetCompatibility = requiredJava
  toolchain {
    languageVersion = JavaLanguageVersion.of(requiredJava.majorVersion)
  }
}

tasks {
  withType<ProcessResources> {
    val props = mapOf(
      "version" to modVersion,
      "minecraft" to sc.current.version,
      "java" to "JAVA_${requiredJava.majorVersion}",
    )
    inputs.properties(props)
    filesMatching(listOf("fabric.mod.json", "*.mixins.json")) { expand(props) }
  }

  withType<JavaCompile> {
    options.encoding = "UTF-8"
  }

  // Copies the built jar to the root build/libs so publish scripts find every version in one place.
  register<Copy>("buildAndCollect") {
    group = "build"
    from(loomx.modJar.flatMap { it.archiveFile })
    into(rootProject.layout.buildDirectory.dir("libs"))
  }
}
