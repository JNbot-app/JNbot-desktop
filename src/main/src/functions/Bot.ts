import EventEmitter from 'node:events';
import { ActiveBotsType, BotInfo } from '../types';
import Script_ from './Script';
import { workerBotAddress } from '../../../common/messaging';
import { backendMessaging } from '../messaging';

type BotInventoryItem = {
  display: { name: string; lore: string };
  name: string;
  count: number;
  displayName: string;
};

type BotInventoryType = {
  items: (BotInventoryItem | null)[];
  isInventory: boolean;
  title: string | null;
  inventoryStart: number;
  selected: number;
  selectedItem: BotInventoryItem | null;
};

class Bot_ {
  botInfo: BotInfo;
  joinedAt: number = Date.now();
  script: Script_;
  proxyControlToken?: string;
  constructor(botInfo: BotInfo, script: Script_) {
    this.botInfo = botInfo;
    this.script = script;
  }

  toObject(): ActiveBotsType[number] {
    return {
      ...this.botInfo,
      SCRIPT_NAME: this.script.name,
      INSTANCE_ID: this.script.id,
      SCRIPT_ID: this.script.scriptId,
      PLUGIN_ID: this.script.pluginId,
      RUNTIME_PROFILE_ID: this.script.runtimeProfileId,
      RUNTIME_SCRIPT_ID: this.script.runtimeScriptId,
      MESSAGE_ADDRESS: workerBotAddress(
        this.script.runtimeProfileId,
        this.script.runtimeScriptId,
        this.botInfo.botId,
      ),
    };
  }

  send(event: string, data?: any) {
    backendMessaging.messenger.send(
      event,
      workerBotAddress(
        this.script.runtimeProfileId,
        this.script.runtimeScriptId,
        this.botInfo.botId,
      ),
      data,
    );
  }

  runAction(
    action: string,
    data?: any,
    expectReturnValue?: EventEmitter,
  ): Promise<any> | void {
    if (expectReturnValue) {
      return backendMessaging.messenger.request(
        'BOT_ACTION',
        workerBotAddress(
          this.script.runtimeProfileId,
          this.script.runtimeScriptId,
          this.botInfo.botId,
        ),
        { action, data: [data] },
      );
    } else {
      this.send('BOT_ACTION', { action, data });
    }
  }

  requestAction(action: string, data?: any): Promise<any> {
    return backendMessaging.messenger.request(
      'BOT_ACTION',
      workerBotAddress(
        this.script.runtimeProfileId,
        this.script.runtimeScriptId,
        this.botInfo.botId,
      ),
      { action, data: [data] },
    );
  }

  toString() {
    const { username, version, uuid, host, port, botId } = this.botInfo;
    return `Bot(username="${username}", botId="${botId}", script="${this.script.name}", script_id="${this.script.id}", version="${version}", uuid="${uuid || ''}", host="${host}", port=${port})`;
  }

  disconnect() {
    this.runAction('leave');
  }

  clickWindow(slot: number, button = 0, mode = 0) {
    this.runAction('inventoryClick', { slot, button, mode });
  }

  login() {
    this.runAction('login');
  }

  subscribe(
    event: string,
    emitter: EventEmitter /* for example the ClientMock class */,
    callback: (data: any) => void,
  ) {
    this.runAction('activate');
    const cb = (actionData: {
      action: string;
      username: string;
      botId: number;
      data: any;
      options?: { caching?: boolean };
      returnValue?: string;
    }) => {
      if (actionData.botId !== this.botInfo.botId) return;
      if (actionData.action === event) {
        callback(actionData.data);
      }
    };
    emitter.on('bot-action', cb);
    return () => {
      // Unsubscribe

      this.runAction('deactivate');
      emitter.off('bot-action', cb);
    };
  }

  requestChat() {
    this.runAction('chatPacket');
  }

  chat(message: string) {
    this.runAction('chatMessage', message);
  }

  getInventory(emitter: EventEmitter): Promise<BotInventoryType> {
    return this.runAction(
      'sendInventoryPacket',
      undefined,
      emitter,
    ) as Promise<BotInventoryType>;
  }

  closeWindow() {
    this.runAction('closeWindow');
  }

  joinGamemode(gamemode: string) {
    this.runAction('joinGamemode', gamemode);
  }

  activateItem() {
    this.runAction('activateItem');
  }

  respawn() {
    this.runAction('respawn');
  }
}

export default Bot_;
