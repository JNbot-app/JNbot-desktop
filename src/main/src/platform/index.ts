import type { PlatformAdapter } from './PlatformAdapter';
import { DesktopPlatformAdapter } from './DesktopPlatformAdapter';
import { MobilePlatformAdapter } from './MobilePlatformAdapter';
import { WebPlatformAdapter } from './WebPlatformAdapter';
import { CliPlatformAdapter } from './CliPlatformAdapter';

export * from './PlatformAdapter';
export * from './DesktopPlatformAdapter';
export * from './MobilePlatformAdapter';
export * from './WebPlatformAdapter';
export * from './CliPlatformAdapter';

let currentPlatform: PlatformAdapter | null = null;

export function getPlatform(): PlatformAdapter {
  if (currentPlatform) return currentPlatform;

  // Detect runtime environment
  if (
    process.env.JNBOT_MOBILE_RUNTIME === 'true' ||
    (global as { isMobileRuntime?: boolean }).isMobileRuntime
  ) {
    currentPlatform = new MobilePlatformAdapter();
    return currentPlatform;
  }

  if (
    typeof window !== 'undefined' &&
    typeof (window as any).process === 'undefined'
  ) {
    currentPlatform = new WebPlatformAdapter();
    return currentPlatform;
  }

  if (
    process.env.JNBOT_CLI_MODE === 'true' ||
    process.env.CLI_MODE === 'true' ||
    (global as { isCLI?: boolean }).isCLI
  ) {
    currentPlatform = new CliPlatformAdapter();
    return currentPlatform;
  }

  // Default to Desktop (Electron)
  currentPlatform = new DesktopPlatformAdapter();
  return currentPlatform;
}

export function setPlatform(adapter: PlatformAdapter | null): void {
  currentPlatform = adapter;
}
