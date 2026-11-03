import type ClientEvents from '../main/src/functions/ClientEvents';

export interface IpcEvent<Payload, Response = void> {
  payload: Payload;
  response: Response;
}

type ClientActionName = Extract<
  keyof ClientEvents,
  Uppercase<keyof ClientEvents & string>
>;

type FirstParameter<Parameters extends readonly unknown[]> =
  Parameters extends [] ? undefined : Parameters[0];

type ClientActionEvent<Name extends ClientActionName> = IpcEvent<
  FirstParameter<Parameters<ClientEvents[Name]>>,
  Awaited<ReturnType<ClientEvents[Name]>>
>;

/**
 * Automatically map every uppercase ClientEvents method to its ClientActionEvent.
 */
type AutoIpcActionMap = {
  [K in ClientActionName]: ClientActionEvent<K>;
};

/**
 * Add any custom overrides/exceptions here (e.g. actions with non-standard signatures).
 */
type IpcActionOverrides = {
  PING: IpcEvent<[event: string, data?: unknown]>;
};

export type IpcActionMap = Omit<AutoIpcActionMap, keyof IpcActionOverrides> &
  IpcActionOverrides;

export type IpcActionName = keyof IpcActionMap;

export type IpcActionArgs<Name extends IpcActionName> = [
  IpcActionMap[Name]['payload'],
] extends [undefined]
  ? []
  : undefined extends IpcActionMap[Name]['payload']
    ? [payload?: IpcActionMap[Name]['payload']]
    : [payload: IpcActionMap[Name]['payload']];

export type IpcActionResult<Name extends IpcActionName> =
  IpcActionMap[Name]['response'];