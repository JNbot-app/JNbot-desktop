import { Themes } from 'common/CommonEnums';
import {
  FC,
  PropsWithChildren,
  createContext,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';

export enum Language {
  FR = 'fr',
  NL = 'nl',
  EN = 'en',
  US = 'en'
}


export type AppContextT = {
  theme: Themes;
  language: Language;
  setTheme: (theme: Themes) => void;
  setLanguage: (language: Language) => void;
};

const AppContext = createContext<AppContextT>({} as AppContextT);
const SUPPORTED_THEMES = Object.values(Themes);
const SUPPORTED_LANGUAGES = [Language.EN, Language.FR, Language.NL];
const THEME_CLASSNAMES = SUPPORTED_THEMES.map((value) => `${value}-theme`);
const MODE_CLASSNAMES = ['light-theme', 'dark-theme'];

/** Apply a theme to the document and remember it on this device. */
const applyTheme = (theme: Themes) => {
  document.body.classList.remove(...THEME_CLASSNAMES, ...MODE_CLASSNAMES);
  const modeClass = theme === Themes.LIGHT ? 'light-theme' : 'dark-theme';
  document.body.classList.add(`${theme}-theme`, modeClass);
  window.localStorage.setItem('theme', theme);
};

const AppProvider: FC<PropsWithChildren> = ({ children }) => {
  const [theme, setThemeState] = useState<Themes>(Themes.BASALT);
  const [language, setLanguageState] = useState<Language>(Language.EN);

  // Stable setters: consumers (the messager) list them as effect deps, and a
  // new identity per render would re-run their startup work.
  const setTheme = useCallback((next: Themes) => {
    setThemeState(next);
    applyTheme(next);
  }, []);

  const setLanguage = useCallback((next: Language) => {
    setLanguageState(next);
    window.localStorage.setItem('i18n', next);
  }, []);

  useEffect(() => {
    const stored = window.localStorage.getItem('theme') as Themes;
    setTheme(SUPPORTED_THEMES.includes(stored) ? stored : Themes.BASALT);
    const storedLanguage = window.localStorage.getItem('i18n') as Language;
    setLanguageState(
      SUPPORTED_LANGUAGES.includes(storedLanguage) ? storedLanguage : Language.EN,
    );
  }, [setTheme]);

  const value = useMemo(
    () => ({ theme, language, setTheme, setLanguage }),
    [theme, language, setTheme, setLanguage],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
};

export { AppProvider, AppContext };
