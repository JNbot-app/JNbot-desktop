import {
  createContext,
  FC,
  PropsWithChildren,
  useCallback,
  useMemo,
} from 'react';
import { ALT_EDITOR_TAB } from 'renderer/components/other/botSideBar/panelTabs';
import { ACCOUNT_PROFILE_TAB } from '../components/other/botSideBar/accountProfile/accountProfileTab';
import { usePanelContext } from '../components/other/botSideBar/SidePanelContextProvider';

export interface AppContextType {
  openAccountProfile: (username: string) => void;
  openAltEditor: (username?: string) => void;
}

export const AppContext = createContext<AppContextType>({} as AppContextType);

export const AppProvider: FC<PropsWithChildren> = ({ children }) => {
  const { setPanel } = usePanelContext();

  const openAccountProfile = useCallback(
    (username: string) => {
      if (!username) return;
      setPanel({
        active: true,
        tab: ACCOUNT_PROFILE_TAB,
        data: { username },
      });
    },
    [setPanel],
  );

  const openAltEditor = useCallback(
    (username?: string) => {
      setPanel({
        active: true,
        tab: ALT_EDITOR_TAB,
        data: username ? { originalUsername: username } : {},
      });
    },
    [setPanel],
  );

  const value = useMemo(
    () => ({ openAccountProfile, openAltEditor }),
    [openAccountProfile, openAltEditor],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
};
