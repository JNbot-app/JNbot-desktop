package com.jnbot.client.config;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;

import net.fabricmc.loader.api.FabricLoader;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;

public final class JnbotClientConfigStore {
  private static final Gson GSON = new GsonBuilder().setPrettyPrinting().create();
  private static final String FILE_NAME = "jnbot-client.json";

  private static final JnbotClientConfigStore INSTANCE = new JnbotClientConfigStore();

  public static JnbotClientConfigStore getInstance() {
    return INSTANCE;
  }

  private JnbotClientConfig config = JnbotClientConfig.defaults();

  private JnbotClientConfigStore() {
    load();
  }

  public JnbotClientConfig get() {
    return config;
  }

  public void load() {
    try {
      Path path = getConfigPath();
      if (!Files.exists(path)) {
        config = JnbotClientConfig.defaults();
        save();
        return;
      }

      String json = Files.readString(path, StandardCharsets.UTF_8);
      JnbotClientConfig parsed = GSON.fromJson(json, JnbotClientConfig.class);
      config = parsed != null ? parsed : JnbotClientConfig.defaults();
    } catch (Exception ignored) {
      config = JnbotClientConfig.defaults();
    }
  }

  public void save() {
    try {
      Path path = getConfigPath();
      Files.createDirectories(path.getParent());
      Files.writeString(path, GSON.toJson(config), StandardCharsets.UTF_8);
    } catch (Exception ignored) {
    }
  }

  private static Path getConfigPath() {
    return FabricLoader.getInstance().getConfigDir().resolve(FILE_NAME);
  }
}
