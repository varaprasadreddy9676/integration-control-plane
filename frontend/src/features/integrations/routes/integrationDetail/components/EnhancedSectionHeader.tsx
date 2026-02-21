import { Typography, Badge, Space, Tag, Tooltip } from 'antd';
import type { ReactNode } from 'react';
import {
  CheckCircleOutlined,
  ExclamationCircleOutlined,
  CloseCircleOutlined
} from '@ant-design/icons';
import { spacingToNumber, withAlpha, cssVar } from '../../../../../design-system/utils';

const { Text } = Typography;

export interface SectionCompletionStatus {
  isComplete: boolean;
  requiredFieldsCount: number;
  missingRequiredCount: number;
  errors: string[];
}

interface EnhancedSectionHeaderProps {
  icon: ReactNode;
  title: string;
  description?: string;
  spacing: Record<string, string>;
  completionStatus?: SectionCompletionStatus;
  badge?: {
    count?: number;
    text?: string;
    color?: string;
  };
}

export const EnhancedSectionHeader = ({
  icon,
  title,
  description,
  spacing,
  completionStatus,
  badge
}: EnhancedSectionHeaderProps) => {
  const colors = cssVar.legacy;

  // Determine status icon and color
  const getStatusIndicator = () => {
    if (!completionStatus) return null;

    if (completionStatus.errors.length > 0) {
      return {
        icon: <CloseCircleOutlined />,
        color: colors.error[500],
        tooltip: `${completionStatus.errors.length} error${completionStatus.errors.length > 1 ? 's' : ''}`
      };
    }

    if (completionStatus.missingRequiredCount > 0) {
      return {
        icon: <ExclamationCircleOutlined />,
        color: colors.warning[500],
        tooltip: `${completionStatus.missingRequiredCount} required field${completionStatus.missingRequiredCount > 1 ? 's' : ''} missing`
      };
    }

    if (completionStatus.isComplete) {
      return {
        icon: <CheckCircleOutlined />,
        color: colors.success[500],
        tooltip: 'Section complete'
      };
    }

    return null;
  };

  const statusIndicator = getStatusIndicator();

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        width: '100%'
      }}
    >
      {/* Left: Icon, Title, Description */}
      <Space size={spacingToNumber(spacing[2])} align="start">
        <div style={{ paddingTop: 2 }}>
          {icon}
        </div>
        <div style={{ flex: 1 }}>
          <Space size={spacingToNumber(spacing[2])}>
            <Text strong style={{ fontSize: 15 }}>
              {title}
            </Text>
            {badge && (
              <Tag
                color={badge.color || 'default'}
                style={{ margin: 0, fontSize: 11 }}
              >
                {badge.text || badge.count}
              </Tag>
            )}
          </Space>
          {description && (
            <div style={{ marginTop: spacingToNumber(spacing[1]) }}>
              <Text type="secondary" style={{ fontSize: 12, color: cssVar.text.secondary }}>
                {description}
              </Text>
            </div>
          )}
        </div>
      </Space>

      {/* Right: Status Indicator */}
      {statusIndicator && (
        <Tooltip title={statusIndicator.tooltip} placement="left">
          <div
            style={{
              fontSize: 16,
              color: statusIndicator.color,
              display: 'flex',
              alignItems: 'center',
              paddingRight: spacing[2]
            }}
          >
            {statusIndicator.icon}
          </div>
        </Tooltip>
      )}
    </div>
  );
};

/**
 * Helper function to compute section completion status
 * @param formValues - The current form values
 * @param requiredFields - Array of required field names for this section
 * @param validationErrors - Array of validation error messages for this section
 * @returns SectionCompletionStatus object
 */
export const computeSectionCompletion = (
  formValues: any,
  requiredFields: string[],
  validationErrors: string[] = []
): SectionCompletionStatus => {
  const missingRequiredCount = requiredFields.filter(field => {
    const value = getNestedValue(formValues, field);
    return value === undefined || value === null || value === '';
  }).length;

  const isComplete = missingRequiredCount === 0 && validationErrors.length === 0;

  return {
    isComplete,
    requiredFieldsCount: requiredFields.length,
    missingRequiredCount,
    errors: validationErrors
  };
};

/**
 * Get nested value from object using dot notation
 * @param obj - The object to get value from
 * @param path - Dot-separated path (e.g., 'auth.apiKey')
 */
function getNestedValue(obj: any, path: string): any {
  return path.split('.').reduce((current, key) => current?.[key], obj);
}
