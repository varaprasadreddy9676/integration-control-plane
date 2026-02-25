import { useMemo, useState } from 'react';
import { Space, Tag, Tooltip, Progress, Typography, Button } from 'antd';
import {
  CheckCircleOutlined,
  CloseCircleOutlined,
  ExclamationCircleOutlined,
  DownOutlined,
  UpOutlined
} from '@ant-design/icons';
import { cssVar, useDesignTokens, withAlpha } from '../../../../../design-system/utils';

const { Text } = Typography;

interface RuleStatusBarProps {
  isCreate: boolean;
  isActive?: boolean;
  isDraft?: boolean;

  // Validation state
  missingRequiredCount: number;
  validationErrors: string[];
  isValid: boolean;

  // Optional
  className?: string;
  style?: React.CSSProperties;
}

export const RuleStatusBar = ({
  isCreate,
  isActive = false,
  isDraft = true,
  missingRequiredCount,
  validationErrors,
  isValid,
  className,
  style
}: RuleStatusBarProps) => {
  const [showAllErrors, setShowAllErrors] = useState(false);
  const { spacing, token } = useDesignTokens();
  const colors = cssVar.legacy;

  // Calculate completion percentage (inverse of missing fields)
  const totalFields = 10; // Approximate total critical fields
  const completedFields = Math.max(0, totalFields - missingRequiredCount);
  const completionPercentage = Math.round((completedFields / totalFields) * 100);

  // Determine status color and icon
  const getStatusDisplay = () => {
    // If already active and valid, show active status
    if (isActive && isValid && missingRequiredCount === 0 && validationErrors.length === 0) {
      return {
        icon: <CheckCircleOutlined />,
        text: isCreate ? 'Ready to activate' : 'All changes saved',
        color: colors.success[600],
        bgColor: withAlpha(colors.success[100], 0.5)
      };
    }

    // If valid but not active, ready to activate
    if (isValid && missingRequiredCount === 0 && validationErrors.length === 0) {
      return {
        icon: <CheckCircleOutlined />,
        text: 'Ready to activate',
        color: colors.success[600],
        bgColor: withAlpha(colors.success[100], 0.5)
      };
    }

    if (validationErrors.length > 0) {
      return {
        icon: <CloseCircleOutlined />,
        text: `${validationErrors.length} error${validationErrors.length > 1 ? 's' : ''} to fix`,
        color: colors.error[600],
        bgColor: withAlpha(colors.error[100], 0.5)
      };
    }

    if (missingRequiredCount > 0) {
      return {
        icon: <ExclamationCircleOutlined />,
        text: `${missingRequiredCount} required field${missingRequiredCount > 1 ? 's' : ''} missing`,
        color: colors.warning[600],
        bgColor: withAlpha(colors.warning[100], 0.5)
      };
    }

    return {
      icon: <ExclamationCircleOutlined />,
      text: 'In progress',
      color: cssVar.text.secondary,
      bgColor: withAlpha(cssVar.bg.subtle, 0.8)
    };
  };

  const statusDisplay = getStatusDisplay();

  return (
    <div
      className={className}
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 100,
        background: cssVar.bg.surface,
        borderBottom: `1px solid ${cssVar.border.default}`,
        padding: `${spacing[3]} ${spacing[4]}`,
        marginBottom: spacing[4],
        boxShadow: token.boxShadow,
        ...style
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          maxWidth: 1400,
          margin: '0 auto'
        }}
      >
        {/* Left: Status and validation indicators */}
        <Space size="large">
          {/* Status Tag */}
          <Space size="small">
            <Tag
              color={isCreate ? 'default' : isActive ? 'success' : 'warning'}
              style={{ margin: 0, fontSize: 13, fontWeight: 500 }}
            >
              {isCreate ? 'Draft' : isActive ? 'Active' : 'Paused'}
            </Tag>
          </Space>

          {/* Validation Status */}
          <Space size="small">
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: spacing[2],
                padding: `${spacing[1]} ${spacing[3]}`,
                borderRadius: 6,
                background: statusDisplay.bgColor,
                border: `1px solid ${withAlpha(statusDisplay.color, 0.2)}`
              }}
            >
              <span style={{ color: statusDisplay.color, fontSize: 14 }}>
                {statusDisplay.icon}
              </span>
              <Text style={{ fontSize: 13, fontWeight: 500, color: statusDisplay.color }}>
                {statusDisplay.text}
              </Text>
            </div>
          </Space>

          {/* Progress Bar (only show when in progress) */}
          {!isValid && missingRequiredCount > 0 && (
            <Tooltip title={`${completionPercentage}% complete`}>
              <div style={{ width: 120 }}>
                <Progress
                  percent={completionPercentage}
                  size="small"
                  showInfo={false}
                  strokeColor={colors.primary[500]}
                  trailColor={cssVar.border.default}
                />
              </div>
            </Tooltip>
          )}
        </Space>

        <span />
      </div>

      {/* Validation Errors List (expandable) */}
      {validationErrors.length > 0 && (
        <div
          style={{
            maxWidth: 1400,
            margin: `${spacing[2]} auto 0`,
            padding: spacing[2],
            background: withAlpha(colors.error[50], 0.5),
            borderRadius: 6,
            border: `1px solid ${withAlpha(colors.error[200], 0.5)}`
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <Text style={{ fontSize: 12, color: colors.error[700] }}>
              <strong>Validation errors:</strong>
            </Text>
            {validationErrors.length > 3 && (
              <Button
                type="text"
                size="small"
                icon={showAllErrors ? <UpOutlined /> : <DownOutlined />}
                onClick={() => setShowAllErrors(!showAllErrors)}
                style={{ fontSize: 12, color: colors.error[500], height: 'auto', padding: '0 4px' }}
              >
                {showAllErrors ? 'Show less' : `+${validationErrors.length - 3} more`}
              </Button>
            )}
          </div>
          <ul style={{ margin: `${spacing[1]} 0 0`, paddingLeft: spacing[4], fontSize: 12 }}>
            {(showAllErrors ? validationErrors : validationErrors.slice(0, 3)).map((error, idx) => (
              <li key={idx} style={{ color: colors.error[600] }}>
                {error}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};
