import { execFile, spawn } from "node:child_process";
import { createWriteStream } from "node:fs";



const unpackLZMA = async (src: string, dest: string): Promise<void> => {
  return new Promise<void>((resolve, reject) => {

    // Use Node.js native child_process to decompress using system xz tool
    const isWindows = process.platform === 'win32';

    if (isWindows) {
      // On Windows, try to use 7z if available (commonly installed)
      execFile(
        '7z',
        ['e', '-so', src],
        { maxBuffer: 200 * 1024 * 1024 },
        (error, stdout) => {
          if (error) {
            // Fallback: Try using tar if available (Windows 10+ has tar with xz support)
            execFile(
              'tar',
              ['-xOf', src],
              { maxBuffer: 200 * 1024 * 1024 },
              (error2, stdout2) => {
                if (error2) {
                  reject(
                    new Error(
                      `Failed to decompress LZMA. Please install 7-Zip or ensure tar is available. Error: ${error2.message}`,
                    ),
                  );
                  return;
                }
                require('fs').writeFileSync(dest, stdout2);
                resolve();
              },
            );
            return;
          }
          require('fs').writeFileSync(dest, stdout);
          resolve();
        },
      );
    } else {
      // On Unix/macOS, use xz command
      const proc = spawn('xz', ['--decompress', '--stdout', src], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      const writeStream = createWriteStream(dest);

      // @ts-ignore
      proc.stdout.pipe(writeStream);

      proc.on('error', (err) => {
        reject(
          new Error(
            `Failed to spawn xz command: ${err.message}. Please ensure xz is installed.`,
          ),
        );
      });

      proc.on('exit', (code) => {
        if (code !== 0) {
          reject(new Error(`xz command exited with code ${code}`));
        } else {
          resolve();
        }
      });

      writeStream.on('error', reject);
    }
  });
};

export { unpackLZMA };