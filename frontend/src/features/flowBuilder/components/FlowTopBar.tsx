/**
 * Flow Top Bar Component
 *
 * Top navigation bar with save, test, preview, and other controls
 */

import React from 'react';
import {
  Button,
  Space,
  Typography,
  Badge,
  Dropdown,
  Input,
  Switch,
  Tooltip,
  Tag,
} from 'antd';
import type { MenuProps } from 'antd';
import {
  SaveOutlined,
  PlayCircleOutlined,
  EyeOutlined,
  SettingOutlined,
  ArrowLeftOutlined,
  CheckCircleOutlined,
  WarningOutlined,
  ExclamationCircleOutlined,
  CodeOutlined,
  HistoryOutlined,
} from '@ant-design/icons';
import { cssVar, useDesignTokens } from '../../../design-system/utils';
import type { FlowState, FlowValidationResult } from '../state/flowTypes';

const { Text } = Typography;

export interface FlowTopBarProps {
  flowState: FlowState;
  validation: FlowValidationResult;
  isDirty: boolean;
  isSaving: boolean;
  isTesting: boolean;
  onSave: () => void;
  onTest: () => void;
  onPreview: () => void;
  onBack: () => void;
  onNameChange: (name: string) => void;
  onActiveToggle: (isActive: boolean) => void;
}

