import { usePanelContext } from '../../other/botSideBar/SidePanelContextProvider';
import { SCHEDULE_TAB, type SchedulePanelData } from 'renderer/components/other/botSideBar/panelTabs';
import type { ScriptSchedule } from '../../../../common/cooldowns';
import {
  useSettingsStore,
  selectCanUseScripts,
  selectCanUsePlugins,
  selectCanUseAccounts,
} from '../../../redux/settings';

/** Opens the schedule side panel; `canSchedule` reflects the user's permissions. */
const useOpenSchedule = () => {
  const { setPanel } = usePanelContext();
  const canUseScripts = useSettingsStore(selectCanUseScripts);
  const canUsePlugins = useSettingsStore(selectCanUsePlugins);
  const canUseAccounts = useSettingsStore(selectCanUseAccounts);

  return {
    canSchedule: (canUseScripts || canUsePlugins) && canUseAccounts,
    openSchedule: (schedule?: ScriptSchedule) =>
      setPanel({ active: true, tab: SCHEDULE_TAB, data: { schedule } satisfies SchedulePanelData }),
  };
};

export default useOpenSchedule;
