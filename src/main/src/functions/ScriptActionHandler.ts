import { ActiveAction } from '../types';
import { backendMessaging } from '../messaging';

class ScriptActionHandler {
  activeActions: Record<number, ActiveAction[]> = {};
  private readonly profileId: number;

  constructor(profileId: number) {
    this.profileId = profileId;
  }

  startAction(
    action: string,
    { instanceId, actionId }: { instanceId: number; actionId: string },
  ) {
    (this.activeActions[instanceId] ??= []).push({
      action,
      instanceId,
      actionId,
    });
    this.send();
  }

  removeAction(actionId: string, instanceId: number) {
    if (instanceId in this.activeActions) {
      this.activeActions[instanceId] = this.activeActions[instanceId].filter(
        (a) => a.actionId !== actionId,
      );
      if (this.activeActions[instanceId].length === 0)
        delete this.activeActions[instanceId];
      this.send();
    }
  }

  quitScript(instanceId: number) {
    if (instanceId in this.activeActions) {
      delete this.activeActions[instanceId];
      this.send();
    }
  }

  send() {
    backendMessaging.messenger.publishToProfile(
      this.profileId,
      'ACTIVE_ACTION_SCRIPT',
      this.activeActions,
    );
  }
}

export default ScriptActionHandler;
