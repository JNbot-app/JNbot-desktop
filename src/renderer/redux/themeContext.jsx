import { createContext, useState } from 'react';
const ThemeContext = createContext({});

const langNames = {
  Nederlands: 'nl',
  English: 'en',
  Français: 'fr',
  Deutsch: 'de',
  Italiano: 'it',
  Norsk: 'nb',
  Español: 'es',
  Svenska: 'sv',
  Türkçe: 'tr',
  'English (US)': 'enUS',
};

const ThemeProvider = ({ children }) => {
  const [ theme, setTheme ] = useState(
    localStorage.getItem('theme') || 'default'
  );

  const [ locale, setLocale ] = useState(
    localStorage.getItem('locale') ||
    Object.entries(langNames).find(
      ([ , i18n ]) => i18n === navigator.language
    )?.[ 0 ] ||
    'enUS'
  );

  const updateLocale = (newLocale) => {
    if (newLocale in langNames && newLocale !== locale) {
      setLocale(langNames[ newLocale ]);
      localStorage.setItem('locale', langNames[ newLocale ]);
    }
  };

  const updateTheme = (newTheme) => {
    if (newTheme && newTheme !== theme) {
      localStorage.setItem('theme', newTheme);
      setTheme(newTheme);
    }
  };

  return (
    <ThemeContext.Provider
      value={{ theme, setTheme, updateTheme, updateLocale, locale }}
    >
      {children}
    </ThemeContext.Provider>
  );
};

export { ThemeContext, ThemeProvider };
