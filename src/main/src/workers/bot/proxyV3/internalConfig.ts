import type {
  ProxyServerConfig,
  ProxyStateProvider,
} from '../../../../../common/types/proxyApi';

/** Internal handoff between the bot tracker and a ProxyServer instance. */
export interface ProxyInternalConfig {
  /** Bots in another worker: authenticate their token and capture through the app. */
  resolveBotStateProvider?: (
    botId: number,
    token: string,
  ) => ProxyStateProvider | undefined | Promise<ProxyStateProvider | undefined>;
}

export type ProxyRuntimeConfig = ProxyServerConfig & ProxyInternalConfig;
