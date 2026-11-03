import { AppSettings, JNdata, ServerTypes } from '../main/src/types';
import PeerSocket from './extra/peer2peer/PeerSocket';
import type {
  Address,
  BroadcastTarget,
  MessageContext,
  ProfilePublication,
} from '../common/messaging';
import type {
  IpcActionArgs,
  IpcActionName,
  IpcActionResult,
} from '../common/ipcEvents';

export {};

declare global {
  const __REACT_SCAN_ENABLED__: boolean;
  const __SENTRY_DIAGNOSTICS_ENABLED__: boolean;
  interface Window {
    MonacoEnvironment?: import('monaco-editor').Environment;
    messenger: {
      address: Address;
      send: (event: string, id: Address, data?: unknown) => void;
      sendAsync: (event: string, id: Address, data?: unknown) => Promise<void>;
      request: <T = unknown>(
        event: string,
        id: Address,
        data?: unknown,
      ) => Promise<T>;
      pub: (
        event: string,
        id: Address | BroadcastTarget,
        data?: unknown,
      ) => void;
      sub: (
        event: string,
        id: Address | BroadcastTarget,
        handler: (data: unknown, context: MessageContext) => unknown,
      ) => () => void;
      sendToBackend: (event: string, data?: unknown) => void;
      sendToScript: (
        profileId: number,
        scriptId: number,
        event: string,
        data?: unknown,
      ) => void;
      sendToBot: (
        profileId: number,
        scriptId: number,
        botId: number,
        event: string,
        data?: unknown,
      ) => void;
      action: (event: string, data?: unknown) => void;
      get: <T = unknown>(event: string, data?: unknown) => Promise<T>;
      watchProfile: (
        profileKey: string,
        handler: (publication: ProfilePublication) => unknown,
      ) => Promise<any>;
      profileAction: (profileId: number, event: string, data?: unknown) => void;
      profileRequest: <T = unknown>(
        profileId: number,
        event: string,
        data?: unknown,
      ) => Promise<T>;
    };
    ipcRenderer: {
      send: (channel: string, ...args: any[]) => void;
      on: (channel: string, listener: (...args: any[]) => void) => () => void;
      once: (channel: string, listener: (...args: any[]) => void) => () => void;
      get: {
        <Channel extends IpcActionName>(
          channel: Channel,
          ...args: IpcActionArgs<Channel>
        ): Promise<IpcActionResult<Channel>>;
        <T>(channel: string, ...args: unknown[]): Promise<T>;
      };
      getPathForFile?: (file: File) => string;
      invoke: <T>(channel: string, ...args: any[]) => Promise<T>;
      action: <Channel extends IpcActionName>(
        channel: Channel,
        ...args: IpcActionArgs<Channel>
      ) => void;
      removeAllListeners: (channel: string) => void;
      removeListener: (
        channel: string,
        listener: (...args: any[]) => void,
      ) => void;
      connect?: PeerSocket['connect'];
      webRTC?: PeerSocket['webRTC'];
      setSnackbar?: PeerSocket['setSnackbar'];
      setLoadingScreen?: PeerSocket['setLoadingScreen'];
      UID?: string;
    };
    __JNdata: JNdata;
    v4guardWindow: [Window, NodeJS.Timeout, string] | null;
    web: boolean;
    peering: boolean;
    platform: NodeJS.Platform;
  }
}
