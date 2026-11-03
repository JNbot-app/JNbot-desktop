import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const version = JSON.parse(
  readFileSync(join(projectRoot, "release", "app", "package.json"), "utf8"),
).version;
const configuredPath = process.env.JNBOT_SOURCE_JSON;
const sourceCandidates = [
  configuredPath ? resolve(projectRoot, configuredPath) : undefined,
  join(projectRoot, "..", "jnbot-mobile", "dist", "altstore", "source.json"),
  join(projectRoot, "release", "source.json"),
  join(projectRoot, "source.json"),
].filter(Boolean);
const sourcePath = sourceCandidates.find((candidate) => existsSync(candidate));

if (!sourcePath) {
  throw new Error(
    `source.json was not found. Build or provide it with JNBOT_SOURCE_JSON before releasing v${version}.`,
  );
}

try {
  JSON.parse(readFileSync(sourcePath, "utf8"));
} catch (error) {
  throw new Error(`Invalid source.json at ${sourcePath}: ${error.message}`);
}

const tag = `v${version}`;
if (process.argv.includes("--dry-run")) {
  console.log(`Would upload ${sourcePath} to ${tag} on usserwout/JNbot-updater.`);
} else {
  execFileSync(
    "gh",
    ["release", "upload", tag, sourcePath, "--repo", "usserwout/JNbot-updater", "--clobber"],
    { cwd: projectRoot, stdio: "inherit" },
  );
}
