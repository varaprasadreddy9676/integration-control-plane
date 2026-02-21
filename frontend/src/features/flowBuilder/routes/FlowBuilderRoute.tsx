/**
 * Flow Builder Route Component
 *
 * Main page wrapper for the visual flow builder
 */

import React from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { message, Modal } from 'antd';
import { ReactFlowProvider } from 'reactflow';
import { cssVar } from '../../../design-system/utils';

import FlowCanvas from '../components/FlowCanvas';
import NodePalette from '../components/NodePalette';
import InspectorPanel from '../components/InspectorPanel';
import FlowTopBar from '../components/FlowTopBar';
import FlowRunPanel from '../components/FlowRunPanel';

import type {
  FlowState,
  FlowNode,
  FlowEdge,
  FlowNodeType,
  FlowNodeData,
  IntegrationMode,
  FlowExecutionResult,
} from '../state/flowTypes';
import { createDefaultFlow } from '../state/flowSchema';
import { validateFlow } from '../state/validateFlow';
import { flowToPayload, generatePayloadPreview } from '../state/flowToPayload';
import { payloadToFlow } from '../state/payloadToFlow';
import { useIntegrationConfig } from '../../../hooks/useIntegrationConfig';
import {
  createInboundIntegration,
  updateInboundIntegration,
  testInboundIntegration,
  createOutboundIntegrationRaw,
  updateOutboundIntegrationRaw,
  testIntegration,
  testOutboundSchedule
} from '../../../services/api';

