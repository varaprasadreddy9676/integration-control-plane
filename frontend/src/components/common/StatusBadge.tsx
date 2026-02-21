import { CheckCircleOutlined, CloseCircleOutlined, SyncOutlined, ExclamationCircleOutlined, BranchesOutlined, ClockCircleOutlined, StopOutlined, MinusCircleOutlined } from '@ant-design/icons';
import { Tag } from 'antd';
import type { ReactNode } from 'react';
import { cssVar, useDesignTokens } from '../../design-system/utils';
import type { DeliveryStatus, IntegrationScope } from '../../mocks/types';

const iconMap: Record<string, ReactNode> = {
  SUCCESS: <CheckCircleOutlined />,
  FAILED: <CloseCircleOutlined />,
  RETRYING: <SyncOutlined spin />,
  PENDING: <ClockCircleOutlined />,
  PENDING_OR_RETRYING: <ClockCircleOutlined />,
  SKIPPED: <MinusCircleOutlined />,
  ABANDONED: <StopOutlined />,
  ENTITY_ONLY: <BranchesOutlined />,
  INCLUDE_CHILDREN: <BranchesOutlined />,
  INHERITED: <BranchesOutlined />,
  LOCAL: <BranchesOutlined />
};

interface StatusBadgeProps {
  status: DeliveryStatus | 'INHERITED' | 'LOCAL' | 'PENDING_OR_RETRYING' | IntegrationScope;
  size?: 'small' | 'default' | 'large';
  showIcon?: boolean;
}

/**
 * StatusBadge - Semantic status indicator following Modern Enterprise UI principles
 *
 * Color is semantic, never decorative:
 * - Green: Success / healthy
 * - Red: Failure / blocking
 * - Amber: Warning / retrying
 * - Blue: Informational / pending
 * - Gray: Neutral / inactive
 */
export const StatusBadge = ({ status, size = 'default', showIcon = true }: StatusBadgeProps) => {
  const { spacing, borderRadius } = useDesignTokens();

  const toneMap: Record<string, { color: string; bg: string; border: string }> = {
    SUCCESS: {
      color: cssVar.success.text,
      bg: cssVar.success.bg,
      border: cssVar.success.border
    },
    FAILED: {
      color: cssVar.error.text,
      bg: cssVar.error.bg,
      border: cssVar.error.border
    },
    RETRYING: {
      color: cssVar.warning.text,
      bg: cssVar.warning.bg,
      border: cssVar.warning.border
    },
    PENDING: {
      color: cssVar.warning.text,
      bg: cssVar.warning.bg,
      border: cssVar.warning.border
    },
    PENDING_OR_RETRYING: {
      color: cssVar.warning.text,
      bg: cssVar.warning.bg,
      border: cssVar.warning.border
    },
    SKIPPED: {
      color: cssVar.text.muted,
      bg: cssVar.bg.subtle,
      border: cssVar.border.subtle
    },
    ABANDONED: {
      color: cssVar.text.secondary,
      bg: cssVar.bg.subtle,
      border: cssVar.border.default
    },
    ENTITY_ONLY: {
      color: cssVar.primary[700],
      bg: cssVar.primary[100],
      border: cssVar.primary[300]
    },
    INCLUDE_CHILDREN: {
      color: cssVar.primary[700],
      bg: cssVar.primary[100],
      border: cssVar.primary[300]
    },
    INHERITED: {
      color: cssVar.text.secondary,
      bg: cssVar.bg.subtle,
      border: cssVar.border.default
    },
    LOCAL: {
      color: cssVar.info.text,
      bg: cssVar.info.bg,
      border: cssVar.info.border
    }
  };

  const toneStyle = toneMap[status] ?? {
    color: cssVar.text.primary,
    bg: cssVar.bg.subtle,
    border: cssVar.border.default
  };

  // Size-based styling
  const sizeStyles = {
    small: {
      fontSize: 11,
      padding: `2px ${spacing[2]}`,
      fontWeight: 700
    },
    default: {
      fontSize: 12,
      padding: `${spacing['1']} ${spacing[2]}`,
      fontWeight: 700
    },
    large: {
      fontSize: 13,
      padding: `${spacing['1.5']} ${spacing['2.5']}`,
      fontWeight: 700
    }
  };

  const sizeStyle = sizeStyles[size];

  return (
    <Tag
      icon={showIcon ? iconMap[status] : undefined}
      style={{
        borderRadius: borderRadius.full, // Pill shape
        color: toneStyle.color,
        background: toneStyle.bg,
        borderColor: toneStyle.border,
        fontSize: sizeStyle.fontSize,
        padding: sizeStyle.padding,
        fontWeight: sizeStyle.fontWeight,
        margin: 0
      }}
    >
      {status}
    </Tag>
  );
};