export const FlowTopBar: React.FC<FlowTopBarProps> = ({
  flowState,
  validation,
  isDirty,
  isSaving,
  isTesting,
  onSave,
  onTest,
  onPreview,
  onBack,
  onNameChange,
  onActiveToggle,
}) => {
  const { transitions } = useDesignTokens();
  const [isEditingName, setIsEditingName] = React.useState(false);
  const [nameValue, setNameValue] = React.useState(flowState.name);

  React.useEffect(() => {
    setNameValue(flowState.name);
  }, [flowState.name]);

  const handleNameSubmit = () => {
    onNameChange(nameValue);
    setIsEditingName(false);
  };

  const handleNameKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleNameSubmit();
    } else if (e.key === 'Escape') {
      setNameValue(flowState.name);
      setIsEditingName(false);
    }
  };

  // Settings dropdown menu
  const settingsMenuItems: MenuProps['items'] = [
    {
      key: 'rate-limits',
      label: 'Configure Rate Limits',
      icon: <SettingOutlined />,
    },
    {
      key: 'advanced',
      label: 'Advanced Settings',
      icon: <SettingOutlined />,
    },
    {
      type: 'divider',
    },
    {
      key: 'export-json',
      label: 'Export as JSON',
      icon: <CodeOutlined />,
    },
    {
      key: 'version-history',
      label: 'Version History',
      icon: <HistoryOutlined />,
      disabled: true,
    },
  ];

  const canSave = validation.errors.length === 0;
  const canTest = validation.errors.length === 0;

  return (
    <div
      style={{
        height: '64px',
        background: cssVar.bg.surface,
        borderBottom: `1px solid ${cssVar.border.default}`,
        padding: '0 24px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}
    >
      {/* Left section - Back button and name */}
      <Space size="middle">
        <Button
          icon={<ArrowLeftOutlined />}
          onClick={onBack}
          type="text"
        >
          Back
        </Button>

        <div style={{ width: '1px', height: '32px', background: cssVar.border.default }} />

        {isEditingName ? (
          <Input
            value={nameValue}
            onChange={(e) => setNameValue(e.target.value)}
            onBlur={handleNameSubmit}
            onKeyDown={handleNameKeyPress}
            autoFocus
            style={{ width: '300px' }}
            placeholder="Integration name"
          />
        ) : (
          <div
            onClick={() => setIsEditingName(true)}
            style={{
              cursor: 'pointer',
              padding: '4px 8px',
              borderRadius: '4px',
              transition: transitions.background,
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = cssVar.bg.elevated;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent';
            }}
          >
            <Text strong style={{ fontSize: '16px' }}>
              {flowState.name || 'Untitled Integration'}
            </Text>
            {isDirty && (
              <Text type="secondary" style={{ marginLeft: '8px', fontSize: '12px' }}>
                (Unsaved)
              </Text>
            )}
          </div>
        )}

        <Tag color={getModeColor(flowState.mode)}>
          {flowState.mode.replace('_', ' ')}
        </Tag>

        {/* Validation status */}
        {validation.errors.length > 0 ? (
          <Tooltip
            title={
              <div>
                <div style={{ fontWeight: 600, marginBottom: '4px' }}>
                  {validation.errors.length} Error{validation.errors.length > 1 ? 's' : ''}
                </div>
                <ul style={{ margin: 0, paddingLeft: '20px' }}>
                  {validation.errors.slice(0, 3).map((error, idx) => (
                    <li key={idx}>{error.message}</li>
                  ))}
                  {validation.errors.length > 3 && (
                    <li>... and {validation.errors.length - 3} more</li>
                  )}
                </ul>
              </div>
            }
          >
            <Badge count={validation.errors.length} offset={[-5, 0]}>
              <ExclamationCircleOutlined
                style={{ fontSize: '20px', color: '#f5222d' }}
              />
            </Badge>
          </Tooltip>
        ) : validation.warnings.length > 0 ? (
          <Tooltip
            title={
              <div>
                <div style={{ fontWeight: 600, marginBottom: '4px' }}>
                  {validation.warnings.length} Warning{validation.warnings.length > 1 ? 's' : ''}
                </div>
                <ul style={{ margin: 0, paddingLeft: '20px' }}>
                  {validation.warnings.slice(0, 3).map((warning, idx) => (
                    <li key={idx}>{warning.message}</li>
                  ))}
                  {validation.warnings.length > 3 && (
                    <li>... and {validation.warnings.length - 3} more</li>
                  )}
                </ul>
              </div>
            }
          >
            <Badge count={validation.warnings.length} offset={[-5, 0]} color="orange">
              <WarningOutlined
                style={{ fontSize: '20px', color: '#faad14' }}
              />
            </Badge>
          </Tooltip>
        ) : (
          <Tooltip title="No validation errors">
            <CheckCircleOutlined
              style={{ fontSize: '20px', color: '#52c41a' }}
            />
          </Tooltip>
        )}
      </Space>

      {/* Right section - Actions */}
      <Space size="middle">
        {/* Active toggle */}
        <Space>
          <Text type="secondary">Active:</Text>
          <Switch
            checked={flowState.isActive}
            onChange={onActiveToggle}
            checkedChildren="ON"
            unCheckedChildren="OFF"
          />
        </Space>

        <div style={{ width: '1px', height: '32px', background: cssVar.border.default }} />

        {/* Preview button */}
        <Tooltip title="Preview backend payload">
          <Button
            icon={<EyeOutlined />}
            onClick={onPreview}
          >
            Preview
          </Button>
        </Tooltip>

        {/* Test button */}
        <Tooltip
          title={
            !canTest
              ? 'Fix validation errors before testing'
              : 'Test this integration with sample data'
          }
        >
          <Button
            icon={<PlayCircleOutlined />}
            onClick={onTest}
            disabled={!canTest}
            loading={isTesting}
          >
            Test
          </Button>
        </Tooltip>

        {/* Save button */}
        <Tooltip
          title={
            !canSave
              ? 'Fix validation errors before saving'
              : isDirty
              ? 'Save changes'
              : 'No changes to save'
          }
        >
          <Button
            type="primary"
            icon={<SaveOutlined />}
            onClick={onSave}
            disabled={!canSave}
            loading={isSaving}
          >
            Save
          </Button>
        </Tooltip>

        {/* Settings dropdown */}
        <Dropdown menu={{ items: settingsMenuItems }} placement="bottomRight">
          <Button icon={<SettingOutlined />} />
        </Dropdown>
      </Space>
    </div>
  );
};

function getModeColor(mode: string): string {
  switch (mode) {
    case 'INBOUND':
      return 'blue';
    case 'OUTBOUND_EVENT':
      return 'green';
    case 'OUTBOUND_SCHEDULED':
      return 'orange';
    default:
      return 'default';
  }
}

export default FlowTopBar;
