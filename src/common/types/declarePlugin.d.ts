type ProxyServerConstructor = new (config?: ProxyServerConfig) => ProxyServer;
type PublicProxyPluginConstructor = new (
  connection: ProxySession,
  meta: ProxyPluginMeta,
) => ProxyPlugin;
type PacketPipelineConstructor = new () => PacketPipeline;
type PacketContextConstructor = new <
  T extends ProxyPacketData | null = ProxyPacketData,
>(options: {
  name: string;
  state: string;
  direction: PacketDirection;
  data: T;
  buffer: Uint8Array;
  unparsed?: boolean;
}) => PacketContext<T>;

declare module 'JNbot' {
  const Bot: BotConstructor;
  const BotMachine: {
    new <S extends object = Record<string, unknown>>(
      tasks?: Task<S>[],
      options?: BotMachineOptions<S>,
    ): BotMachine<S>;
  };
  /** Learned behaviour: record a player in the JNbot Client, train, run on a bot. */
  const Brain: BrainConstructor;
  /** Create a version-independent transparent Minecraft proxy. */
  const ProxyServer: ProxyServerConstructor;
  const ProxyPlugin: PublicProxyPluginConstructor;
  const ProxySession: { readonly prototype: ProxySession };
  const ProxyParticipant: { readonly prototype: ProxyParticipant };
  const PluginManager: { readonly prototype: PluginManager };
  const PacketPipeline: PacketPipelineConstructor;
  const PacketContext: PacketContextConstructor;
  const ANY_PACKET: '*';
  /** c2s packet names by purpose, for `session.grant(bot, PacketGroups.inventory)`. */
  const PacketGroups: Readonly<Record<ProxyPacketGroup, readonly string[]>>;
  const DebugPlugin: { readonly prototype: DebugPlugin };
  const RECORDINGS_PATH: string;
  /** The host-app script API. */
  const script: ScriptAPI;
  /** Create a bot from a profile and join in one call. */
  const join: (profile: BotProfile, options?: JoinOptions) => Promise<Bot>;
  export {
    Bot,
    BotMachine,
    Brain,
    ProxyServer,
    ProxyPlugin,
    ProxySession,
    ProxyParticipant,
    PluginManager,
    PacketPipeline,
    PacketContext,
    ANY_PACKET,
    PacketGroups,
    DebugPlugin,
    RECORDINGS_PATH,
    script,
    join,
  };
}

declare module 'jnbot' {
  export * from 'JNbot';
}

/** @deprecated use const {BotMachine} = require('JNbot'); instead */
declare var BotMachine: BotMachine;

/** @deprecated use `BotMachine` instead */
declare class BotStatemachine {
  bot: Bot | null;
  constructor(
    bot: Bot | null,
    behaviours: Behaviour[],
    options?: Record<string, unknown>,
  );
  get __joinServerAction(): any;
  get __joinGamemodeAction(): any;
}

/** @deprecated use `const { join } = require('JNbot');` or `Bot.join` instead */
declare const join: (
  options?: BotProfile,
  scriptOptions?: JoinOptions,
) => Promise<Bot>;
/** @deprecated import { script } from 'JNbot' instead */
declare const script: ScriptAPI;
declare const console: ConsoleAPI;
/** @deprecated use `console.log` instead */
declare function log(data: unknown, type?: 'info' | 'error' | 'warning' | 'success'): void;

// Plugins run without the DOM library, so declare the AbortSignal shape they use.
interface AbortSignal {
  readonly aborted: boolean;
  addEventListener(type: 'abort', listener: () => void): void;
}

// Timers available in the plugin sandbox.
declare function setTimeout(callback: (...args: any[]) => void, ms?: number, ...args: any[]): any;
declare function setInterval(callback: (...args: any[]) => void, ms?: number, ...args: any[]): any;
declare function setImmediate(callback: (...args: any[]) => void, ...args: any[]): any;
declare function clearTimeout(id: any): void;
declare function clearInterval(id: any): void;
declare function clearImmediate(id: any): void;
