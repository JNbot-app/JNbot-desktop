# Test harness

A lightweight harness for finding bugs in the parts of the app that are easy to
break and annoying to test by hand — **without ever joining a server**. Three
tracks:

| Track | What it covers | Runner |
|-------|----------------|--------|
| **1. Settings / profiles / alts** | cold start (no files), corrupt/invalid files, CRUD + delete edge cases, persistence round-trips | Jest (`main` project) |
| **2. Script-runnability matrix** | does a plugin actually load & start running, for every language × plugin type | mostly a standalone Node script + Jest for the non-worker types |
| **3. Offline bot protocol fixtures** | real worker + Mineflayer against an ephemeral loopback Minecraft server | Node 22 `node:test` |

## Commands

```bash
npm test            # all Jest tests (renderer + main projects)
npm run test:main   # just the main-process tests (settings/profiles/alts + plugin types)
npm run test:scripts# the real-worker script-runnability matrix
npm run test:all    # Jest + the worker matrix
npm run test:bots:core    # loopback protocol, worker messaging, HTTP fixture boundary
npm run test:bots:scripts # verify critical Jartex/Pika JNP references and extensions
npm run test:bots         # both bot tracks plus the existing worker matrix
```

`test:bots:*` builds the worker fresh and self-reexecutes under Node 22 or
newer. It is entirely offline: joins are granted only to `127.0.0.1` and
plugin HTTP is answered from declared fixtures.

## Offline protocol fixtures

`test/protocol/semantic-scenario.test.js` starts the built `main.worker.js`,
replies to its normal `BOT_JOIN_REQUEST`, and drives a real Mineflayer
connection over a local `minecraft-protocol` server. Scenarios are data-first:

```js
{
  name: 'held-item', version: '1.8.9', script: pluginCode,
  steps: [{ send: 'spawn' }, { expect: 'held_item_slot', slot: 2 }],
  http: [{ method: 'GET', url: 'https://example.test/rank', data: { rank: 'VIP' } }]
}
```

Supported fixture types are defined in `test/protocol/scenario.d.ts`. Add new
packet mappings in the harness rather than putting callback code in individual
scenarios. An unknown HTTP URL fails the worker request; it never falls back to
the network.

The current baseline covers spawn/login wiring, held-item packets, generated
bundle resolution for Gkit Collector, Kit Collector, Alt Scanner, Book Sorter,
and their Jartex/Pika extensions, plus protocol metadata for the supported
version grid. Extend it with real script flows and recovery fixtures as their
semantic packet vocabulary is added.

### Safe live capture import

Use the existing proxy Recorder only for navigation: login, gamemode selection,
menus, scoreboard/tab inspection, then disconnect. Do not claim kits, buy,
trash, gift, or transfer items. Convert a local raw `.log` recording with:

```bash
npm run test:fixtures:import -- /path/to/recording.log test/protocol/fixtures/my-navigation.json
```

The importer refuses to overwrite an output file, discards chat packets, keeps
only the currently supported navigation semantics, and redacts credentials,
account identifiers, hosts, and verification fields. Commit the sanitized
semantic fixture only; raw recordings stay local.

## How it works

### Mocked Electron (`__mocks__/electron.ts`)

The main-process modules read `app.getPath('userData')` at import time and
register `ipcMain` handlers. Jest auto-applies this manual mock to every test:

- `app.getPath('userData')` → a throwaway temp dir (set per-test via
  `__setUserDataDir`, which `test/main/helpers.ts#bootElectron` does for you).
- `ipcMain.on/handle` registrations are captured; tests fire them with
  `ipcMain.__emit(channel, ...)` / `ipcMain.__invoke(channel, ...)`.

The standard pattern (see `helpers.ts`): pick a fresh temp dir → `bootElectron(dir)`
(resets the module registry + points electron at the dir) → `require()` the module
under test so it boots clean.

> Note: tests run under the system Node (currently **14.x**). `jest.config.js`
> tells ts-jest to downlevel to ES2019 so transpiled source never emits syntax
> Node 14 can't parse (e.g. `??=`).

### Track 1 — settings / profiles / alts

`test/main/storage.test.ts`, `profiles.test.ts`, `settings-alts.test.ts` drive
the **real** `Storage`, `Profiles` and `Settings` classes against a temp dir.
They assert the edge cases that bite users: no file yet, corrupt JSON, failed
validation, deleting the last alt/profile, deleting predefined profiles,
reorder + persistence, marketplace-uninstall fallback, etc.

These tests also **document a subtle design**: alt deletion is *profile-scoped*.
Dropping an alt from the active profile clears its per-server `altData` (so it
leaves `getAltsWithData()`) but keeps the cross-server identity in
`shared.alts`, because another profile may still use it.

### Track 2 — script-runnability matrix

The 3 languages (`js` / `ts` / `components`) × 4 plugin types
(`script` / `action` / `profileUi` / `botExtension`) don't all execute the same
way, so they're tested where they actually run:

**Real worker** (`test/scripts/runScriptMatrix.js`, `npm run test:scripts`):
spawns the real built `main.worker.js` and runs a minimal fixture in it, with
**no server join**. It self-execs under Node ≥ 18 (the worker bundle uses modern
syntax the system Node 14 can't parse) and builds the worker first if missing.

| Cell | Verifies |
|------|----------|
| `js / script` | plugin body executes (marker observed), clean exit |
| `ts / script` | TS type-stripped to JS, body executes |
| `components / script` | component compiler + runtime execute a start canvas |
| `js / action` | action-runner pipeline runs to completion (0 alts → no join) |
| `ts / action` | same, transpiled |

> Caveat: with 0 alts the action *body* never runs (the alt-iteration loop is
> empty) — this cell exercises the runner *plumbing*, not the user code. The
> body needs ≥ 1 alt, i.e. a real join, which is intentionally out of scope.

**Jest** (`test/main/plugin-types.test.ts`) for the two types that don't run in
the worker:

- `botExtension` → `compileBotExtension(code)` (the real load site): a js/ts
  extension exporting a function loads; bad/throwing/non-function code returns
  `null` instead of crashing. Full execution needs a bot worker (a join), so
  only the load is covered.
- `profileUi` → the real `ProfileUiRunner` vm path with the plugin
  storage/resolver stubbed: builder-API code and plain-literal code produce
  valid UI JSON; checksum mismatch / garbage / throwing actions return
  `{ ok: false }` instead of crashing.

## Known pre-existing failure

`src/__tests__/App.test.tsx` (renderer) was already broken before this harness:
antd v6 ships ESM in `node_modules` that ts-jest doesn't transform, so the
suite hangs/errors (the original `npm test` on `main` timed out too). Fixing it
needs a different transform strategy (babel-jest for those deps, or mocking
antd) and is out of scope here. Use `npm run test:main` for the green suite.

## Adding cases

- **New settings/alt edge case** → add to the relevant `test/main/*.test.ts`;
  use `bootElectron` + a fresh temp dir.
- **New worker scenario** → add a cell to `buildMatrix()` in
  `test/scripts/runScriptMatrix.js` (`mode: 'exit'` for self-terminating
  fixtures, `mode: 'soak'` for long-lived runtimes).
