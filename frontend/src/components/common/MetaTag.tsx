import { Tag } from 'antd';
import type { ReactNode } from 'react';
import { cssVar, useDesignTokens, withAlpha } from '../../design-system/utils';

interface MetaTagProps {
  children: ReactNode;
  variant?: 'event' | 'method' | 'flow' | 'category' | 'neutral';
  size?: 'small' | 'default';
}

/**
 * MetaTag - Metadata indicator for non-status information
 *
 * Use for:
 * - Event types
 * - HTTP methods
 * - Flow direction (Inbound/Outbound/Scheduled)
 * - Error categories
 * - Other metadata
 *
 * NOT for status (use StatusBadge for success/failure/pending)
 */
export const MetaTag = ({ children, variant = 'neutral', size = 'default' }: MetaTagProps) => {
  const { spacing, borderRadius } = useDesignTokens();

  // Semantic variants for metadata
  const variantStyles = {
    // Event types - blue/info
    event: {
      borderColor: cssVar.info.border,
      background: cssVar.info.bg,
      color: cssVar.info.text,
      fontWeight: 600
    },
    // HTTP methods - primary
    method: {
      background: withAlpha(cssVar.primary[500], 0.22),
      color: cssVar.primary[100],
      border: `1px solid ${withAlpha(cssVar.primary[500], 0.52)}`,
      fontWeight: 600
    },
    // Flow direction - varies
    flow: {
      borderColor: cssVar.success.border,
      background: cssVar.success.bg,
      color: cssVar.success.text,
      fontWeight: 700
    },
    // Error categories - warning
    category: {
      borderColor: cssVar.warning.border,
      background: cssVar.warning.bg,
      color: cssVar.warning.text,
      fontWeight: 700
    },
    // Neutral metadata
    neutral: {
      borderColor: cssVar.border.default,
      background: cssVar.bg.subtle,
      color: cssVar.text.secondary,
      fontWeight: 600
    }
  };

  const sizeStyles = {
    small: {
      fontSize: 11,
      padding: `2px ${spacing[2]}`
    },
    default: {
      fontSize: 12,
      padding: `${spacing['1']} ${spacing['2.5']}`
    }
  };

  const variantStyle = variantStyles[variant];
  const sizeStyle = sizeStyles[size];

  return (
    <Tag
      style={{
        borderRadius: borderRadius.full, // Pill shape
        fontSize: sizeStyle.fontSize,
        padding: sizeStyle.padding,
        margin: 0,
        ...variantStyle
      }}
    >
      {children}
    </Tag>
  );
};
