import { FC, useState } from 'react';
import { Button, Card, Skeleton, Tooltip, Typography } from 'antd';
import { SettingOutlined } from '@ant-design/icons';
import type { ProfileScript } from '../../../../common/profileScripts';
import type { MacroInfo } from '../../../../main/src/types';
import { useSettingsStore } from '../../../redux/settings';
import { makeActiveScriptsService } from '../../../services/ActiveScriptsService';
import { useResolvedScript } from './useResolvedScript';
import { usePanelContext } from '../../other/botSideBar/SidePanelContextProvider';
import { isPluginDisallowed } from '../../../../common/profiles';
import RunningControls from '../../macros/RunningControls';

interface Props {
  script: ProfileScript;
  infoOverride?: MacroInfo;
}

/**
 * Dashboard card for a single profile script.
 * - Card body click  → opens the shared side panel (Details + Options),
 *                       matching the click behavior of plugin cards.
 * - Settings gear    → opens the same side panel on the Options tab.
 */
const DashboardScriptCard: FC<Props> = ({ script, infoOverride }) => {
  const resolved = useResolvedScript(script, infoOverride);
  const { info } = resolved;
  const { setPanel } = usePanelContext();
  const [runLoading, setRunLoading] = useState(false);

  // Subscribe narrowly to this card's own running state so it only re-renders
  // when *its* script starts/stops — not on every activeScripts push.
  const pluginId = info?.pluginId;
  const running = useSettingsStore((s) =>
    pluginId
      ? makeActiveScriptsService(s.activeScripts).isScriptActiveById(pluginId)
      : false,
  );


  const blocked = useSettingsStore((s) =>{
    return isPluginDisallowed(
      s.JNdata?.data?.[s.appSettings.server ?? ''],
      pluginId,
    )},
  );

  const openPanel = (view: 'details' | 'options') => {
    if (!info) return;
    setPanel({
      active: true,
      tab: 'plugin',
      data: { plugin: info, view, profileScript: script },
    });
  };

  const run: React.MouseEventHandler<HTMLElement> = async (e) => {
    e.stopPropagation();
    if (!info) return;
    const scripts = makeActiveScriptsService(
      useSettingsStore.getState().activeScripts,
    );
    setRunLoading(true);
    try {
      await scripts.runPlugin({ name: info.name, pluginId: info.pluginId });
    } finally {
      setRunLoading(false);
    }
  };

  return (
    <Card
      className="script-card"
      onClick={() => openPanel('details')}
      style={{
        height: 250,
        width: '100%',
        border: 'none',
        marginBottom: '0.5rem',
        borderRadius: 12,
        position: 'relative',
        padding: 0,
      }}
      styles={{
        body: {
          height: '100%',
          padding: 0,
          margin: 0,
          position: 'relative',
          overflow: 'hidden',
        },
      }}
    >
      <div
        className="script-card-image"
        style={{
          backgroundImage: info?.banner ? `url(${info.banner})` : undefined,
          backgroundColor: info?.banner
            ? undefined
            : info?.theme?.primaryColor ?? '#1a1a1a',
        }}
      />

      <div className="script-card-overlay">
        {resolved.loading ? (
          <Skeleton.Input active size="small" style={{ width: 160 }} />
        ) : (
          <Typography.Title
            level={4}
            className="script-card-title"
            style={{
              color: '#fff',
              margin: 0,
              textShadow: '0 1px 3px rgba(0,0,0,0.6)',
              fontWeight: 600,
              letterSpacing: '0.5px',
            }}
          >
            {info?.name ?? (resolved.error ? 'Unavailable' : '…')}
          </Typography.Title>
        )}

        <div className="script-card-buttons">
          {running && pluginId ? (
            <RunningControls
              pluginId={pluginId}
              name={info?.name}
              buttonProps={{
                size: 'small',
                type: 'primary',
                className: 'script-run-btn',
              }}
            />
          ) : (
            <Tooltip
              title={
                resolved.error ||
                (blocked ? 'Disabled by this profile' : '')
              }
            >
              <Button
                onClick={run}
                size="small"
                type="primary"
                className="script-run-btn"
                loading={runLoading}
                disabled={!info || blocked}
              >
                Run
              </Button>
            </Tooltip>
          )}
          <Button
            icon={<SettingOutlined />}
            type="text"
            onClick={(e) => {
              e.stopPropagation();
              openPanel('options');
            }}
            className="script-settings-btn"
          />
        </div>
      </div>
    </Card>
  );
};

export default DashboardScriptCard;
