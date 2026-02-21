/**
 * BaseNode Component
 *
 * Base component for all custom ReactFlow nodes with consistent styling
 */

import React from 'react';
import { Handle, Position } from 'reactflow';
import type { NodeProps } from 'reactflow';
import { Badge, Tooltip } from 'antd';
import {
  ThunderboltOutlined,
  LockOutlined,
  UnlockOutlined,
  ApiOutlined,
  SwapOutlined,
  FilterOutlined,
  ClockCircleOutlined,
  FileTextOutlined,
  BranchesOutlined,
  SendOutlined,
  CheckCircleOutlined,
  ExclamationCircleOutlined,
  WarningOutlined,
} from '@ant-design/icons';
import { cssVar, useDesignTokens } from '../../../../design-system/utils';
import type { FlowNodeData, FlowNodeType } from '../../state/flowTypes';

export type BaseNodeProps = NodeProps<FlowNodeData>;

const NODE_ICONS: Record<FlowNodeType, React.ReactNode> = {
  trigger: <ThunderboltOutlined />,
  inboundAuth: <LockOutlined />,
  outboundAuth: <UnlockOutlined />,
  http: <ApiOutlined />,
  transform: <SwapOutlined />,
  filter: <FilterOutlined />,
  scheduleScript: <FileTextOutlined />,
  delay: <ClockCircleOutlined />,
  multiAction: <BranchesOutlined />,
  response: <CheckCircleOutlined />,
  integration: <SendOutlined />,
};

const NODE_COLORS: Record<FlowNodeType, { background: string; border: string; text: string }> = {
  trigger: { background: '#e6f7ff', border: '#1890ff', text: '#0050b3' },
  inboundAuth: { background: '#fff7e6', border: '#fa8c16', text: '#ad6800' },
  outboundAuth: { background: '#fff7e6', border: '#fa8c16', text: '#ad6800' },
  http: { background: '#f9f0ff', border: '#722ed1', text: '#531dab' },
  transform: { background: '#f6ffed', border: '#52c41a', text: '#389e0d' },
  filter: { background: '#fff1f0', border: '#f5222d', text: '#a8071a' },
  scheduleScript: { background: '#f0f5ff', border: '#2f54eb', text: '#1d39c4' },
  delay: { background: '#fffbe6', border: '#faad14', text: '#ad6800' },
  multiAction: { background: '#e6fffb', border: '#13c2c2', text: '#08979c' },
  response: { background: '#f0f5ff', border: '#2f54eb', text: '#1d39c4' },
  integration: { background: '#f9f0ff', border: '#722ed1', text: '#531dab' },
};

export const BaseNode: React.FC<BaseNodeProps> = ({ id, data, selected = false }) => {
  const { token, shadows, transitions } = useDesignTokens();
  const colors = NODE_COLORS[data.nodeType] || NODE_COLORS.trigger;
  const icon = NODE_ICONS[data.nodeType];

  const hasErrors = data.errors && data.errors.length > 0;
  const isValid = data.isValid !== false;

  return (
    <div
      style={{
        background: selected ? colors.background : cssVar.bg.surface,
        border: `1px solid ${selected ? colors.border : hasErrors ? cssVar.error.text : cssVar.border.default}`,
        borderRadius: token.borderRadiusLG,
        padding: '12px 16px',
        minWidth: '180px',
        maxWidth: '250px',
        boxShadow: selected ? `0 0 0 2px ${colors.border}40` : shadows.sm,
        position: 'relative',
        transition: transitions.all,
      }}
    >
      {/* Incoming Handle */}
      {data.nodeType !== 'trigger' && (
        <Handle
          type="target"
          position={Position.Left}
          style={{
            width: '10px',
            height: '10px',
            background: colors.border,
            border: `1px solid ${cssVar.bg.surface}`,
          }}
        />
      )}

      {/* Node Content */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
        {/* Icon */}
        <div
          style={{
            fontSize: '20px',
            color: colors.border,
            lineHeight: '1',
            paddingTop: '2px',
          }}
        >
          {icon}
        </div>

        {/* Label and Description */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontWeight: 600,
              fontSize: '14px',
              color: cssVar.text.primary,
              lineHeight: '20px',
              marginBottom: '4px',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {data.label}
          </div>

          {data.description && (
            <div
              style={{
                fontSize: '12px',
                color: cssVar.text.secondary,
                lineHeight: '18px',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                display: '-webkit-box',
                WebkitLineClamp: 2,
                WebkitBoxOrient: 'vertical',
              }}
            >
              {data.description}
            </div>
          )}

          {/* Error/Warning Badge */}
          {hasErrors && (
            <Tooltip title={data.errors?.join(', ')}>
              <Badge
                count={data.errors!.length}
                style={{
                  marginTop: '6px',
                  backgroundColor: cssVar.error.text,
                  fontSize: '10px',
                }}
                offset={[0, 0]}
              >
                <ExclamationCircleOutlined style={{ color: cssVar.error.text, fontSize: '14px' }} />
              </Badge>
            </Tooltip>
          )}

          {!hasErrors && !isValid && (
            <Tooltip title="This node has validation warnings">
              <WarningOutlined style={{ color: '#faad14', fontSize: '14px', marginTop: '6px' }} />
            </Tooltip>
          )}
        </div>
      </div>

      {/* Outgoing Handle */}
      {data.nodeType !== 'response' && (
        <Handle
          type="source"
          position={Position.Right}
          style={{
            width: '10px',
            height: '10px',
            background: colors.border,
            border: `1px solid ${cssVar.bg.surface}`,
          }}
        />
      )}
    </div>
  );
};

export default BaseNode;
