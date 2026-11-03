import { useCallback, useEffect, useState } from 'react';
import { Col, Flex, Row, theme } from 'antd';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  isRecordingSession,
  type AutomationPlayMode,
  type AutomationStep,
  type AutomationTargetDescriptor,
} from '../../common/automation';
import { RECORDING_BRAIN_STEP_MS } from '../../common/brainSpec';
import type { MacroInfo } from '../../main/src/types';
import useAppApi from '../hooks/useAppApi';
import {
  savePlugin,
  selectActiveBots,
  useSettingsStore,
} from '../redux/settings';
import {
  controlAutomationSession,
  useActiveAutomationSession,
} from '../redux/automationSessions';
import { usePanelContext } from '../components/other/botSideBar/SidePanelContextProvider';
import PluginSettingsModal from '../components/codeEditor/PluginSettingsModal';
import { MacroInfoValidator } from '../validators/MacroValidator';
import RecordingHeader from '../components/automations/RecordingHeader';
import RecordingGetStarted from '../components/automations/RecordingGetStarted';
import TakesCard from '../components/automations/TakesCard';
import ReplayStepsCard from '../components/automations/ReplayStepsCard';
import RunCard from '../components/automations/RunCard';
import AiRun from '../components/automations/teach/AiRun';
import useRecordingDocument from '../components/automations/hooks/useRecordingDocument';
import useBrainInfo from '../components/automations/hooks/useBrainInfo';
import {
  clock,
  newStep,
  type EditableKind,
} from '../components/automations/automationUtils';

