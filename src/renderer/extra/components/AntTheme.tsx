import { ConfigProvider, ThemeConfig } from "antd"
import { FC, PropsWithChildren, useMemo } from "react"


import { lightTheme } from "../../themes/lightTheme"
import { darkTheme } from "../../themes/darkTheme"
import type { Locale } from 'antd/es/locale';
import useApp from "../../hooks/useApp"
import frFR from 'antd/locale/fr_FR';
import nlNL from 'antd/locale/nl_NL';
import enUS from 'antd/locale/en_US';
import { Language } from "../../providers/AppProvider";
import { obsidianTheme } from "../../themes/obsidianPurpleTheme";
import { nightTheme } from "../../themes/nightTheme";
import { goldTheme } from "../../themes/goldTheme";
import { sculkTheme } from "../../themes/sculkTheme";
import { basaltTheme } from "../../themes/basaltTheme";
import { Themes } from "common/CommonEnums";
import { withSharedTheme } from "../../themes/sharedTheme";
import { selectAppSettings, useSettingsStore } from "../../redux/settings";


const i18n_locale: Record<Language, Locale> = {
  [Language.FR]: frFR,
  [Language.NL]: nlNL,
  [Language.EN]: enUS,
};

const rawThemes: Record<Themes, ThemeConfig> = {
  [Themes.LIGHT]: lightTheme,
  [Themes.DARK]: darkTheme,
  [Themes.OBSIDIAN]: obsidianTheme,
  [Themes.NIGHT]: nightTheme,
  [Themes.GOLD]: goldTheme,
  [Themes.SCULK]: sculkTheme,
  [Themes.BASALT]: basaltTheme,
}

// Full-screen backdrop blur is costly to repaint while the modal animates
const appThemes = Object.fromEntries(
  Object.entries(rawThemes).map(([key, value]) => [key, withSharedTheme(value)]),
) as Record<Themes, ThemeConfig>

const modalConfig = { mask: { blur: false } }

const ThemeProvider: FC<PropsWithChildren> = ({ children }) => {
  const { theme, language } = useApp()
  const appSettings = useSettingsStore(selectAppSettings)

  const selectedTheme = appThemes[theme] ?? appThemes[Themes.NIGHT]
  const locale = i18n_locale[language] ?? i18n_locale[Language.EN]
  const reduceMotion = Boolean(appSettings?.reduceMotion)

  const activeTheme = useMemo(() => {
    let theme = selectedTheme  
    if(theme && theme.token) {
      theme = {...theme, token: {...theme.token, motion: !reduceMotion}}
    }
    return theme
  }, [reduceMotion, theme, selectedTheme])


  return (
    <ConfigProvider theme={activeTheme} locale={locale} modal={modalConfig}>
      {children}
    </ConfigProvider>
  )
}

export default ThemeProvider
