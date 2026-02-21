import { useMemo } from 'react';
import { Space, Typography, Tag, Tooltip } from 'antd';
import { CheckCircleFilled, WarningFilled, InfoCircleOutlined } from '@ant-design/icons';
import { cssVar, useDesignTokens, withAlpha } from '../../../design-system/utils';

interface SectionHeaderProps {
  title: string;
  subtitle?: string;
  complete?: boolean;
  optional?: boolean;
  hasErrors?: boolean;
  errorCount?: number;
  helpText?: string;
  badge?: string;
  badgeColor?: string;
}

export const SectionHeader = ({
  title,
  subtitle,
  complete = false,
  optional = false,
  hasErrors = false,
  errorCount = 0,
  helpText,
  badge,
  badgeColor
}: SectionHeaderProps) => {
  const { spacing, token } = useDesignTokens();
  const colors = cssVar.legacy;

  const getStatusIcon = () => {
    if (hasErrors) {
      return (
        <WarningFilled
          style={{
            color: colors.error[600],
            fontSize: 18
          }}
        />
      );
    }

    if (complete) {
      return (
        <CheckCircleFilled
          style={{
            color: colors.success[600],
            fontSize: 18
          }}
        />
      );
    }

    return (
      <div
        style={{
          width: 18,
          height: 18,
          borderRadius: '50%',
          border: `2px solid ${colors.neutral[400]}`,
          background: cssVar.bg.surface
        }}
      />
    );
  };

  return (
    <Space align="center" size="middle">
      {getStatusIcon()}

      <div>
        <Space align="center" size="small">
          <Typography.Text strong style={{ fontSize: 15 }}>
            {title}
          </Typography.Text>

          {optional && (
            <Tag
              color="default"
              style={{
                fontSize: 11,
                padding: '0 6px',
                lineHeight: '18px',
                background: withAlpha(colors.neutral[500], 0.1),
                border: `1px solid ${withAlpha(colors.neutral[500], 0.2)}`
              }}
            >
              Optional
            </Tag>
          )}

          {badge && (
            <Tag
              color={badgeColor || 'blue'}
              style={{
                fontSize: 11,
                padding: '0 6px',
                lineHeight: '18px'
              }}
            >
              {badge}
            </Tag>
          )}

          {hasErrors && errorCount > 0 && (
            <Tag
              color="error"
              style={{
                fontSize: 11,
                padding: '0 6px',
                lineHeight: '18px'
              }}
            >
              {errorCount} {errorCount === 1 ? 'error' : 'errors'}
            </Tag>
          )}

          {helpText && (
            <Tooltip title={helpText} placement="right">
              <InfoCircleOutlined
                style={{
                  color: colors.info[500],
                  fontSize: 14,
                  cursor: 'help'
                }}
              />
            </Tooltip>
          )}
        </Space>

        {subtitle && (
          <Typography.Text
            type="secondary"
            style={{
              fontSize: 12,
              display: 'block',
              marginTop: 2
            }}
          >
            {subtitle}
          </Typography.Text>
        )}
      </div>
    </Space>
  );
};
