const build = require("./esbuild.config.main.base")

async function runBuild() {
  await build({
  })
  process.exit(0)
}

runBuild().catch(() => process.exit(1));
