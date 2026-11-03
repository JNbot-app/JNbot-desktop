import { useMemo } from 'react';
import type { CSSProperties } from 'react';
import { Card, Space, theme } from 'antd';
import { useNavigate, useSearchParams } from 'react-router-dom';

import IntroProgress from '../components/intro/IntroProgress';
import IntroWelcomeStep from '../components/intro/IntroWelcomeStep';
import IntroImportStep from '../components/intro/IntroImportStep';
import IntroServerSelectStep from '../components/intro/IntroServerSelectStep';
import IntroCreateServerStep from '../components/intro/IntroCreateServerStep';
import IntroReadyStep from '../components/intro/IntroReadyStep';
import { withAlpha } from '../components/intro/introUtils';
import {
  startGettingStarted,
  useGettingStartedAction,
} from '../components/intro/useGettingStarted';
import { useSettingsStore, selectInstalledServerIds } from '../redux/settings';

type Stage = 'welcome' | 'import' | 'server' | 'create' | 'ready';

const PROGRESS: Record<Stage, number> = {
  welcome: 0,
  import: 1,
  server: 1,
  create: 1,
  ready: 2,
};

const isStage = (value: string | null): value is Stage =>
  !!value && Object.keys(PROGRESS).includes(value);

/**
 * First-run setup. The router sends users here while no server is installed.
 * The stage lives in the URL (`?stage=`) so a remount, or the profile wizard
 * returning here, never loses the user's place.
 */
const Intro = () => {
  const navigate = useNavigate();
  const { token } = theme.useToken();
  const [search, setSearch] = useSearchParams();
  const requested = search.get('stage');
  const stage: Stage = isStage(requested) ? requested : 'welcome';
  const go = (next: Stage) => setSearch({ stage: next }, { replace: true });
  const runStep = useGettingStartedAction();

  /** Leave the intro with the getting-started checklist switched on. */
  const start = () => {
    startGettingStarted();
    navigate('/');
  };

  // An import may bring no server along; the app can't run without one.
  const afterImport = () => {
    if (selectInstalledServerIds(useSettingsStore.getState()).length) navigate('/');
    else go('server');
  };

  const backgroundStyle = useMemo(
    () =>
      `radial-gradient(70% 70% at 12% 12%, ${withAlpha(token.colorPrimary, 0.24)} 0%, ${withAlpha(
        token.colorBgLayout,
        0,
      )} 70%), radial-gradient(60% 65% at 88% 88%, ${withAlpha(
        token.colorInfo ?? token.colorPrimary,
        0.18,
      )} 0%, ${withAlpha(token.colorBgLayout, 0)} 72%), linear-gradient(125deg, ${token.colorBgLayout} 0%, ${token.colorBgContainer} 100%)`,
    [token],
  );

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        padding: `${token.paddingLG}px ${token.paddingSM}px`,
        background: backgroundStyle,
        borderRadius: token.borderRadiusLG,
      }}
    >
      <div
        style={
          {
            width: '100%',
            height: '100px',
            position: 'absolute',
            top: 0,
            WebkitAppRegion: 'drag',
          } as CSSProperties
        }
      />

      <style>
        {`@keyframes intro-fade-slide {
            from {
              opacity: 0;
              transform: translateY(8px);
            }
            to {
              opacity: 1;
              transform: translateY(0);
            }
          }`}
      </style>

      <Space
        orientation="vertical"
        size={token.marginLG}
        style={{
          width: 'min(560px, 100%)',
          animation: 'intro-fade-slide 280ms ease-out',
        }}
      >
        <IntroProgress step={PROGRESS[stage]} total={3} />

        <Card
          variant="borderless"
          style={{
            borderRadius: token.borderRadiusLG,
            border: `1px solid ${token.colorBorderSecondary}`,
            boxShadow: token.boxShadowSecondary,
            background: withAlpha(token.colorBgContainer, 0.88),
            backdropFilter: 'blur(10px)',
          }}
          styles={{
            body: {
              padding: token.paddingXL,
            },
          }}
        >
          {stage === 'welcome' && (
            <IntroWelcomeStep
              onNew={() => go('server')}
              onExisting={() => go('import')}
            />
          )}

          {stage === 'import' && (
            <IntroImportStep onBack={() => go('welcome')} onImported={afterImport} />
          )}

          {stage === 'server' && (
            <IntroServerSelectStep
              onBack={() => go('welcome')}
              onCreate={() => go('create')}
              onPicked={() => go('ready')}
            />
          )}

          {stage === 'create' && (
            <IntroCreateServerStep
              onBack={() => go('server')}
              onCreated={() => go('ready')}
            />
          )}

          {stage === 'ready' && (
            <IntroReadyStep
              onExplore={start}
              onAddAlt={() => {
                startGettingStarted();
                runStep('alt');
              }}
            />
          )}
        </Card>
      </Space>
    </div>
  );
};

export default Intro;
