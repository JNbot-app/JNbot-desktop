import { useEffect, useState } from 'react';
import { Button, Card, Flex, Progress, Typography, theme } from 'antd';
import { CheckCircleFilled, CloseOutlined } from '@ant-design/icons';
import useGettingStarted, {
  dismissGettingStarted,
  useGettingStartedAction,
} from './useGettingStarted';
import { usePanelContext } from '../other/botSideBar/SidePanelContextProvider';
import { ALT_EDITOR_TAB } from '../other/botSideBar/panelTabs';

const { Text } = Typography;

/** Floating checklist that walks new users through their first bot. */
const GettingStartedChecklist = () => {
  const { token } = theme.useToken();
  const steps = useGettingStarted();
  const runStep = useGettingStartedAction();
  const { panel, setPanel } = usePanelContext();
  const [busy, setBusy] = useState(false);
  const altDone = steps?.[0].done;

  // Close the alt editor once the first alt is saved so the next step shows.
  useEffect(() => {
    if (!altDone) return;
    setPanel((p) => (p.active && p.tab === ALT_EDITOR_TAB ? { ...p, active: false } : p));
  }, [altDone, setPanel]);

  // Stay out of the way of the side panel (e.g. the alt editor's save button).
  if (!steps || panel.active) return null;

  const run = async (id: (typeof steps)[number]['id']) => {
    setBusy(true);
    await runStep(id);
    setBusy(false);
  };

  const doneCount = steps.filter((step) => step.done).length;
  const current = steps.find((step) => !step.done);

  return (
    <Card
      size="small"
      title={current ? 'Getting started' : "You're all set!"}
      extra={
        <Button
          type="text"
          size="small"
          icon={<CloseOutlined />}
          aria-label="Hide checklist"
          onClick={dismissGettingStarted}
        />
      }
      style={{
        position: 'fixed',
        right: token.marginLG,
        bottom: token.marginLG,
        width: 300,
        zIndex: token.zIndexPopupBase,
        boxShadow: token.boxShadowSecondary,
      }}
    >
      <Flex vertical gap={token.marginSM}>
        <Progress
          percent={(doneCount / steps.length) * 100}
          showInfo={false}
          size="small"
        />
        {steps.map((step, index) => (
          <Flex key={step.id} align="center" gap={token.marginSM}>
            {step.done ? (
              <CheckCircleFilled style={{ color: token.colorSuccess }} />
            ) : (
              <Text type="secondary" style={{ width: 14, textAlign: 'center' }}>
                {index + 1}
              </Text>
            )}
            <Text
              delete={step.done}
              type={step.done ? 'secondary' : undefined}
              strong={step === current}
              style={{ flex: 1 }}
            >
              {step.title}
            </Text>
            {step === current && (
              <Button type="primary" size="small" loading={busy} onClick={() => run(step.id)}>
                Show me
              </Button>
            )}
          </Flex>
        ))}
        {!current && (
          <Button block onClick={dismissGettingStarted}>
            Done
          </Button>
        )}
      </Flex>
    </Card>
  );
};

export default GettingStartedChecklist;
