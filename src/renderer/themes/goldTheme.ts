import { theme } from 'antd';
import { ThemeConfig } from 'antd/es/config-provider';

/**
 * Theme mirroring the main website's palette (websitev3):
 * gold accent on a near-black, low-contrast dark surface.
 */
export const goldTheme: ThemeConfig = {
  algorithm: theme.darkAlgorithm,
  token: {
    fontFamily: "'Space Grotesk', 'Geist', sans-serif",
    borderRadius: 6,
    colorPrimary: '#f5b50a',
    colorPrimaryBg: 'rgba(245, 181, 10, 0.12)',
    colorPrimaryBorder: 'rgba(245, 181, 10, 0.32)',
    colorPrimaryHover: '#ffc31f',
    colorPrimaryActive: '#d99e08',
    colorLink: '#f5b50a',
    colorLinkHover: '#ffc31f',
    colorLinkActive: '#d99e08',
    colorTextBase: '#f3f3f4',
    colorTextSecondary: 'rgba(243, 243, 244, 0.58)',
    colorTextTertiary: 'rgba(243, 243, 244, 0.38)',
    colorBgBase: '#0b0b0d',
    colorBgContainer: '#16161b',
    colorBgElevated: '#131317',
    colorBgLayout: '#101013',
    colorBorder: 'rgba(255, 255, 255, 0.12)',
    colorBorderSecondary: 'rgba(255, 255, 255, 0.07)',
    colorBorderDisabled: 'rgba(255, 255, 255, 0.07)',
    colorBgContainerDisabled: 'rgba(255, 255, 255, 0.03)',
    colorTextDisabled: 'rgba(243, 243, 244, 0.35)',
    colorInfo: '#f5b50a',
    colorSuccess: '#5bd28a',
    colorWarning: '#f5b50a',
    colorError: '#ef6262',
    boxShadow: '0 30px 60px -20px rgba(0, 0, 0, 0.6), 0 10px 30px -10px rgba(0, 0, 0, 0.5)',
    boxShadowSecondary: '0 12px 32px rgba(0, 0, 0, 0.45)',
    colorFillSecondary: 'rgba(255, 255, 255, 0.04)',
  },
  components: {
    Layout: {
      bodyBg: '#0b0b0d',
      headerBg: '#101015',
      footerBg: '#101013',
      siderBg: '#0e0e12',
      headerHeight: 48,
    },
    Menu: {
      itemBg: '#0e0e12',
      itemSelectedBg: 'rgba(245, 181, 10, 0.12)',
      itemHoverBg: 'rgba(255, 255, 255, 0.04)',
      itemSelectedColor: '#f5b50a',
      darkPopupBg: '#0e0e12',
      darkSubMenuItemBg: '#0e0e12',
    },
    Card: {
      colorBgContainer: '#16161b',
      colorBorderSecondary: 'rgba(255, 255, 255, 0.07)',
      boxShadow: '0 16px 32px rgba(0, 0, 0, 0.35)',
    },
    Button: {
      colorPrimary: '#f5b50a',
      colorPrimaryHover: '#ffc31f',
      colorPrimaryActive: '#d99e08',
      primaryColor: '#1a1200',
      colorBorder: 'rgba(255, 255, 255, 0.12)',
      defaultBorderColor: 'rgba(255, 255, 255, 0.12)',
      borderColorDisabled: 'rgba(255, 255, 255, 0.07)',
      colorTextDisabled: 'rgba(243, 243, 244, 0.35)',
      defaultBgDisabled: 'rgba(255, 255, 255, 0.03)',
    },
    Input: {
      colorBgContainer: '#131317',
      colorBorder: 'rgba(255, 255, 255, 0.12)',
      colorBgBase: '#0b0b0d',
      colorText: '#f3f3f4',
      colorTextPlaceholder: 'rgba(243, 243, 244, 0.38)',
    },
    Modal: {
      contentBg: '#16161b',
      headerBg: '#16161b',
      titleColor: '#f3f3f4',
      footerBg: '#16161b',
    },
    Tabs: {
      itemColor: 'rgba(243, 243, 244, 0.58)',
      itemHoverColor: '#f3f3f4',
      itemSelectedColor: '#f5b50a',
      inkBarColor: '#f5b50a',
    },
    Table: {
      headerBg: '#131317',
      headerColor: '#d8d8da',
      headerSortActiveBg: '#1b1b20',
      rowHoverBg: 'rgba(255, 255, 255, 0.04)',
    },
    Dropdown: {
      controlItemBgHover: 'rgba(255, 255, 255, 0.04)',
      controlItemBgActive: 'rgba(245, 181, 10, 0.12)',
      colorPrimary: '#f5b50a',
    },
    Calendar: {
      itemActiveBg: 'rgba(245, 181, 10, 0.12)',
      fullBg: '#16161b',
    },
    Drawer: {
      colorBgElevated: '#16161b',
    },
    Segmented: {
      itemSelectedBg: "#1b1b22",
      itemActiveBg: '#16161b',
    }

  },
};
