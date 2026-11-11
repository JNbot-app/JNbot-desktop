# Local inference runtime

The shared backend exposes `script.ai` on desktop, CLI, and mobile. The native package supplies a Node-API binding around one Needle decoder. Models contain data only; runtime code ships with the app.

## Model

There is one built-in model. Set its `id`, `url` and `sha256` in `model.json`, and bump `id` whenever the model file changes. `modelUrl` overrides the download with a compatible custom `.cact` file; each custom URL gets its own cache folder.

The model file can be a bare `.cact` archive or a bundle. Only the `needle` section is used: the engine maps it and JavaScript reads just the header and tokenizer. Gemma memory, embeddings and tool filtering were removed with the Gemma encoder.

## Options

- `windowSize` (default 512, up to the model context of 8192): how many earlier tokens each decoder layer attends to. Raise it for long prompts or large tool lists. Changing it rebuilds the KV cache (and drops the cached tool prefix).
- `reasoning` (default off) and `maxNewTokens` work as before.

## Tool-prefix cache

The prompt starts with the tool list. `init()` tells the engine how many tokens that prefix has (`np_set_prefix`). After the first prefill the engine keeps a snapshot of the KV cache and histories at the last whole 128-token chunk inside the prefix. A later request whose prompt starts with the same tokens restores the snapshot and only prefills the rest. Results are exactly the same as a full prefill; `stats().prefixReusedTokens` shows how many tokens were reused. There is one snapshot, so switching between tool sets re-prefills.

## Builds

Run `npm run build:needle`. CMake builds the vendored decoder. Apple platforms use Accelerate. Other targets build the pinned single-threaded OpenBLAS dependency. Set `NODE_INCLUDE_DIR` to use existing Node headers; otherwise node-gyp installs headers matching the build host. Windows also needs `NODE_LIBRARY` pointing to Node's matching import library. `--arch=x64` and `--arch=arm64` select a target.

`npm run prepare:needle-mobile -- --android` prepares Android ARM64 and its BLAS installation (set `ANDROID_NDK_HOME` to NDK 27.1 or newer). Other Android architectures keep a small binding that returns `AI_UNSUPPORTED_PLATFORM`. `npm run prepare:needle-mobile -- --ios` builds iOS ARM64 and both simulator architectures into `JNbotInference.xcframework` (iOS 15.1+, links Accelerate and libc++). With no platform argument both are prepared.

## Updating the engine

`vendor/decoder` is a copy of `native/needle` from the training repo (`needle_jnbot`); `vendor/provenance.json` records the revision. Copy the same file list over, rebuild, and run the native test with a real model:

```sh
JNBOT_TEST_MODEL=/path/to/model.cact npx jest --selectProjects main --testPathPattern local-ai-native
```

`vendor/LICENSE` applies to the custom runtime. Build outputs include dependency license notices.
