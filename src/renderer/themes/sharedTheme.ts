import type { ThemeConfig } from 'antd'

// Geist is loaded in styles.css; the old 'Exo 2' was never loaded and silently fell back to the system font
export const baseFontFamily =
  "'Geist', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif"

const sharedToken: ThemeConfig['token'] = {
  fontFamily: baseFontFamily,
  fontSize: 14,
  borderRadius: 8,
  borderRadiusSM: 6,
  wireframe: false,
}

// Spacing, density and hierarchy defaults shared by every theme; a theme's own component tokens win.
const sharedComponents: NonNullable<ThemeConfig['components']> = {
  Card: { headerFontSize: 15, headerHeight: 52, paddingLG: 20 },
  Modal: { titleFontSize: 16 },
  Tabs: { horizontalItemGutter: 28, horizontalMargin: '0 0 16px 0' },
  Table: { cellPaddingBlock: 10, cellPaddingInline: 14, headerSplitColor: 'transparent', fontWeightStrong: 600 },
  Button: { fontWeight: 500 },
  Tag: { borderRadiusSM: 6 },
  Typography: { titleMarginTop: 0, titleMarginBottom: '0.5em' },
  Form: { itemMarginBottom: 20, labelFontSize: 14 },
  Tooltip: { borderRadius: 6 },
}

export const withSharedTheme = (theme: ThemeConfig): ThemeConfig => {
  const components: NonNullable<ThemeConfig['components']> = { ...theme.components }
  for (const key of Object.keys(sharedComponents) as (keyof typeof sharedComponents)[]) {
    components[key] = { ...sharedComponents[key], ...components[key] } as never
  }
  const token = { ...sharedToken, ...theme.token }
  // Themes keep their own font only when it is a deliberate choice (gold's display font)
  if (!theme.token?.fontFamily || theme.token.fontFamily.includes('Exo 2')) token.fontFamily = baseFontFamily
  if (token.borderRadius === 6) token.borderRadius = 8
  return { ...theme, token, components }
}
