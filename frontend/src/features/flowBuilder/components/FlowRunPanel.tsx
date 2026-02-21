/**
 * Flow Run Panel Component
 *
 * Bottom panel showing test execution results and logs
 */

import React from 'react';
import {
  Drawer,
  Timeline,
  Typography,
  Space,
  Card,
  Tag,
  Button,
  Collapse,
  Empty,
  Alert,
} from 'antd';
import {
  CheckCircleOutlined,
  CloseCircleOutlined,
  ClockCircleOutlined,
  DownOutlined,
  CopyOutlined,
  CloseOutlined,
} from '@ant-design/icons';
import { cssVar } from '../../../design-system/utils';
import type { FlowExecutionResult, FlowExecutionStep } from '../state/flowTypes';

const { Text, Title } = Typography;
const { Panel } = Collapse;

export interface FlowRunPanelProps {
  visible: boolean;
  executionResult: FlowExecutionResult | null;
  onClose: () => void;
}

export const FlowRunPanel: React.FC<FlowRunPanelProps> = ({
  visible,
  executionResult,
  onClose,
}) => {
  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  const formatDuration = (ms: number): string => {
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(2)}s`;
  };

  const getStatusIcon = (status: 'success' | 'failed' | 'skipped') => {
    switch (status) {
      case 'success':
        return <CheckCircleOutlined style={{ color: '#52c41a' }} />;
      case 'failed':
        return <CloseCircleOutlined style={{ color: '#f5222d' }} />;
      case 'skipped':
        return <ClockCircleOutlined style={{ color: '#8c8c8c' }} />;
    }
  };

  const getStatusColor = (status: 'success' | 'failed' | 'skipped') => {
    switch (status) {
      case 'success':
        return 'success';
      case 'failed':
        return 'error';
      case 'skipped':
        return 'default';
    }
  };

  return (
    <Drawer
      title={
        <Space>
          <Title level={5} style={{ margin: 0 }}>
            Test Execution Results
          </Title>
          {executionResult && (
            <Tag color={executionResult.success ? 'success' : 'error'}>
              {executionResult.success ? 'SUCCESS' : 'FAILED'}
            </Tag>
          )}
        </Space>
      }
      placement="bottom"
      onClose={onClose}
      open={visible}
      height="50vh"
      extra={
        <Button
          type="text"
          icon={<CloseOutlined />}
          onClick={onClose}
        />
      }
    >
      {!executionResult ? (
        <Empty
          description="No test execution results available"
          style={{ marginTop: '50px' }}
        />
      ) : (
        <div style={{ padding: '0 24px' }}>
          {/* Summary */}
          <Card
            size="small"
            style={{ marginBottom: '24px' }}
            styles={{
              body: {
                background: executionResult.success ? cssVar.success.bg : cssVar.error.bg
              },
            }}
          >
            <Space direction="vertical" style={{ width: '100%' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <Space>
                  <Text strong>Total Execution Time:</Text>
                  <Text>{formatDuration(executionResult.executionTime)}</Text>
                </Space>
                <Space>
                  <Text strong>Steps:</Text>
                  <Text>{executionResult.steps.length}</Text>
                </Space>
              </div>

              {executionResult.error && (
                <Alert
                  message="Execution Error"
                  description={
                    <div>
                      <div style={{ marginBottom: '8px' }}>
                        <strong>Message:</strong> {executionResult.error.message}
                      </div>
                      {executionResult.error.nodeId && (
                        <div style={{ marginBottom: '8px' }}>
                          <strong>Node ID:</strong> {executionResult.error.nodeId}
                        </div>
                      )}
                      {executionResult.error.stack && (
                        <details>
                          <summary style={{ cursor: 'pointer', marginTop: '8px' }}>
                            View Stack Trace
                          </summary>
                          <pre
                            className="clamped-code-block"
                            style={{
                              fontSize: '11px',
                              background: cssVar.bg.overlay,
                              color: cssVar.text.primary,
                              padding: '8px',
                              borderRadius: '4px',
                              marginTop: '8px',
                              overflow: 'auto',
                            }}
                          >
                            {executionResult.error.stack}
                          </pre>
                        </details>
                      )}
                    </div>
                  }
                  type="error"
                  showIcon
                />
              )}

              {executionResult.output && (
                <div>
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      marginBottom: '8px',
                    }}
                  >
                    <Text strong>Output:</Text>
                    <Button
                      size="small"
                      icon={<CopyOutlined />}
                      onClick={() =>
                        copyToClipboard(JSON.stringify(executionResult.output, null, 2))
                      }
                    >
                      Copy
                    </Button>
                  </div>
                  <pre
                    className="clamped-code-block"
                    style={{
                      background: cssVar.bg.base,
                      padding: '12px',
                      borderRadius: '4px',
                      overflow: 'auto',
                      maxHeight: '200px',
                      fontSize: '12px',
                      fontFamily: 'monospace',
                    }}
                  >
                    {JSON.stringify(executionResult.output, null, 2)}
                  </pre>
                </div>
              )}
            </Space>
          </Card>

          {/* Execution steps timeline */}
          <Title level={5} style={{ marginBottom: '16px' }}>
            Execution Steps
          </Title>

          <Timeline
            items={executionResult.steps.map((step, index) => ({
              dot: getStatusIcon(step.status),
              color: getStatusColor(step.status),
              children: (
                <Card
                  key={index}
                  size="small"
                  style={{
                    marginBottom: '8px',
                    borderLeft: `3px solid ${
                      step.status === 'success'
                        ? cssVar.success.text
                        : step.status === 'failed'
                        ? cssVar.error.text
                        : cssVar.border.default
                    }`,
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      marginBottom: '8px',
                    }}
                  >
                    <Space>
                      <Text strong>{step.nodeType}</Text>
                      <Tag color={getStatusColor(step.status)}>
                        {step.status.toUpperCase()}
                      </Tag>
                    </Space>
                    <Text type="secondary">{formatDuration(step.durationMs)}</Text>
                  </div>

                  <Text type="secondary" style={{ fontSize: '12px' }}>
                    Node ID: {step.nodeId}
                  </Text>

                  {step.error && (
                    <Alert
                      message={step.error}
                      type="error"
                      showIcon
                      style={{ marginTop: '8px' }}
                    />
                  )}

                  {(step.input || step.output) && (
                    <Collapse
                      ghost
                      style={{ marginTop: '8px' }}
                      expandIcon={({ isActive }) => (
                        <DownOutlined rotate={isActive ? 180 : 0} />
                      )}
                    >
                      {step.input && (
                        <Panel
                          header={<Text type="secondary">Input Data</Text>}
                          key="input"
                        >
                          <pre
                            className="clamped-code-block"
                            style={{
                              background: cssVar.bg.base,
                              padding: '8px',
                              borderRadius: '4px',
                              overflow: 'auto',
                              maxHeight: '150px',
                              fontSize: '11px',
                              fontFamily: 'monospace',
                              margin: 0,
                            }}
                          >
                            {JSON.stringify(step.input, null, 2)}
                          </pre>
                        </Panel>
                      )}

                      {step.output && (
                        <Panel
                          header={<Text type="secondary">Output Data</Text>}
                          key="output"
                        >
                          <pre
                            className="clamped-code-block"
                            style={{
                              background: cssVar.bg.base,
                              padding: '8px',
                              borderRadius: '4px',
                              overflow: 'auto',
                              maxHeight: '150px',
                              fontSize: '11px',
                              fontFamily: 'monospace',
                              margin: 0,
                            }}
                          >
                            {JSON.stringify(step.output, null, 2)}
                          </pre>
                        </Panel>
                      )}
                    </Collapse>
                  )}
                </Card>
              ),
            }))}
          />
        </div>
      )}
    </Drawer>
  );
};

export default FlowRunPanel;
