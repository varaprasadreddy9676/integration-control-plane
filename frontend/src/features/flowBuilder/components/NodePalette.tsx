/**
 * Node Palette Component
 *
 * Left sidebar showing available nodes that can be dragged onto the canvas
 */

import React from 'react';
import { Card, Typography, Space, Tooltip, Badge } from 'antd';
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
} from '@ant-design/icons';
import { cssVar, useDesignTokens } from '../../../design-system/utils';
import type { IntegrationMode, FlowNodeType } from '../state/flowTypes';
import { ALLOWED_NODE_TYPES } from '../state/flowSchema';

const { Title, Text } = Typography;

interface NodePaletteItem {
  type: FlowNodeType;
  label: string;
  description: string;
  icon: React.ReactNode;
  category: 'trigger' | 'logic' | 'action' | 'output';
  allowedModes: IntegrationMode[];
  color: string;
}

const NODE_PALETTE_ITEMS: NodePaletteItem[] = [
  {
    type: 'trigger',
    label: 'Trigger',
    description: 'Start point for the integration',
    icon: <ThunderboltOutlined />,
    category: 'trigger',
    allowedModes: ['INBOUND', 'OUTBOUND_EVENT', 'OUTBOUND_SCHEDULED'],
    color: '#1890ff',
  },
  {
    type: 'inboundAuth',
    label: 'Inbound Auth',
    description: 'Validate incoming API requests',
    icon: <LockOutlined />,
    category: 'logic',
    allowedModes: ['INBOUND'],
    color: '#fa8c16',
  },
  {
    type: 'outboundAuth',
    label: 'Outbound Auth',
    description: 'Add authentication to outgoing requests',
    icon: <UnlockOutlined />,
    category: 'logic',
    allowedModes: ['OUTBOUND_EVENT', 'OUTBOUND_SCHEDULED'],
    color: '#fa8c16',
  },
  {
    type: 'http',
    label: 'HTTP Call',
    description: 'Call an external API',
    icon: <ApiOutlined />,
    category: 'action',
    allowedModes: ['INBOUND', 'OUTBOUND_SCHEDULED'],
    color: '#722ed1',
  },
  {
    type: 'transform',
    label: 'Transform',
    description: 'Transform request/response data',
    icon: <SwapOutlined />,
    category: 'logic',
    allowedModes: ['INBOUND', 'OUTBOUND_EVENT', 'OUTBOUND_SCHEDULED'],
    color: '#52c41a',
  },
  {
    type: 'filter',
    label: 'Filter',
    description: 'Conditional logic and routing',
    icon: <FilterOutlined />,
    category: 'logic',
    allowedModes: ['INBOUND', 'OUTBOUND_EVENT', 'OUTBOUND_SCHEDULED'],
    color: '#f5222d',
  },
  {
    type: 'scheduleScript',
    label: 'Schedule Script',
    description: 'Script that computes scheduled execution time',
    icon: <FileTextOutlined />,
    category: 'logic',
    allowedModes: ['OUTBOUND_SCHEDULED'],
    color: '#2f54eb',
  },
  {
    type: 'delay',
    label: 'Delay',
    description: 'Wait before continuing',
    icon: <ClockCircleOutlined />,
    category: 'logic',
    allowedModes: ['OUTBOUND_EVENT', 'OUTBOUND_SCHEDULED'],
    color: '#faad14',
  },
  {
    type: 'multiAction',
    label: 'Multi-Action',
    description: 'Execute multiple actions in parallel',
    icon: <BranchesOutlined />,
    category: 'action',
    allowedModes: ['OUTBOUND_EVENT', 'OUTBOUND_SCHEDULED'],
    color: '#13c2c2',
  },
  {
    type: 'response',
    label: 'Response',
    description: 'Return response to client',
    icon: <CheckCircleOutlined />,
    category: 'output',
    allowedModes: ['INBOUND'],
    color: '#2f54eb',
  },
  {
    type: 'integration',
    label: 'Integration',
    description: 'Deliver integration to external system',
    icon: <SendOutlined />,
    category: 'output',
    allowedModes: ['OUTBOUND_EVENT', 'OUTBOUND_SCHEDULED'],
    color: '#722ed1',
  },
];

export interface NodePaletteProps {
  mode: IntegrationMode;
  onAddNode: (nodeType: FlowNodeType) => void;
  existingNodeTypes?: FlowNodeType[];
}

