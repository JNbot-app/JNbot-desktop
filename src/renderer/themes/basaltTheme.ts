import { theme } from 'antd';
import { ThemeConfig } from 'antd/es/config-provider';

/**
 * Soft charcoal surfaces with hairline borders, soft gray text and a
 * light neutral gray accent with dark text, so primary actions stand out.
 */
export const basaltTheme: ThemeConfig = {
  algorithm: theme.darkAlgorithm,
  token: {
    fontFamily: "'Exo 2', sans-serif",
    borderRadius: 8,
    colorPrimary: '#9aa0a6',
    colorPrimaryBg: 'rgba(154, 160, 166, 0.14)',
    colorPrimaryBorder: 'rgba(154, 160, 166, 0.4)',
    colorPrimaryHover: '#b0b5ba',
    colorPrimaryActive: '#868b90',
    colorLink: '#b4b8bc',
    colorLinkHover: '#c2c5c8',
    colorLinkActive: '#9aa0a6',
    colorTextBase: '#cccccc',
    colorTextSecondary: '#9d9d9d',
    colorTextTertiary: '#6f6f6f',
    colorTextLightSolid: '#ffffff',
    colorBgBase: '#121314',
    colorBgContainer: '#191a1b',
    colorBgElevated: '#202122',
    colorBgLayout: '#121314',
    colorBorder: '#2e2f30',
    colorBorderSecondary: '#242526',
    colorFillSecondary: 'rgba(255, 255, 255, 0.06)',
    colorFillContent: 'rgba(255, 255, 255, 0.08)',
    colorInfo: '#8fa3bf',
    colorSuccess: '#3fb56b',
    colorWarning: '#e0a43a',
    colorError: '#ef5b5b',
  },
  components: {
    Layout: {
      bodyBg: '#121314',
      headerBg: '#121314',
      footerBg: '#121314',
      siderBg: '#121314',
      headerHeight: 48,
    },
    Menu: {
      itemBg: '#121314',
      itemColor: '#9d9d9d',
      itemSelectedBg: '#272829',
      itemHoverBg: '#1f2021',
      itemActiveBg: '#272829',
      itemSelectedColor: '#ffffff',
      popupBg: '#202122',
      darkItemBg: '#121314',
      darkSubMenuItemBg: '#121314',
      darkPopupBg: '#202122',
      darkItemColor: '#9d9d9d',
      darkItemHoverBg: '#1f2021',
      darkItemSelectedBg: '#272829',
      darkItemSelectedColor: '#ffffff',
    },
    Card: {
      colorBgContainer: '#191a1b',
      colorBorderSecondary: '#242526',
    },
    Button: {
      colorPrimary: '#9aa0a6',
      colorPrimaryHover: '#b0b5ba',
      colorPrimaryActive: '#868b90',
      primaryColor: '#121314',
      defaultBg: '#202122',
      defaultHoverBg: '#272829',
      defaultBorderColor: '#2e2f30',
      borderColorDisabled: 'rgba(255, 255, 255, 0.08)',
      defaultBgDisabled: 'rgba(255, 255, 255, 0.03)',
    },
    Input: {
      colorBgContainer: '#202122',
      colorBorder: '#2e2f30',
      colorTextPlaceholder: '#6f6f6f',
    },
    Select: {
      colorBgContainer: '#202122',
      colorBgElevated: '#202122',
      optionSelectedBg: '#272829',
      optionActiveBg: '#1f2021',
    },
    Modal: {
      contentBg: '#191a1b',
      headerBg: '#191a1b',
      footerBg: '#191a1b',
    },
    Drawer: {
      colorBgElevated: '#191a1b',
    },
    Tabs: {
      itemColor: '#9d9d9d',
      itemHoverColor: '#cccccc',
      itemSelectedColor: '#ffffff',
      inkBarColor: '#9aa0a6',
    },
    Table: {
      headerBg: '#202122',
      headerSortActiveBg: '#272829',
      rowHoverBg: 'rgba(255, 255, 255, 0.04)',
    },
    Dropdown: {
      colorBgElevated: '#202122',
      controlItemBgHover: '#272829',
      controlItemBgActive: '#272829',
      colorPrimary: '#cccccc',
    },
    Calendar: {
      itemActiveBg: '#272829',
      fullBg: '#191a1b',
    },
    Segmented: {
      itemSelectedBg: '#272829',
      itemActiveBg: '#202122',
    },
    Switch: {
      colorPrimary: '#9aa0a6',
      colorPrimaryHover: '#b0b5ba',
    },
    Tag: {
      defaultBg: '#202122',
    },
  },
};
