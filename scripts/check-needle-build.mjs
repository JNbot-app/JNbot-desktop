import fs from 'node:fs';
import path from 'node:path';
import { source, fingerprint } from './build-needle.mjs';

const { engineRevision } = JSON.parse(
  fs.readFileSync(path.join(source, 'model.json'), 'utf8'),
);
const directory = path.join(source, 'engine/mobile', engineRevision);
let valid = false;
try {
  const saved = JSON.parse(
    fs.readFileSync(path.join(directory, 'ios-build.json'), 'utf8'),
  );
  valid =
    saved.fingerprint === fingerprint() &&
    fs.existsSync(
      path.join(directory, 'JNbotInference.xcframework/Info.plist'),
    );
} catch {
  /* Missing or incomplete build. */
}
if (!valid) {
  process.stderr.write(
    'The packaged iOS inference runtime is missing or stale. Run npm run prepare:needle-mobile -- --ios in the app checkout.\n',
  );
  process.exitCode = 1;
}
