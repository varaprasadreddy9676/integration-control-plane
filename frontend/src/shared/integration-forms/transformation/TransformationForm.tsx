import { useState } from 'react';
import { Radio, Card, Space, Button, Alert, Typography, Divider, Row, Col } from 'antd';
import { CodeOutlined, LinkOutlined, ThunderboltOutlined, ReloadOutlined } from '@ant-design/icons';
import Editor from '@monaco-editor/react';
import { SimpleTransformationMapping } from './SimpleTransformationMapping';
import type { TransformationFormProps } from '../types';
import { cssVar } from '../../../design-system/utils';

const { Text, Paragraph } = Typography;

/**
 * Default transformation script template
 */
export const defaultTransformationScript = `function transform(payload, context) {
  /**
   * Transform the incoming event payload
   *
   * @param {object} payload - The event data
   * @param {object} context - Additional context (eventType, entityRid, etc.)
   * @returns {object} - Transformed payload for the target API
   *
   * Available utilities:
   * - parseDate(dateString): Parse date string
   * - formatDate(date, format): Format date
   * - generateUUID(): Generate UUID v4
   * - base64Encode(str): Base64 encode
   * - base64Decode(str): Base64 decode
   */

  // Example: Transform patient registration event
  return {
    patientName: payload.patientName,
    email: payload.patientEmail,
    phone: payload.patientPhone,
    registeredAt: new Date().toISOString()
  };
}`;

/**
 * TransformationForm - Shared transformation component
 *
 * Supports two modes:
 * - SIMPLE: Visual field mapping with drag-drop
 * - SCRIPT: JavaScript transformation with Monaco editor
 *
 * Can be used across outbound integrations, inbound integrations, and scheduled jobs.
 */
export const TransformationForm = ({
  form,
  mode,
  onModeChange,
  scriptValue,
  onScriptChange,
  mappingState,
  onMappingChange,
  availableFields = [],
  sampleInput = '',
  sampleOutput = 'Awaiting preview…',
  previewMeta,
  onPreview,
  spacing,
  colors,
  hideModeSelector = false
}: TransformationFormProps) => {
  const [editorTheme, setEditorTheme] = useState<'vs-dark' | 'light'>('vs-dark');

  const handleScriptChange = (value: string | undefined) => {
    if (value !== undefined) {
      onScriptChange(value);
    }
  };

  return (
    <Space direction="vertical" size="large" style={{ width: '100%' }}>
      {/* Mode Selection - Hidden for inbound integrations */}
      {!hideModeSelector && (
        <Card size="small">
          <Space direction="vertical" size="middle" style={{ width: '100%' }}>
            <div>
              <Text strong style={{ fontSize: 14 }}>Transformation Mode</Text>
              <Paragraph type="secondary" style={{ marginBottom: spacing[3], marginTop: spacing[1] }}>
                Choose how to transform the event payload before sending to the target API
              </Paragraph>
            </div>

            <Radio.Group
              value={mode}
              onChange={(e) => onModeChange(e.target.value)}
              buttonStyle="solid"
              size="large"
              style={{ width: '100%' }}
            >
              <Radio.Button value="SIMPLE" style={{ width: '50%', textAlign: 'center' }}>
                <Space>
                  <LinkOutlined />
                  <span>Simple Mapping</span>
                </Space>
              </Radio.Button>
              <Radio.Button value="SCRIPT" style={{ width: '50%', textAlign: 'center' }}>
                <Space>
                  <CodeOutlined />
                  <span>JavaScript Script</span>
                </Space>
              </Radio.Button>
            </Radio.Group>
          </Space>
        </Card>
      )}

      {/* SIMPLE Mode - Field Mapping */}
      {mode === 'SIMPLE' && (
        <Card
          title={
            <Space>
              <LinkOutlined style={{ color: colors.primary[600] }} />
              <span>Field Mapping</span>
            </Space>
          }
          extra={
            <Button
              type="link"
              icon={<ReloadOutlined />}
              onClick={() => onMappingChange({ mappings: [], staticFields: [] })}
            >
              Reset
            </Button>
          }
        >
          <SimpleTransformationMapping
            availableFields={availableFields}
            mappingState={mappingState}
            onMappingChange={onMappingChange}
            spacing={spacing}
            colors={colors}
          />
        </Card>
      )}

      {/* SCRIPT Mode - Monaco Editor */}
      {mode === 'SCRIPT' && (
        <Card
          title={
            <Space>
              <CodeOutlined style={{ color: colors.primary[600] }} />
              <span>JavaScript Transformation</span>
            </Space>
          }
          extra={
            <Space>
              <Button
                type="text"
                size="small"
                onClick={() => setEditorTheme(editorTheme === 'vs-dark' ? 'light' : 'vs-dark')}
              >
                {editorTheme === 'vs-dark' ? '☀️ Light' : '🌙 Dark'}
              </Button>
              <Button
                type="link"
                icon={<ReloadOutlined />}
                onClick={() => onScriptChange(defaultTransformationScript)}
              >
                Reset to Template
              </Button>
            </Space>
          }
        >
          <Space direction="vertical" size="middle" style={{ width: '100%' }}>
            <Alert
              type="info"
              showIcon
              message="Write a JavaScript function to transform the event payload"
              description="The function receives the event payload and context, and must return the transformed object for the target API."
            />

            <div style={{ border: `1px solid ${cssVar.border.default}`, borderRadius: 8, overflow: 'hidden' }}>
              <Editor
                height="400px"
                language="javascript"
                theme={editorTheme}
                value={scriptValue}
                onChange={handleScriptChange}
                options={{
                  minimap: { enabled: false },
                  fontSize: 14,
                  lineNumbers: 'on',
                  scrollBeyondLastLine: false,
                  wordWrap: 'on',
                  automaticLayout: true,
                  tabSize: 2,
                  insertSpaces: true,
                  formatOnPaste: true,
                  formatOnType: true
                }}
              />
            </div>
          </Space>
        </Card>
      )}

      {/* Preview Panel */}
      {onPreview && (
        <Card
          title={
            <Space>
              <ThunderboltOutlined style={{ color: colors.warning[600] }} />
              <span>Transformation Preview</span>
            </Space>
          }
          extra={
            <Button
              type="primary"
              icon={<ThunderboltOutlined />}
              onClick={onPreview}
            >
              Run Preview
            </Button>
          }
        >
          <Row gutter={[16, 16]}>
            <Col xs={24} md={12}>
              <div>
                <Text strong>Input (Sample Payload)</Text>
                <div
                  style={{
                    marginTop: spacing[2],
                    padding: spacing[3],
                    background: cssVar.bg.subtle,
                    borderRadius: 8,
                    fontFamily: 'monospace',
                    fontSize: 12,
                    maxHeight: 300,
                    overflow: 'auto',
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word'
                  }}
                >
                  {sampleInput || 'No sample input provided'}
                </div>
              </div>
            </Col>
            <Col xs={24} md={12}>
              <div>
                <Space>
                  <Text strong>Output (Transformed)</Text>
                  {previewMeta?.durationMs && (
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      ({previewMeta.durationMs}ms)
                    </Text>
                  )}
                </Space>
                <div
                  style={{
                    marginTop: spacing[2],
                    padding: spacing[3],
                    background: cssVar.bg.subtle,
                    borderRadius: 8,
                    fontFamily: 'monospace',
                    fontSize: 12,
                    maxHeight: 300,
                    overflow: 'auto',
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word'
                  }}
                >
                  {sampleOutput}
                </div>
              </div>
            </Col>
          </Row>
        </Card>
      )}
    </Space>
  );
};
