import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const appRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const mobileRoot = path.resolve(appRoot, '../jnbot-mobile');
const destination = path.join(mobileRoot, 'src/generated/client-contract');
const sourceRoot = path.join(appRoot, 'src/common');
const files = [
  'chains.ts',
  'clientPermissions.ts',
  'cooldowns.ts',
  'mobileClientContract.ts',
  'pluginPresets.ts',
  'pluginSignatures.ts',
  'profileCreation.ts',
  'profileUiSchema.ts',
  'scriptKinds.ts',
  'share.ts',
  'statsHistory.ts',
  'triggers.ts',
  'messaging/Address.ts',
  'messaging/Errors.ts',
  'messaging/Protocol.ts',
  'messaging/Transport.ts',
  'messaging/NetworkFrame.ts',
  'messaging/Messenger.ts',
];
const check = process.argv.includes('--check');
const generatedAssets = [
  {
    name: 'inventory-textures.json',
    source: path.join(
      appRoot,
      'src/renderer/components/other/botSideBar/panelTabs/inventory/textures.json',
    ),
    destination: path.join(mobileRoot, 'src/generated/inventory-textures.json'),
  },
];

const source = files.map((file) => {
  const text = fs.readFileSync(path.join(sourceRoot, file), 'utf8');
  return [file, text];
});
const manifest = {
  contractVersion: 1,
  files: Object.fromEntries(
    source.map(([file, text]) => [
      file,
      crypto.createHash('sha256').update(text).digest('hex'),
    ]),
  ),
  assets: Object.fromEntries(
    generatedAssets.map((asset) => {
      const text = fs.readFileSync(asset.source, 'utf8');
      return [
        asset.name,
        crypto.createHash('sha256').update(text).digest('hex'),
      ];
    }),
  ),
};

let stale = false;
for (const [file, text] of source) {
  const output = path.join(destination, file);
  if (!fs.existsSync(output) || fs.readFileSync(output, 'utf8') !== text) {
    stale = true;
    if (!check) {
      fs.mkdirSync(path.dirname(output), { recursive: true });
      fs.writeFileSync(output, text);
    }
  }
}
for (const asset of generatedAssets) {
  const text = fs.readFileSync(asset.source, 'utf8');
  if (
    !fs.existsSync(asset.destination) ||
    fs.readFileSync(asset.destination, 'utf8') !== text
  ) {
    stale = true;
    if (!check) {
      fs.mkdirSync(path.dirname(asset.destination), { recursive: true });
      fs.writeFileSync(asset.destination, text);
    }
  }
}
const manifestPath = path.join(destination, 'manifest.json');
const manifestText = `${JSON.stringify(manifest, null, 2)}\n`;
if (
  !fs.existsSync(manifestPath) ||
  fs.readFileSync(manifestPath, 'utf8') !== manifestText
) {
  stale = true;
  if (!check) {
    fs.mkdirSync(destination, { recursive: true });
    fs.writeFileSync(manifestPath, manifestText);
  }
}
if (check && stale)
  throw new Error(
    'Mobile client contract is stale. Run npm run sync:mobile-client-contract in app.',
  );
console.log(
  `${check ? 'Checked' : 'Synced'} mobile client contract (${files.length} files, ${generatedAssets.length} asset).`,
);
