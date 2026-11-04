/**
 * Shrinks node_modules/minecraft-data (~430 MB unpacked) to what JNbot ships:
 * bedrock data removed, per-version data gzipped, schema bugs fixed, and data.js
 * rewritten to read the .gz files (from MC_DATA_PATH when set).
 *
 * npm skips the root postinstall on `npm install <pkg>` and `npm update`, so this
 * also runs before start and the builds. It is a no-op on a patched package, and
 * data.js is written last so an interrupted run resumes on the next one.
 */
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packageDir = path.join(root, 'node_modules', 'minecraft-data');
const dataDir = path.join(packageDir, 'minecraft-data', 'data');
const dataJsPath = path.join(packageDir, 'data.js');

const DATA_LOADER = `const fs = require("fs")
const path = require("path")
const zlib = require("zlib")

let cache = {}
const currDir = process.env.MC_DATA_PATH || __dirname
function getDataFile(filePath) {
  if (cache[filePath]) { return cache[filePath] }
  let fullPath = path.join(currDir, filePath)
  if (!fs.existsSync(fullPath)) {
    const alt = path.join(currDir, "minecraft-data", filePath)
    if (fs.existsSync(alt)) fullPath = alt
  }
  const content = zlib.gunzipSync(fs.readFileSync(fullPath))
  cache[filePath] = JSON.parse(content)
  return cache[filePath]
}
`;

const readGzJson = (file) =>
  JSON.parse(zlib.gunzipSync(fs.readFileSync(file)).toString());

const editFile = (file, edit) =>
  fs.writeFileSync(file, edit(fs.readFileSync(file, 'utf8')));

function removeBedrock() {
  const dropRequires = (code) =>
    code.replace(
      /bedrock: *require\(['"]\.+\/minecraft-data\/data\/bedrock[^'"]+['"]\),?/g,
      '',
    );

  editFile(path.join(dataDir, 'dataPaths.json'), (text) => {
    const { bedrock, ...dataPaths } = JSON.parse(text);
    return JSON.stringify(dataPaths);
  });
  editFile(path.join(packageDir, 'index.js'), (code) =>
    dropRequires(code).replace(/const types = [^\n]+/, "const types = ['pc']"),
  );
  editFile(path.join(packageDir, 'lib', 'supportsFeature.js'), dropRequires);
  fs.rmSync(path.join(dataDir, 'bedrock'), { recursive: true, force: true });
}

/** `pc/common` stays uncompressed: index.js requires those files directly. */
function compressData() {
  const pcDir = path.join(dataDir, 'pc');
  for (const version of fs.readdirSync(pcDir, { withFileTypes: true })) {
    if (!version.isDirectory() || version.name === 'common') continue;
    const versionDir = path.join(pcDir, version.name);
    for (const name of fs.readdirSync(versionDir)) {
      if (!/\.(json|yml)$/.test(name)) continue;
      const file = path.join(versionDir, name);
      const content = fs.readFileSync(file, 'utf8');
      const minified = name.endsWith('.json')
        ? JSON.stringify(JSON.parse(content))
        : content;
      fs.writeFileSync(`${file}.gz`, zlib.gzipSync(minified, { level: 9 }));
      fs.rmSync(file);
    }
  }
}

/** Every protocol.json.gz of the pc versions speaking `protocolVersion`. */
function protocolFiles(protocolVersion) {
  const { pc } = JSON.parse(
    fs.readFileSync(path.join(dataDir, 'dataPaths.json'), 'utf8'),
  );
  const files = new Set();
  for (const { version, protocol } of Object.values(pc)) {
    if (!version || !protocol) continue;
    const versionFile = path.join(dataDir, version, 'version.json.gz');
    if (readGzJson(versionFile).version === protocolVersion) {
      files.add(path.join(dataDir, protocol, 'protocol.json.gz'));
    }
  }
  return files;
}

/**
 * Protocol 766 (1.20.5/1.20.6) defines potion_contents with a trailing customName
 * that only exists since 767. The parser over-reads and desyncs the packet, e.g.
 * "array size is abnormally large" on window_items for a menu holding a potion.
 */
function fixPotionContents766() {
  for (const file of protocolFiles(766)) {
    const protocol = readGzJson(file);
    const fields = protocol.types.SlotComponent[1][1].type[1].fields;
    const potionContents = fields.potion_contents?.[1];
    if (potionContents?.at(-1)?.name !== 'customName') continue;
    potionContents.pop();
    fs.writeFileSync(file, zlib.gzipSync(JSON.stringify(protocol), { level: 9 }));
  }
}

function rewriteDataLoader() {
  editFile(
    dataJsPath,
    (code) =>
      DATA_LOADER +
      code
        .replace(/return require\(/g, 'return getDataFile(')
        .replace(/\.json"/g, '.json.gz"')
        .replaceAll('./minecraft-data/data/', './data/')
        .replaceAll(' __dirname ', ' currDir '),
  );
}

/** Fails the install on a minecraft-data release these patches no longer fit. */
function verify() {
  const minecraftData = createRequire(import.meta.url)(packageDir);
  const latest = minecraftData.supportedVersions.pc.at(-1);
  if (!minecraftData(latest)?.blocksArray?.length) {
    throw new Error(`patched minecraft-data has no blocks for ${latest}`);
  }
}

if (!fs.readFileSync(dataJsPath, 'utf8').includes('getDataFile')) {
  removeBedrock();
  compressData();
  fixPotionContents766();
  rewriteDataLoader();
  verify();
  console.log('Patched minecraft-data');
}
