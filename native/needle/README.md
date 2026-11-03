# Local inference runtime

The shared backend exposes `script.ai` on desktop, CLI, and mobile. The native package supplies a Node-API binding, with one environment-owned decoder and optional encoder. It exposes no separate React Native API. Models contain data only; runtime code ships with the app.

Set the release `id`, `mainUrl`, and optional `flashUrl` in `model.json`. Bump `id` whenever model data changes. Blank `flashUrl` uses `mainUrl`. URLs are intentionally unset until hosting is configured. `modelUrl` overrides the selected variant's download. Different custom URLs have separate physical caches; variants of the same custom URL share a file. Public model IDs include the variant and a new namespace so stored embeddings are regenerated.

Main loads the decoder, representation adapter, and encoder from bounded file sections. Flash accepts the full bundle, a stripped bundle, or a deployed decoder archive and never loads an encoder. Main requires the full inference assets. Inference ignores training and original-base sections. Bundle indices, used section fingerprints, adapter pairing, tensor geometry, and the trained encoder source contract are checked before use. Files are never extracted or loaded wholesale into JavaScript.

`npm run export:flash -- source.cact destination.cact` streams the deployed decoder into a new file. It refuses to overwrite the source or an existing destination. No model weights are changed.

## Builds

Run `npm run build:needle`. CMake builds the vendored runtime and the pinned encoder dependency. Apple platforms use Accelerate. Other targets build the pinned single-threaded OpenBLAS dependency. Set `NODE_INCLUDE_DIR` to use existing Node headers; otherwise node-gyp installs headers matching the build host. Windows also needs `NODE_LIBRARY` pointing to Node's matching import library. Host builds use the current architecture; `--arch=x64` and `--arch=arm64` select a target. Cross-toolchains must support that target.

`npm run prepare:needle-mobile -- --android` prepares Android ARM64 and its BLAS installation. Set `ANDROID_NDK_HOME` to NDK 27.1 or newer. Gradle builds the linked addon against Node.js Mobile's headers. Other Android architectures retain a small binding that returns `AI_UNSUPPORTED_PLATFORM`.

`npm run prepare:needle-mobile -- --ios` builds iOS ARM64 and both simulator architectures, then merges the static dependencies into `JNbotInference.xcframework`. Link Accelerate and libc++. The minimum iOS version is 15.1. With no platform argument the helper prepares both mobile platforms. Models still download only on first use.

Build scripts fetch exact dependency commits into ignored `engine/` directories and reject changed tracked dependency sources. The native source/build fingerprint invalidates stale desktop artifacts. Bundled worker JavaScript, native libraries, downloaded dependencies, and notices are generated artifacts. Backend build verification can use `npm run build:mobile-backend -- --no-sync` to build the distributable without copying it into the mobile checkout.

## Independent requests and prefix reuse

Tools, aliases, decoding constraints, and prefix tokens stay prepared until the toolset or extraction mode changes. Each completion resets query state. `run()` makes one prediction and executes its handlers without model-driven continuation.

The decoder caches full prefill chunks only, comparing their exact token IDs. Flash restores one prefix snapshot containing text KV, convolution and token histories. Main caches the boundary streams before representation block 5 and rebuilds the query-dependent layers. It restores the lower-layer state at the prefix boundary. Cached streams and engram features are capped at 16 MiB, plus one KV/history snapshot. Context positions, chunk boundaries, and tokenization are preserved; smaller or changed prefixes invalidate the cache. Query representation banks are never cached. `stats` reports reused tokens and encoder presence for validation.

Vendored source attribution and dependency pins are recorded in `vendor/provenance.json`; `vendor/LICENSE` applies to the custom runtime. Build outputs include dependency license notices. No Python, JAX, training dependencies, or local training-checkout paths are needed in production.