export const FlowBuilderRoute: React.FC = () => {
  const navigate = useNavigate();
  const { integrationId } = useParams<{ integrationId?: string }>();
  const [searchParams] = useSearchParams();

  // Get mode and orgId from query params
  const mode = (searchParams.get('mode') as IntegrationMode) || 'INBOUND';
  const orgId = parseInt(searchParams.get('orgId') || '100', 10);

  // Local state
  const [flowState, setFlowState] = React.useState<FlowState>(() => {
    const defaultFlow = createDefaultFlow(mode, orgId, 'New Integration');
    return {
      ...defaultFlow,
      name: 'New Integration',
      mode,
      orgId,
      isValid: false,
      errors: [],
      warnings: [],
      isDirty: false,
      rateLimits: {
        enabled: false,
        maxRequests: 100,
        windowSeconds: 60,
      },
      isActive: true,
    };
  });

  const [selectedNodeId, setSelectedNodeId] = React.useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = React.useState<string | null>(null);
  const [isSaving, setIsSaving] = React.useState(false);
  const [isTesting, setIsTesting] = React.useState(false);
  const [testResult, setTestResult] = React.useState<FlowExecutionResult | null>(null);
  const [showTestPanel, setShowTestPanel] = React.useState(false);

  // Load existing integration if editing
  const { data: existingIntegration, isLoading } = useIntegrationConfig(
    integrationId,
    mode
  );

  React.useEffect(() => {
    if (existingIntegration && !isLoading) {
      // Convert existing integration to flow state
      const convertedFlow = payloadToFlow(existingIntegration, integrationId);
      setFlowState(convertedFlow);
    }
  }, [existingIntegration, isLoading, integrationId]);

  // Validate flow whenever it changes
  const validation = React.useMemo(() => {
    return validateFlow(flowState);
  }, [flowState]);

  // Update flow state isValid based on validation
  React.useEffect(() => {
    setFlowState((prev) => ({
      ...prev,
      isValid: validation.isValid,
      errors: validation.errors.map((e) => e.message),
      warnings: validation.warnings.map((w) => w.message),
    }));
  }, [validation]);

  // Get selected node
  const selectedNode = React.useMemo(() => {
    if (!selectedNodeId) return null;
    return flowState.nodes.find((n) => n.id === selectedNodeId) || null;
  }, [selectedNodeId, flowState.nodes]);

  // Handle adding new node
  const handleAddNode = (nodeType: FlowNodeType) => {
    const newNodeId = `${nodeType}-${Date.now()}`;

    // Calculate position for new node
    const existingNodes = flowState.nodes.filter((n) => n.type === nodeType);
    const xOffset = existingNodes.length * 50;
    const yOffset = existingNodes.length * 50;

    const createNodeData = (type: FlowNodeType): FlowNodeData => {
      const common = {
        nodeType: type,
        label: `New ${type}`,
        description: '',
        isValid: false,
        errors: [],
      };

      switch (type) {
        case 'http':
          return { ...common, nodeType: 'http', url: '', method: 'GET' } as any;
        case 'integration':
          return { ...common, nodeType: 'integration', url: '', method: 'POST' } as any;
        case 'trigger':
          return { ...common, nodeType: 'trigger', triggerType: mode } as any;
        case 'inboundAuth':
          return { ...common, nodeType: 'inboundAuth', authType: 'NONE' } as any;
        case 'outboundAuth':
          return { ...common, nodeType: 'outboundAuth', authType: 'NONE' } as any;
        case 'transform':
          return { ...common, nodeType: 'transform', transformMode: 'NONE', transformDirection: 'request' } as any;
        case 'filter':
          return { ...common, nodeType: 'filter', conditions: [], matchMode: 'all' } as any;
        case 'delay':
          return { ...common, nodeType: 'delay', delayType: 'FIXED', delayMs: 1000 } as any;
        case 'multiAction':
          return { ...common, nodeType: 'multiAction', executeInParallel: true, continueOnError: true, actions: [] } as any;
        case 'response':
          return { ...common, nodeType: 'response', statusCode: 200, bodyType: 'json' } as any;
        case 'scheduleScript':
          return { ...common, nodeType: 'scheduleScript', script: '' } as any;
        default:
          return common as any;
      }
    };

    const baseData = createNodeData(nodeType);

    const newNode: FlowNode = {
      id: newNodeId,
      type: nodeType,
      position: { x: 400 + xOffset, y: 300 + yOffset },
      data: baseData,
    };

    setFlowState((prev) => ({
      ...prev,
      nodes: [...prev.nodes, newNode],
      isDirty: true,
    }));

    // Auto-select the new node
    setSelectedNodeId(newNodeId);

    message.success(`Added ${nodeType} node`);
  };

  // Handle node updates
  const handleNodesChange = (newNodes: FlowNode[]) => {
    setFlowState((prev) => ({
      ...prev,
      nodes: newNodes,
      isDirty: true,
    }));
  };

  // Handle edge updates
  const handleEdgesChange = (newEdges: FlowEdge[]) => {
    setFlowState((prev) => ({
      ...prev,
      edges: newEdges,
      isDirty: true,
    }));
  };

  // Handle node property updates
  const handleUpdateNode = (nodeId: string, updates: Partial<Omit<FlowNodeData, 'nodeType'>>) => {
    setFlowState((prev) => ({
      ...prev,
      nodes: prev.nodes.map((node) =>
        node.id === nodeId
          ? {
            ...node,
            data: ({
              ...node.data,
              ...updates,
              // Prevent accidentally changing the discriminant for a union type.
              nodeType: node.data.nodeType
            } as FlowNodeData)
          }
          : node
      ),
      isDirty: true,
    }));
  };

  // Handle node deletion
  const handleDeleteNode = (nodeId: string) => {
    setFlowState((prev) => ({
      ...prev,
      nodes: prev.nodes.filter((n) => n.id !== nodeId),
      edges: prev.edges.filter((e) => e.source !== nodeId && e.target !== nodeId),
      isDirty: true,
    }));

    if (selectedNodeId === nodeId) {
      setSelectedNodeId(null);
    }

    message.success('Node deleted');
  };

  // Handle node duplication
  const handleDuplicateNode = (nodeId: string) => {
    const nodeToDuplicate = flowState.nodes.find((n) => n.id === nodeId);
    if (!nodeToDuplicate) return;

    const newNodeId = `${nodeToDuplicate.type}-${Date.now()}`;
    const newNode: FlowNode = {
      ...nodeToDuplicate,
      id: newNodeId,
      position: {
        x: nodeToDuplicate.position.x + 50,
        y: nodeToDuplicate.position.y + 50,
      },
      data: {
        ...nodeToDuplicate.data,
        label: `${nodeToDuplicate.data.label} (Copy)`,
      },
    };

    setFlowState((prev) => ({
      ...prev,
      nodes: [...prev.nodes, newNode],
      isDirty: true,
    }));

    message.success('Node duplicated');
  };

  // Handle save
  const handleSave = async () => {
    if (!validation.isValid) {
      message.error('Please fix validation errors before saving');
      return;
    }

    setIsSaving(true);

    try {
      const payload = flowToPayload(flowState, orgId);

      if (flowState.mode === 'INBOUND') {
        if (integrationId) {
          await updateInboundIntegration(integrationId, payload);
        } else {
          const created = await createInboundIntegration(payload as any);
          const newId = created?.id || created?._id;
          if (newId) {
            navigate(`/flow-builder/${newId}?mode=${mode}&orgId=${orgId}`);
          }
        }
      } else {
        if (integrationId) {
          await updateOutboundIntegrationRaw(integrationId, payload);
        } else {
          const created = await createOutboundIntegrationRaw(payload);
          const newId = created?.id || created?._id;
          if (newId) {
            navigate(`/flow-builder/${newId}?mode=${mode}&orgId=${orgId}`);
          }
        }
      }

      setFlowState((prev) => ({ ...prev, isDirty: false }));
      message.success('Integration saved successfully');
    } catch (error) {
      console.error('Failed to save integration:', error);
      message.error('Failed to save integration');
    } finally {
      setIsSaving(false);
    }
  };

  // Handle test
  const handleTest = async () => {
    if (!validation.isValid) {
      message.error('Please fix validation errors before testing');
      return;
    }

    if (!integrationId) {
      message.error('Please save the integration before testing');
      return;
    }

    setIsTesting(true);
    setShowTestPanel(true);

    try {
      const payload = flowToPayload(flowState, orgId);
      let result: any = null;

      if (flowState.mode === 'INBOUND') {
        result = await testInboundIntegration(integrationId);
        const duration = Number(String(result?.responseTime || '').replace('ms', '')) || 0;
        const success = result?.success !== false;
        setTestResult({
          success,
          executionTime: duration,
          steps: [
            {
              nodeId: 'http',
              nodeType: 'http',
              status: success ? 'success' : 'failed',
              durationMs: duration,
              output: result?.response
            }
          ],
          output: result?.response
        });
        if (success) {
          message.success('Test completed successfully');
        } else {
          message.error('Test failed');
        }
      } else if (flowState.mode === 'OUTBOUND_SCHEDULED') {
        const scheduleScript = payload.schedulingConfig?.script || '';
        if (!scheduleScript) {
          throw new Error('Schedule script is required for scheduled integrations');
        }
        const deliveryMode = payload.deliveryMode || 'RECURRING';
        result = await testOutboundSchedule(integrationId, {
          script: scheduleScript,
          deliveryMode,
          eventType: payload.type || payload.eventType,
          payload: { sample: true, testMode: true, timestamp: new Date().toISOString() }
        });
        setTestResult({
          success: true,
          executionTime: 0,
          steps: [
            {
              nodeId: 'schedule',
              nodeType: 'scheduleScript',
              status: 'success',
              durationMs: 0,
              output: result
            }
          ],
          output: result
        });
        message.success('Test completed successfully');
      } else {
        result = await testIntegration(integrationId);
        const duration = result?.responseTimeMs || 0;
        const success = result?.status === 'success';
        setTestResult({
          success,
          executionTime: duration,
          steps: [
            {
              nodeId: 'integration',
              nodeType: 'integration',
              status: success ? 'success' : 'failed',
              durationMs: duration,
              output: result?.responseBody
            }
          ],
          output: result
        });
        if (success) {
          message.success('Test completed successfully');
        } else {
          message.error('Test failed');
        }
      }
    } catch (error) {
      console.error('Failed to test integration:', error);

      const errorResult: FlowExecutionResult = {
        success: false,
        executionTime: 500,
        steps: [],
        error: {
          message: 'Test execution failed',
          stack: (error as Error).stack,
        },
      };

      setTestResult(errorResult);
      message.error('Test execution failed');
    } finally {
      setIsTesting(false);
    }
  };

  // Handle preview
  const handlePreview = () => {
    const preview = generatePayloadPreview(flowState, orgId);

    Modal.info({
      title: 'Backend Payload Preview',
      content: (
        <pre
          style={{
            background: cssVar.bg.base,
            padding: '12px',
            borderRadius: '4px',
            overflow: 'auto',
            maxHeight: '60vh',
            fontSize: '12px',
            fontFamily: 'monospace',
          }}
        >
          {preview}
        </pre>
      ),
      width: 800,
      okText: 'Close',
    });
  };

  // Handle back navigation
  const handleBack = () => {
    if (flowState.isDirty) {
      Modal.confirm({
        title: 'Unsaved Changes',
        content: 'You have unsaved changes. Are you sure you want to leave?',
        onOk: () => navigate('/integrations'),
      });
    } else {
      navigate('/integrations');
    }
  };

  // Handle name change
  const handleNameChange = (name: string) => {
    setFlowState((prev) => ({
      ...prev,
      name,
      isDirty: true,
    }));
  };

  // Handle active toggle
  const handleActiveToggle = (isActive: boolean) => {
    setFlowState((prev) => ({
      ...prev,
      isActive,
      isDirty: true,
    }));
  };

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
      {/* Top bar */}
      <FlowTopBar
        flowState={flowState}
        validation={validation}
        isDirty={flowState.isDirty}
        isSaving={isSaving}
        isTesting={isTesting}
        onSave={handleSave}
        onTest={handleTest}
        onPreview={handlePreview}
        onBack={handleBack}
        onNameChange={handleNameChange}
        onActiveToggle={handleActiveToggle}
      />

      {/* Main content area */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {/* Node palette (left sidebar) */}
        <NodePalette
          mode={mode}
          onAddNode={handleAddNode}
          existingNodeTypes={flowState.nodes.map((n) => n.type as FlowNodeType)}
        />

        {/* Canvas (center) */}
        <div style={{ flex: 1, position: 'relative' }}>
          <ReactFlowProvider>
            <FlowCanvas
              nodes={flowState.nodes}
              edges={flowState.edges}
              mode={mode}
              onNodesChange={handleNodesChange}
              onEdgesChange={handleEdgesChange}
              onNodeSelect={setSelectedNodeId}
              onEdgeSelect={setSelectedEdgeId}
            />
          </ReactFlowProvider>
        </div>

        {/* Inspector panel (right sidebar) */}
        <InspectorPanel
          selectedNode={selectedNode}
          onUpdateNode={handleUpdateNode}
          onDeleteNode={handleDeleteNode}
          onDuplicateNode={handleDuplicateNode}
        />
      </div>

      {/* Test run panel (bottom drawer) */}
      <FlowRunPanel
        visible={showTestPanel}
        executionResult={testResult}
        onClose={() => setShowTestPanel(false)}
      />
    </div>
  );
};

export default FlowBuilderRoute;
