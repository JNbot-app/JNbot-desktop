import { ErrorHandler } from '../types';
import ScriptHandler_ from './ScriptHandler';
import { backendMessaging } from '../messaging';
import { getPlatform } from '../platform';
import { logText } from '../../../common/logText';

const isDevelopment =
  process.env.NODE_ENV === 'development' || process.env.DEBUG_PROD === 'true';

export type ErrorReporter = (
  error: Error,
  context: { user: string; tags: Record<string, string>; logs: string },
) => void;

function getPlatformLabel(): string {
  try {
    const platform = getPlatform().platform;
    if (platform === 'mobile') return 'Mobile';
    if (platform === 'cli') return 'CLI';
    if (platform === 'web') return 'Web';
    return 'Desktop';
  } catch {
    if (
      process.env.JNBOT_MOBILE_RUNTIME === 'true' ||
      (global as { isMobileRuntime?: boolean }).isMobileRuntime
    ) {
      return 'Mobile';
    }
    if (
      process.env.JNBOT_CLI_MODE === 'true' ||
      process.env.CLI_MODE === 'true' ||
      (global as { isCLI?: boolean }).isCLI
    ) {
      return 'CLI';
    }
    return 'Desktop';
  }
}

class ErrorHandler_ implements ErrorHandler {
  UID: string;
  scriptHandler!: ScriptHandler_;
  private reporter?: ErrorReporter;

  constructor(UID: string) {
    this.UID = UID;
  }

  setScriptHandler(handler: ScriptHandler_) {
    this.scriptHandler = handler;
  }

  setReporter(reporter: ErrorReporter) {
    this.reporter = reporter;
  }

  handle(
    err: { message: string; stack: string | undefined; script: string },
    profileId?: number,
  ) {
    if (isDevelopment) {
      console.error(err);
      return console.error(
        "Received error but didn't handle it because I'm dev mode.",
      );
    }

    if (typeof err.message === 'object')
      err.message = JSON.stringify(err.message);
    if (typeof err.stack === 'object') err.stack = JSON.stringify(err.stack);
    if (err.message?.includes?.('ioreg -rd1 -c IOPlatformExpertDevice')) {
      const payload = {
        title: 'Something went wrong, please restart the JNbot',
        variant: 'error',
      };
      const notification = {
        title: 'Restart app',
        type: 'error',
        message:
          "Something went wrong while installing the new version, but don't worry, restarting the app will fix it!",
      };
      if (profileId) {
        backendMessaging.messenger.publishToProfile(
          profileId,
          'snackbar',
          payload,
        );
        backendMessaging.messenger.publishToProfile(
          profileId,
          'notification',
          notification,
        );
      } else {
        global.send('snackbar', payload);
        global.send('notification', notification);
      }
      return;
    }

    let logs = 'Error happened during initializing';
    let server = 'unknown';
    if (this.scriptHandler) {
      const runtime = profileId
        ? this.scriptHandler.getRuntime(profileId)
        : undefined;
      server =
        runtime?.profileKey ??
        this.scriptHandler.settings?.bootstrapProfileKey ??
        'unknown';
      if (err.script) {
        const console_ = (
          runtime ??
          this.scriptHandler.getRuntimeByKey(
            this.scriptHandler.settings?.bootstrapProfileKey,
          )
        )?.consoleHandler?.getConsole();
        if (console_) {
          logs =
            console_
              .slice(-5)
              .map((c) => logText(c[0]))
              .join('\n')
              .slice(-1023) || 'Logs are empty';
        } else {
          logs = 'Console logs not found';
        }
      } else {
        logs = '*No logs*';
      }
    }
    const error = new Error(err.message || 'Unknown error');
    error.stack = err.stack;
    this.reporter?.(error, {
      user: this.UID,
      logs,
      tags: {
        platform: getPlatformLabel(),
        script: err.script || 'None',
        server,
        mcVersion: profileId
          ? this.scriptHandler?.settings?.getProfileAppSettings(
              this.scriptHandler?.getRuntime(profileId)?.profileKey,
            )?.version || 'unknown'
          : global.appSettings?.version || 'unknown',
      },
    });
  }

  public async askToSubmitCrashReport(options: {
    name: string;
    errorMessage: string;
    errorStack?: string;
  }) {
    // Show user-friendly error with option to submit
    const buttons = await this.scriptHandler.clientEvents.BUTTON_POPUP({
      title: options.name,
      body: `An error occurred:\n\n${options.errorMessage}\n\nWould you like to submit this error report to help improve JNbot?`,
      buttons: [
        { label: 'Submit Error Report', id: 'submit' },
        { label: 'Close', id: 'close' },
      ],
    });

    // If user chooses to submit the error
    if (buttons === 'submit') {
      this.handle({
        message: `Minecraft Launch Failed: ${options.errorMessage}`,
        stack: options.errorStack,
        script: options.name,
      });

      global.send('snackbar', {
        title: 'Error report submitted. Thank you!',
        variant: 'success',
      });
    }
  }
}

export default ErrorHandler_;
