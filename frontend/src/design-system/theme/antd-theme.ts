import type { ThemeConfig } from 'antd';
import { lightColors, darkColors } from '../tokens/colors';
import { borderRadius, spacing } from '../tokens/spacing';
import { fontStacks, typography } from '../tokens/typography';
import { shadows } from '../tokens/shadows';
import { motion } from '../tokens/animations';

const remToPx = (value: string) => {
  if (value.endsWith('rem')) {
    return parseFloat(value) * 16;
  }
  if (value.endsWith('px')) {
    return parseFloat(value);
  }
  return parseFloat(value);
};

export const lightTheme: ThemeConfig = {
  token: {
    colorPrimary: lightColors.primary.default,
    colorPrimaryHover: lightColors.primary.hover,
    colorPrimaryActive: lightColors.primary.active,
    colorSuccess: lightColors.success.text,
    colorWarning: lightColors.warning.text,
    colorError: lightColors.error.text,
    colorInfo: lightColors.info.text,
    colorBgBase: lightColors.bg.base,
    colorBgContainer: lightColors.bg.surface,
    colorBgElevated: lightColors.bg.elevated,
    colorBorder: lightColors.border.default,
    colorBorderSecondary: lightColors.border.subtle,
    colorTextBase: lightColors.text.primary,
    colorText: lightColors.text.primary,
    colorTextSecondary: lightColors.text.secondary,
    colorTextDisabled: lightColors.text.disabled,
    fontFamily: fontStacks.sans,
    fontSize: 14,
    lineHeight: typography.lineHeight.normal,
    borderRadius: remToPx(borderRadius.lg),
    borderRadiusLG: remToPx(borderRadius.xl),
    borderRadiusSM: remToPx(borderRadius.md),
    padding: remToPx(spacing[4]),
    paddingLG: remToPx(spacing[6]),
    paddingSM: remToPx(spacing[3]),
    boxShadow: shadows.base,
    motionDurationMid: motion.duration.base
  },
  components: {
    Button: {
      controlHeight: 36,
      primaryShadow: '0 4px 14px 0 rgba(59, 130, 246, 0.20)',
      borderRadius: remToPx(borderRadius.md)
    },
    Card: {
      boxShadow: shadows.sm,
      borderRadiusLG: remToPx(borderRadius.xl)
    },
    Table: {
      headerBg: lightColors.bg.surface,
      headerColor: lightColors.text.secondary,
      rowHoverBg: lightColors.table.rowHover,
      borderColor: lightColors.border.default
    },
    Layout: {
      siderBg: lightColors.sidebar.bg
    },
    Menu: {
      darkItemBg: 'transparent',
      darkItemSelectedBg: lightColors.sidebar.activeBg,
      darkItemColor: lightColors.sidebar.item,
      darkItemHoverColor: lightColors.sidebar.activeText
    }
  }
};

export const darkTheme: ThemeConfig = {
  token: {
    colorPrimary: darkColors.primary.default,
    colorPrimaryHover: darkColors.primary.hover,
    colorPrimaryActive: darkColors.primary.active,
    colorSuccess: darkColors.success.text,
    colorWarning: darkColors.warning.text,
    colorError: darkColors.error.text,
    colorInfo: darkColors.info.text,
    colorBgBase: darkColors.bg.base,
    colorBgContainer: darkColors.bg.surface,
    colorBgElevated: darkColors.bg.elevated,
    colorBorder: darkColors.border.default,
    colorBorderSecondary: darkColors.border.subtle,
    colorTextBase: darkColors.text.primary,
    colorText: darkColors.text.primary,
    colorTextSecondary: darkColors.text.secondary,
    colorTextDisabled: darkColors.text.disabled,
    colorTextPlaceholder: darkColors.text.muted,
    fontFamily: fontStacks.sans,
    fontSize: 14,
    lineHeight: typography.lineHeight.normal,
    borderRadius: remToPx(borderRadius.lg),
    borderRadiusLG: remToPx(borderRadius.xl),
    borderRadiusSM: remToPx(borderRadius.md),
    padding: remToPx(spacing[4]),
    paddingLG: remToPx(spacing[6]),
    paddingSM: remToPx(spacing[3]),
    boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.4), 0 8px 10px -6px rgba(0, 0, 0, 0.4)',
    motionDurationMid: motion.duration.base
  },
  components: {
    Button: {
      controlHeight: 36,
      primaryShadow: '0 4px 14px 0 rgba(59, 130, 246, 0.32)',
      borderRadius: remToPx(borderRadius.md)
    },
    Card: {
      boxShadow: '0 10px 30px rgba(0, 0, 0, 0.35)',
      borderRadiusLG: remToPx(borderRadius.xl)
    },
    Table: {
      headerBg: darkColors.bg.base,
      headerColor: darkColors.text.secondary,
      rowHoverBg: darkColors.table.rowHover,
      borderColor: darkColors.border.default
    },
    Layout: {
      headerBg: darkColors.bg.surface,
      siderBg: darkColors.sidebar.bg
    },
    Menu: {
      darkItemBg: 'transparent',
      darkItemSelectedBg: darkColors.sidebar.activeBg,
      darkItemColor: darkColors.sidebar.item,
      darkItemHoverColor: darkColors.sidebar.activeText,
      darkItemHoverBg: darkColors.sidebar.hover
    },
    Modal: {
      contentBg: darkColors.bg.surface,
      headerBg: darkColors.bg.surface
    },
    Drawer: {
      colorBgElevated: darkColors.bg.surface
    }
  }
};
