/**
 * Custom Node Components for ReactFlow
 *
 * Exports all custom node types for use in the Flow Builder canvas
 */

import React from 'react';
import type { NodeTypes } from 'reactflow';
import { BaseNode } from './BaseNode';
import type { BaseNodeProps } from './BaseNode';

// Since all our nodes share the same visual structure (just different data),
// we can use BaseNode for all node types

export const TriggerNode: React.FC<BaseNodeProps> = (props) => <BaseNode {...props} />;
export const InboundAuthNode: React.FC<BaseNodeProps> = (props) => <BaseNode {...props} />;
export const OutboundAuthNode: React.FC<BaseNodeProps> = (props) => <BaseNode {...props} />;
export const HttpNode: React.FC<BaseNodeProps> = (props) => <BaseNode {...props} />;
export const TransformNode: React.FC<BaseNodeProps> = (props) => <BaseNode {...props} />;
export const FilterNode: React.FC<BaseNodeProps> = (props) => <BaseNode {...props} />;
export const ScheduleScriptNode: React.FC<BaseNodeProps> = (props) => <BaseNode {...props} />;
export const DelayNode: React.FC<BaseNodeProps> = (props) => <BaseNode {...props} />;
export const MultiActionNode: React.FC<BaseNodeProps> = (props) => <BaseNode {...props} />;
export const ResponseNode: React.FC<BaseNodeProps> = (props) => <BaseNode {...props} />;
export const IntegrationNode: React.FC<BaseNodeProps> = (props) => <BaseNode {...props} />;

/**
 * Node types configuration for ReactFlow
 * Maps node type strings to React components
 */
export const nodeTypes: NodeTypes = {
  trigger: TriggerNode,
  inboundAuth: InboundAuthNode,
  outboundAuth: OutboundAuthNode,
  http: HttpNode,
  transform: TransformNode,
  filter: FilterNode,
  scheduleScript: ScheduleScriptNode,
  delay: DelayNode,
  multiAction: MultiActionNode,
  response: ResponseNode,
  integration: IntegrationNode,
};

// Re-export BaseNode for use in other components
export { BaseNode };
export type { BaseNodeProps };