/** A recording plugin: record takes, then replay one exactly or let the AI learn from all of them. */
export default function AutomationEditor() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { message } = useAppApi();
  const { setPanel } = usePanelContext();
  const { token } = theme.useToken();

  const activeBots = useSettingsStore(selectActiveBots);
  const profileId = useSettingsStore((state) => state.selectedProfileId);
  const session = useActiveAutomationSession(id);
  const [editingPlugin, setEditingPlugin] = useState(false);
  const { plugin, setPlugin, document, mutate, reload } = useRecordingDocument(id);
  const {
    info,
    training,
    reload: reloadInfo,
  } = useBrainInfo(document ? id : undefined, document?.learn);

  const client = activeBots.find(
    (target) => target.origin === 'minecraft' && target.status === 'connected',
  );
  const targets = activeBots.filter((target) => target.status === 'connected');
  const hasBot = targets.some((target) => target.origin !== 'minecraft');

  const request = useCallback(
    async <T,>(event: string, data: unknown) => {
      try {
        return await window.ipcRenderer.get<T>(event, data);
      } catch (error) {
        message.error(error instanceof Error ? error.message : String(error));
        return undefined;
      }
    },
    [message],
  );

  const handleRecord = useCallback(() => {
    if (client)
      void request('START_AUTOMATION_RECORDING', {
        clientId: String(client.id),
        pluginId: id,
      });
  }, [client, id, request]);

  const handleReplay = useCallback(
    async (requestedMode?: AutomationPlayMode) => {
      if (!id) return;
      const pluginOptions =
        useSettingsStore.getState().settings.scripts?.[id] ?? {};
      const mode =
        requestedMode ??
        (pluginOptions.playMode as AutomationPlayMode) ??
        'exact';
      // the AI drives bots only
      const candidates =
        mode === 'ai'
          ? targets.filter((candidate) => candidate.origin !== 'minecraft')
          : targets;
      const rawAccount = pluginOptions.account;
      const configuredAccount = Array.isArray(rawAccount)
        ? rawAccount[0]
        : (rawAccount as string | undefined);
      const target =
        (configuredAccount &&
          candidates.find(
            (candidate) => candidate.username === configuredAccount,
          )) ||
        candidates[0];

      if (!target) {
        message.error(
          mode === 'ai'
            ? 'Play with AI needs a connected bot. Connect a bot first.'
            : 'Connect a bot or Minecraft client to replay on.',
        );
        return;
      }

      const descriptor: AutomationTargetDescriptor =
        target.origin === 'minecraft'
          ? { kind: 'minecraft', id: target.id, username: target.username }
          : {
              kind: 'bot',
              id: target.botId,
              username: target.username,
              profileId: target.RUNTIME_PROFILE_ID ?? profileId ?? undefined,
            };

      await request('START_AUTOMATION_REPLAY', {
        automationId: id,
        target: descriptor,
        options: {
          spatialMode:
            (pluginOptions.spatialMode as 'relative' | 'absolute') ||
            'absolute',
          inputs: pluginOptions,
          mode,
        },
      });
    },
    [id, message, profileId, request, targets],
  );

  // "Run" from the plugins page lands here
  useEffect(() => {
    if (!document || searchParams.get('replay') !== '1') return;
    setSearchParams({}, { replace: true });
    void handleReplay();
  }, [document, handleReplay, searchParams, setSearchParams]);

  const handleOpenOptions = useCallback(() => {
    if (plugin)
      setPanel({
        active: true,
        tab: 'plugin',
        data: { plugin, view: 'options' },
      });
  }, [plugin, setPanel]);

  const handleSavePlugin = useCallback(
    (updated: MacroInfo) => {
      if (MacroInfoValidator(updated.name, updated.description)) return;
      savePlugin(updated);
      setPlugin(updated);
      window.localStorage.removeItem('macros_cache');
    },
    [setPlugin],
  );

  const handleControl = useCallback(
    (action: 'pause' | 'resume' | 'stop') => {
      if (session) void controlAutomationSession(session, action);
    },
    [session],
  );

  const handleUpdateStep = useCallback(
    (stepId: string, patch: Partial<AutomationStep>) =>
      mutate((draft) => {
        const index = draft.steps.findIndex((step) => step.id === stepId);
        if (index >= 0)
          draft.steps[index] = {
            ...draft.steps[index],
            ...patch,
          } as AutomationStep;
        draft.steps.sort((left, right) => left.atMs - right.atMs);
      }),
    [mutate],
  );

  const handleDeleteStep = useCallback(
    (stepId: string) =>
      mutate((draft) => {
        draft.steps = draft.steps.filter((step) => step.id !== stepId);
      }),
    [mutate],
  );

  const handleAddStep = useCallback(
    (kind: EditableKind) => {
      const step = newStep(kind, document?.steps.at(-1)?.atMs ?? 0);
      mutate((draft) => {
        draft.steps.push(step);
      });
      return step.id;
    },
    [document, mutate],
  );

  if (!id || !document || !info) return null;

  const takes = info.examples;
  const replayIndex = takes.findIndex(
    (take) => take.file === document.replayTake,
  );
  const takeLabel = replayIndex >= 0 ? `Take ${replayIndex + 1}` : undefined;
  const recording =
    session && isRecordingSession(session) ? session : undefined;
  const running = session && !recording ? session : undefined;
  const recordedMs =
    takes.reduce((n, take) => n + take.steps, 0) * RECORDING_BRAIN_STEP_MS;

  return (
    <Flex
      vertical
      gap={token.marginLG}
      style={{ width: '100%', paddingBottom: token.marginLG }}
    >
      <RecordingHeader
        title={plugin?.name ?? document.name}
        summary={
          takes.length
            ? `${takes.length} ${takes.length === 1 ? 'take' : 'takes'} · ${clock(recordedMs)} recorded`
            : `${document.steps.length} replay steps`
        }
        clientName={client?.username}
        recording={recording}
        busy={!!running}
        onBack={() => navigate('/plugins')}
        onOptions={handleOpenOptions}
        onEditPlugin={() => setEditingPlugin(true)}
        onRecord={handleRecord}
        onOpenLauncher={() => navigate('/launcher')}
        onControl={handleControl}
      />

      {!takes.length && !document.steps.length && !session ? (
        <RecordingGetStarted
          clientName={client?.username}
          onRecord={handleRecord}
          onOpenLauncher={() => navigate('/launcher')}
        />
      ) : (
        <Row gutter={[token.marginLG, token.marginLG]}>
          <Col xs={24} xl={15} xxl={16}>
            <Flex vertical gap={token.marginLG}>
              <TakesCard
                takes={takes}
                replayTake={document.replayTake}
                onUse={async (file) => {
                  if (
                    await request('USE_AUTOMATION_TAKE', { pluginId: id, file })
                  )
                    void reload();
                }}
                onDelete={async (file) => {
                  await request('DELETE_BRAIN_EXAMPLE', { pluginId: id, file });
                  void reloadInfo();
                }}
              />
              <ReplayStepsCard
                steps={document.steps}
                durationMs={document.durationMs}
                takeLabel={takeLabel}
                onUpdate={handleUpdateStep}
                onDelete={handleDeleteStep}
                onAdd={handleAddStep}
              />
            </Flex>
          </Col>
          <Col xs={24} xl={9} xxl={8}>
            <RunCard
              session={running}
              hasSteps={document.steps.length > 0}
              takeLabel={takeLabel}
              onReplay={() => void handleReplay('exact')}
              onControl={handleControl}
              ai={
                <AiRun
                  pluginId={id}
                  info={info}
                  training={training}
                  learn={document.learn}
                  onLearnChange={(learn) =>
                    mutate((draft) => {
                      draft.learn = learn;
                    })
                  }
                  clientConnected={!!client}
                  hasBot={hasBot}
                  busy={!!session}
                  onPractice={() =>
                    void request('START_BRAIN_PRACTICE', {
                      clientId: String(client?.id),
                      pluginId: id,
                    })
                  }
                  onPlayBot={() => void handleReplay('ai')}
                  onOpenLauncher={() => navigate('/launcher')}
                />
              }
            />
          </Col>
        </Row>
      )}

      {plugin && (
        <PluginSettingsModal
          visible={editingPlugin}
          onClose={() => setEditingPlugin(false)}
          macroData={plugin}
          onSave={handleSavePlugin}
        />
      )}
    </Flex>
  );
}
