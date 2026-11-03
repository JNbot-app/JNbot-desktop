import { FullLogMessage, LogMessage } from '../types';
import fs from 'fs';
import path from 'path';
import type { AppSettings } from '../types';
import CircularBuffer from '../../../common/CircularBuffer';
import axios from 'axios';
import { LogStatus } from 'common/CommonEnums';
import { logText } from '../../../common/logText';

const MAX_LENGTH = 1000;
const MAX_PENDING_FILE_BYTES = 256 * 1024;

// ANSI SGR helper and color codes (use '2;' for dim + color where supported)
const RESET = '\u001b[0m';
const sgr = (dim: boolean, code: number) => `\u001b[${dim ? '2;' : ''}${code}m`;
const TIME_DIM = sgr(true, 30); // dim gray
const CYAN = sgr(true, 36);
const YELLOW = sgr(true, 33);
const RED = sgr(false, 31);
const GREEN = sgr(true, 32);

class Console {
  messages: CircularBuffer<FullLogMessage>;
  stream: fs.WriteStream | null;
  private streamPath: string | null = null;
  private droppedFileLogs = 0;

  private webhookTimeout: NodeJS.Timeout | null = null;
  private webhookQueue: FullLogMessage[] = [];

  constructor(private readonly getAppSettings: () => AppSettings) {
    this.messages = new CircularBuffer(MAX_LENGTH);
    this.stream = null;
  }

  log(
    messages: LogMessage[],
    scriptID: string,
    scriptName: string,
  ): FullLogMessage[] {
    const newMsgs: FullLogMessage[] = messages.map((msg) => {
      const message: FullLogMessage = [
        msg[0],
        msg[1],
        scriptName,
        scriptID,
        Date.now(),
      ];
      this.writeStream(msg[0], scriptID);
      this.sendToWebhook(message);
      return message;
    });
    this.messages.pushAll(newMsgs);
    return newMsgs;
  }

  get(limit: number = 100): FullLogMessage[] {
    return this.messages.get(limit);
  }

  toList() {
    return this.messages.toArray();
  }

  sendToWebhook(message: FullLogMessage) {
    const webhook = this.getAppSettings().logs_webhook;
    if (!webhook?.length) return;
    this.webhookQueue.push(message);
    if (this.webhookQueue.length > 200) this.webhookQueue.shift();
    if (this.webhookTimeout !== null) return;

    this.webhookTimeout = setTimeout(async () => {
      this.webhookTimeout = null;
      const content = this.webhookQueue
        .map((m) => {
          const raw = logText(m[0]);
          const time = `${TIME_DIM}[${new Date(m[4]).toLocaleTimeString()}]${RESET}`;
          const name = `${CYAN}[${m[2]}]${RESET}`;
          const level = m[1];
          let body = raw;
          if (level === LogStatus.ERROR) {
            body = `${RED}${raw}${RESET}`;
          } else if (level === LogStatus.WARN) {
            body = `${YELLOW}${raw}${RESET}`;
          } else if (level === LogStatus.SUCCESS) {
            body = `${GREEN}${raw}${RESET}`;
          }

          return `${time} ${name} ${body}`;
        })
        .join('\n');
      const message =
        '```ansi\n' +
        (content.length > 4050
          ? content.slice(content.length - 4050)
          : content) +
        '\n```';
      this.webhookQueue = [];
      try {
        await axios.post(webhook, {
          content: null,
          username: 'JNbot',
          avatar_url: 'https://i.ibb.co/Hf3Z3Z5d/icon.png',
          embeds: [
            {
              description: message,
              color: 0xfeca2d,

              footer: {
                text: 'Powered by JNbot',
                icon_url: 'https://i.ibb.co/Hf3Z3Z5d/icon.png',
              },
              timestamp: new Date(),
            },
          ],
        });
      } catch (err) {
        console.error(err);
      }
    }, 5000);
  }

  writeStream(msg: LogMessage[0], scriptID: string) {
    const appSettings = this.getAppSettings();
    const logDir = appSettings.logging_dir;
    if (!appSettings.script_console_logging || !logDir) {
      this.closeStream();
      return;
    }
    const filePath = path.join(
      logDir,
      `${new Date().toLocaleDateString().replace(/[^0-9]/g, '-')}.log`,
    );
    if (this.streamPath !== filePath || !this.stream || this.stream.writableEnded) {
      this.openStream(filePath);
    }
    if (!this.stream) return;
    if (this.stream.writableLength >= MAX_PENDING_FILE_BYTES) {
      this.droppedFileLogs++;
      return;
    }
    try {
      if (this.droppedFileLogs) {
        this.stream.write(`[${this.droppedFileLogs} file log entries omitted]\n`);
        this.droppedFileLogs = 0;
      }
      const text = logText(msg);
      this.stream?.write(
        `[${scriptID}] [${new Date().toISOString()}] ${text.replace(/\u001b\[.*?m/g, '')}\n`,
      );
    } catch (err) {
      console.error('Failed writing to log stream:', err);
    }
  }

  private openStream(filePath: string) {
    this.closeStream();
    try {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      const stream = fs.createWriteStream(filePath, { flags: 'a' });
      stream.on('error', (err) => {
        console.error('Log stream error:', err);
        if (this.stream === stream) {
          this.stream = null;
          this.streamPath = null;
        }
      });
      stream.on('drain', () => {
        if (this.stream === stream && this.droppedFileLogs) {
          stream.write(`[${this.droppedFileLogs} file log entries omitted]\n`);
          this.droppedFileLogs = 0;
        }
      });
      this.stream = stream;
      this.streamPath = filePath;
    } catch (err) {
      console.error('Failed to open console log stream:', err);
      this.stream = null;
    }
  }

  closeStream(): Promise<void> {
    const stream = this.stream;
    if (stream && this.droppedFileLogs)
      stream.write(`[${this.droppedFileLogs} file log entries omitted]\n`);
    this.droppedFileLogs = 0;
    this.stream = null;
    this.streamPath = null;
    if (stream && !stream.writableEnded) {
      return new Promise<void>((resolve) => {
        stream.end(() => resolve());
      });
    }
    return Promise.resolve();
  }

  clear(scriptName: string | undefined) {
    if (!scriptName) {
      this.messages.clear();
    } else {
      const filtered = this.messages.filter((log) => log[2] !== scriptName);
      this.messages = CircularBuffer.fromArray(filtered, MAX_LENGTH);
    }
  }
}

export default Console;
