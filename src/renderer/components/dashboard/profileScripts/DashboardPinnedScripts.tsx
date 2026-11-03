import { FC } from 'react';
import type { MacroInfo } from 'main/src/types';
import DashboardScriptCard from './DashboardScriptCard';

interface Props {
  pinnedPlugins: MacroInfo[];
}

const DashboardPinnedScripts: FC<Props> = ({ pinnedPlugins }) => {
  return (
    <>
      {pinnedPlugins.map((s) => (
        <DashboardScriptCard
          key={s.pluginId}
          script={{
            id: s.pluginId,
            pluginId: s.pluginId,
            source: {
              kind: 'plugin',
              pluginId: s.pluginId,
            },
          }}
          infoOverride={s}
        />
      ))}
    </>
  );
};

export default DashboardPinnedScripts;
