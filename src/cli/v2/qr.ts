// @ts-expect-error qrcode-terminal vendor has no separate typings
import QRCode from 'qrcode-terminal/vendor/QRCode';
// @ts-expect-error qrcode-terminal vendor has no separate typings
import QRErrorCorrectLevel from 'qrcode-terminal/vendor/QRCode/QRErrorCorrectLevel';

const QR_QUIET_ZONE_MODULES = 4;

export function getRawQrGrid(
  text: string,
  border = QR_QUIET_ZONE_MODULES,
): boolean[][] {
  if (!text) return [];
  try {
    const qr = new QRCode(-1, QRErrorCorrectLevel.L);
    qr.addData(text);
    qr.make();

    const moduleCount: number = qr.getModuleCount();
    const modules: boolean[][] = qr.modules;
    const fullSize = moduleCount + border * 2;

    return Array.from({ length: fullSize }, (_, y) =>
      Array.from({ length: fullSize }, (_, x) => {
        const my = y - border;
        const mx = x - border;
        if (my >= 0 && my < moduleCount && mx >= 0 && mx < moduleCount) {
          return Boolean(modules[my][mx]);
        }
        return false;
      }),
    );
  } catch {
    return [];
  }
}

/**
 * Returns plain uncolored lines using double-width blocks. Terminal line-height
 * can clip half-block characters, which corrupts QR rows in some terminals.
 */
export function generateTerminalQrLines(
  text: string,
  border = QR_QUIET_ZONE_MODULES,
): string[] {
  const grid = getRawQrGrid(text, border);
  if (!grid.length) return [];

  return grid.map((row) =>
    row.map((module) => (module ? '██' : '  ')).join(''),
  );
}

/**
 * Returns full ANSI-colored string with white background and black text
 * for direct stdout printing in CLI commands.
 */
export function generateTerminalQr(
  text: string,
  border = QR_QUIET_ZONE_MODULES,
): string {
  const lines = generateTerminalQrLines(text, border);
  if (!lines.length) return '';
  return lines.map((line) => `\x1b[47m\x1b[30m${line}\x1b[0m`).join('\n');
}
