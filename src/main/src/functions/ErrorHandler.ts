import axios from 'axios';
import { app } from 'electron';
import { ErrorHandler } from '../types';
import ScriptHandler_ from './ScriptHandler';
import { backendMessaging } from '../messaging';
import { getPlatform } from '../platform';
import { logText } from '../../../common/logText';

const isDevelopment =
  process.env.NODE_ENV === 'development' || process.env.DEBUG_PROD === 'true';

// function obfuscate(str: string): string  {
//   return str.split('').map(char => char.charCodeAt(0).toString(16)).join('');
// };

function deobfuscate(str: string): string {
  return (
    str
      .match(/.{1,2}/g)
      ?.map((byte) => String.fromCharCode(parseInt(byte, 16)))
      .join('') || ''
  );
}

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

const webhookUrl = deobfuscate(
  '68747470733a2f2f646973636f72642e636f6d2f6170692f776562686f6f6b732f3935313938323035393035393034383532382f6f653953415639456559325242524954455a735a345477707062446d786878614f43386168346364615a497a775965384d633334524a476e38457a545253526967456645',
);

class ErrorHandler_ implements ErrorHandler {
  UID: string;
  scriptHandler!: ScriptHandler_;

  constructor(UID: string) {
    this.UID = UID;
  }

  setScriptHandler(handler: ScriptHandler_) {
    this.scriptHandler = handler;
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
    const platform = getPlatformLabel();
    const body = {
      content: null,
      embeds: [
        {
          title: (err?.message || '')?.slice?.(0, 255),
          description: err.stack && err.stack?.slice(0, 4095),
          color: null,
          author: {
            name: this.UID?.slice(0, 255),
          },
          footer: {
            text: `JNbot error support • ${platform}`,
          },
          fields: [
            {
              name: 'Platform',
              value: platform,
            },
            {
              name: 'Version',
              value: app?.getVersion ? app.getVersion() : 'unknown',
            },
            {
              name: 'Active script',
              value: err.script || 'None',
            },
            {
              name: 'Server',
              value: server,
            },
            {
              name: 'MC version',
              value: profileId
                ? this.scriptHandler?.settings?.getProfileAppSettings(
                    this.scriptHandler?.getRuntime(profileId)?.profileKey,
                  )?.version || 'unknown'
                : global.appSettings?.version || 'unknown',
            },
            {
              name: 'Logs',
              value: logs,
            },
          ],
          timestamp: new Date(),
        },
      ],
    };

    // send the errors to the discord webhook
    axios.post(webhookUrl, body).catch(console.error);
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
