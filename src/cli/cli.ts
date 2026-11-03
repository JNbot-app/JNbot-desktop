process.title = 'JNbot CLI';

async function main(): Promise<void> {
  // The CLI bundle is ESM. Initialise the Electron compatibility layer before
  // loading any backend service, as several services read `app.getPath()` at
  // module-evaluation time.
  await import('./mocks');
  const { createProgram } = await import('./v2/commands');
  const program = createProgram();
  program.exitOverride();
  try {
    await program.parseAsync(process.argv);
  } catch (error: any) {
    if (error?.code === 'commander.helpDisplayed' || error?.code === 'commander.version') return;
    process.stderr.write(`Error: ${error?.stack ?? error?.message ?? String(error)}\n`);
    process.exitCode = 2;
  }
}

void main();
