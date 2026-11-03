import type {
  AutomationDocument,
  AutomationReplayOptions,
  AutomationSessionStatus,
  AutomationSummary,
} from '../../../../common/automation';
import type { Bot } from '../workerTypes';
import type WorkerMcClient from './WorkerMcClient';
import workerScript from './workerScript';
import { controlBotAutomation, startBotAutomation } from '../bot/automation';

type SessionAction = 'pause' | 'resume' | 'stop';

class WorkerAutomationHandle {
  readonly done: Promise<AutomationSessionStatus>;

  constructor(
    readonly id: string,
    private readonly controlFn: (action: SessionAction) => Promise<unknown>,
  ) {
    this.done = this.waitUntilDone();
  }

  pause(): Promise<unknown> {
    return this.controlFn('pause');
  }

  resume(): Promise<unknown> {
    return this.controlFn('resume');
  }

  stop(): Promise<unknown> {
    return this.controlFn('stop');
  }

  private async waitUntilDone(): Promise<AutomationSessionStatus> {
    while (true) {
      const status =
        await workerScript.sendAsync<AutomationSessionStatus | null>(
          'GET_AUTOMATION_SESSION',
          this.id,
        );
      if (
        status &&
        (status.state === 'completed' || status.state === 'stopped')
      )
        return status;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
}

export default class WorkerAutomationApi {
  list(): Promise<AutomationSummary[]> {
    return workerScript.sendAsync('GET_AUTOMATIONS');
  }

  get(id: string): Promise<AutomationDocument> {
    return workerScript.sendAsync('GET_AUTOMATION', id);
  }

  async record(
    client: WorkerMcClient,
    options: { pluginId?: string; name?: string } = {},
  ): Promise<WorkerAutomationHandle> {
    if (!client || typeof client.id !== 'string')
      throw new TypeError('automations.record requires a Minecraft client');
    const status = await workerScript.sendAsync<AutomationSessionStatus>(
      'START_AUTOMATION_RECORDING',
      {
        clientId: client.id,
        pluginId: options.pluginId,
        name: options.name,
      },
    );
    return new WorkerAutomationHandle(status.sessionId, (action) =>
      workerScript.sendAsync('CONTROL_AUTOMATION_SESSION', {
        sessionId: status.sessionId,
        action,
      }),
    );
  }

  async replay(
    target: Bot | WorkerMcClient,
    idOrDocument: string | AutomationDocument,
    options: AutomationReplayOptions,
  ): Promise<WorkerAutomationHandle> {
    if (!options?.spatialMode) throw new TypeError('spatialMode is required');
    if ('botId' in target) {
      const document =
        typeof idOrDocument === 'string'
          ? await this.get(idOrDocument)
          : idOrDocument;
      const status = startBotAutomation(target, { document, options });
      return new WorkerAutomationHandle(status.sessionId, (action) =>
        controlBotAutomation(target, { sessionId: status.sessionId, action }),
      );
    }
    if (!target || typeof target.id !== 'string')
      throw new TypeError(
        'Automation replay target must be a bot or Minecraft client',
      );
    const status = await workerScript.sendAsync<AutomationSessionStatus>(
      'START_AUTOMATION_CLIENT_REPLAY',
      {
        clientId: target.id,
        automation: idOrDocument,
        options,
      },
    );
    return new WorkerAutomationHandle(status.sessionId, (action) =>
      workerScript.sendAsync('CONTROL_AUTOMATION_SESSION', {
        sessionId: status.sessionId,
        action,
      }),
    );
  }
}
