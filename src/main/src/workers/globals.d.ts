import type {
  AltWithData,
  AppSettings,
  SettingsObj,
  SharedSettings,
  WorkerSettings,
} from '../types';
import { WorkerScript } from './lib/workerScript';
import type { WorkerMessenger } from './lib/WorkerMessenger';

type LogTypes = 'info' | 'warning' | 'error' | 'success';

declare global {
  var id: string;

  var log: (message: unknown, type?: LogTypes) => void;
  var logCall: (args: unknown[], type?: LogTypes) => void;
  var send: (event: string, payload?: unknown) => void;
  var sendToClients: (event: string, payload?: unknown) => void;
  var settings: SettingsObj;
  var sharedSettings: SharedSettings;
  var appSettings: AppSettings;

  // var JNdata: JNdata;
  var client: WorkerScript;
  var messenger: WorkerMessenger;
  var alts: AltWithData[];
}

export {};