export const NodePalette: React.FC<NodePaletteProps> = ({
  mode,
  onAddNode,
  existingNodeTypes = [],
}) => {
  const { token, transitions } = useDesignTokens();

  // Filter nodes based on current mode
  const availableNodes = NODE_PALETTE_ITEMS.filter((item) =>
    item.allowedModes.includes(mode)
  );

  // Group nodes by category
  const nodesByCategory = availableNodes.reduce(
    (acc, node) => {
      if (!acc[node.category]) {
        acc[node.category] = [];
      }
      acc[node.category].push(node);
      return acc;
    },
    {} as Record<string, NodePaletteItem[]>
  );

  const categoryLabels = {
    trigger: 'Triggers',
    logic: 'Logic',
    action: 'Actions',
    output: 'Output',
  };

  const categoryOrder: Array<keyof typeof categoryLabels> = ['trigger', 'logic', 'action', 'output'];

  // Check if a node can be added (some nodes like trigger can only have one instance)
  const canAddNode = (nodeType: FlowNodeType): boolean => {
    if (nodeType === 'trigger') {
      return !existingNodeTypes.includes('trigger');
    }
    if (nodeType === 'scheduleScript') {
      return !existingNodeTypes.includes('scheduleScript');
    }
    return true;
  };

  const handleNodeClick = (nodeType: FlowNodeType) => {
    if (canAddNode(nodeType)) {
      onAddNode(nodeType);
    }
  };

  const onDragStart = (event: React.DragEvent, nodeType: FlowNodeType) => {
    if (!canAddNode(nodeType)) {
      event.preventDefault();
      return;
    }

    event.dataTransfer.setData('application/reactflow', nodeType);
    event.dataTransfer.effectAllowed = 'move';
  };

  return (
    <div
      style={{
        width: '280px',
        height: '100%',
        overflowY: 'auto',
        background: cssVar.bg.base,
        borderRight: `1px solid ${cssVar.border.default}`,
        padding: '16px',
      }}
    >
      <Title level={5} style={{ marginBottom: '16px' }}>
        Node Palette
      </Title>

      <Space direction="vertical" size="middle" style={{ width: '100%' }}>
        {categoryOrder.map((category) => {
          const nodes = nodesByCategory[category];
          if (!nodes || nodes.length === 0) return null;

          return (
            <div key={category}>
              <Text
                type="secondary"
                style={{
                  fontSize: '12px',
                  fontWeight: 600,
                  textTransform: 'uppercase',
                  display: 'block',
                  marginBottom: '8px',
                }}
              >
                {categoryLabels[category]}
              </Text>

              <Space direction="vertical" size="small" style={{ width: '100%' }}>
                {nodes.map((node) => {
                  const disabled = !canAddNode(node.type);
                  const alreadyExists = existingNodeTypes.includes(node.type);

                  return (
                    <Tooltip
                      key={node.type}
                      title={
                        disabled
                          ? `${node.label} already exists (only one allowed)`
                          : node.description
                      }
                      placement="right"
                    >
                      <Card
                        size="small"
                        draggable={!disabled}
                        onDragStart={(e) => onDragStart(e, node.type)}
                        onClick={() => handleNodeClick(node.type)}
                        style={{
                          cursor: disabled ? 'not-allowed' : 'grab',
                          opacity: disabled ? 0.5 : 1,
                          borderLeft: `3px solid ${node.color}`,
                          transition: transitions.all,
                        }}
                        hoverable={!disabled}
                        styles={{
                          body: {
                            padding: '10px 12px',
                          },
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                          <div
                            style={{
                              fontSize: '18px',
                              color: node.color,
                              display: 'flex',
                              alignItems: 'center',
                            }}
                          >
                            {node.icon}
                          </div>

                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div
                              style={{
                                fontWeight: 600,
                                fontSize: '13px',
                                color: disabled ? '#8c8c8c' : '#262626',
                                marginBottom: '2px',
                              }}
                            >
                              {node.label}
                              {alreadyExists && node.type === 'trigger' && (
                                <Badge
                                  count={1}
                                  style={{
                                    marginLeft: '6px',
                                    backgroundColor: '#52c41a',
                                    fontSize: '10px',
                                  }}
                                />
                              )}
                            </div>
                            <div
                              style={{
                                fontSize: '11px',
                                color: '#8c8c8c',
                                lineHeight: '1.4',
                              }}
                            >
                              {node.description}
                            </div>
                          </div>
                        </div>
                      </Card>
                    </Tooltip>
                  );
                })}
              </Space>
            </div>
          );
        })}
      </Space>

      {/* Help text */}
      <div
        style={{
          marginTop: '24px',
          padding: '12px',
          background: cssVar.primary['50'],
          borderRadius: token.borderRadius,
          border: `1px solid ${cssVar.primary['300']}`,
        }}
      >
        <Text style={{ fontSize: '12px', color: cssVar.primary['700'] }}>
          <strong>Tip:</strong> Drag nodes onto the canvas or click to add them
        </Text>
      </div>
    </div>
  );
};

export default NodePalette;
