/**
 * AI Assistant Modal
 * Helps users generate transformation scripts using AI
 */

import { useState, useEffect, useRef, useMemo } from 'react';
import {
  Modal,
  Tabs,
  Button,
  Input,
  Select,
  Space,
  Typography,
  Alert,
  Divider,
  Tag,
  Spin,
  Flex,
  Collapse,
  message as antMessage
} from 'antd';
import {
  BulbOutlined,
  FileTextOutlined,
  ThunderboltOutlined,
  CopyOutlined,
  CheckOutlined,
  RocketOutlined,
  WarningOutlined,
  StopOutlined,
  InfoCircleOutlined
} from '@ant-design/icons';
import Editor from '@monaco-editor/react';
import { useDesignTokens, withAlpha, spacingToNumber, cssVar } from '../../../design-system/utils';
import { useTenant } from '../../../app/tenant-context';
import { SplitText } from '../../../components/SplitText';
import {
  generateTransformation,
  analyzeDocumentation,
  checkAIStatus,
  AIRateLimitError,
  AIServiceUnavailableError,
  handleAIError,
  type AITransformationResponse,
  type AIDocumentationResponse
} from '../../../services/ai-api';

const { TextArea } = Input;
const { Text, Title } = Typography;

interface Props {
  visible: boolean;
  onCancel: () => void;
  onApply: (script: string) => void;
  eventTypes?: string[];
  defaultEventType?: string;
}

type TabKey = 'examples' | 'documentation';

export const AIAssistantModal = ({
  visible,
  onCancel,
  onApply,
  eventTypes = [],
  defaultEventType
}: Props) => {
  const { orgId } = useTenant();
  const { spacing, token } = useDesignTokens();
  const colors = cssVar.legacy;
  const [activeTab, setActiveTab] = useState<TabKey>('examples');
  const [loading, setLoading] = useState(false);
  const [loadingStatus, setLoadingStatus] = useState<string>('');
  const [abortController, setAbortController] = useState<AbortController | null>(null);
  const progressTimerRef = useRef<number | null>(null);
  const progressTimer2Ref = useRef<number | null>(null);
  const [generatedScript, setGeneratedScript] = useState<string>('');
  const [generatedConfig, setGeneratedConfig] = useState<any>(null);
  const [rateLimit, setRateLimit] = useState<{ usage: number; limit: number; remaining: number } | null>(null);

  // LocalStorage keys
  const STORAGE_KEY_INPUT = 'ai-assistant-input-example';
  const STORAGE_KEY_OUTPUT = 'ai-assistant-output-example';
  const STORAGE_KEY_DOCS = 'ai-assistant-documentation';

  // Load from localStorage or use defaults
  const getStoredValue = (key: string, defaultValue: string) => {
    try {
      const stored = localStorage.getItem(key);
      return stored || defaultValue;
    } catch {
      return defaultValue;
    }
  };

  const defaultInputExample = JSON.stringify(
    {
      type: 'PATIENT_REGISTERED',
      patient: {
        mrn: { documentNumber: 'MRN123' },
        fullName: 'John Doe',
        phone: '9876543210',
        email: 'john@example.com'
      }
    },
    null,
    2
  );

  const defaultOutputExample = JSON.stringify(
    {
      patient_id: 'MRN123',
      name: 'John Doe',
      contact: '+919876543210',
      email: 'john@example.com'
    },
    null,
    2
  );

  // Examples mode state
  const [inputExample, setInputExample] = useState(getStoredValue(STORAGE_KEY_INPUT, defaultInputExample));
  const [outputExample, setOutputExample] = useState(getStoredValue(STORAGE_KEY_OUTPUT, defaultOutputExample));
  const [selectedEventType, setSelectedEventType] = useState(defaultEventType || '');

  // Documentation mode state
  const [documentation, setDocumentation] = useState(getStoredValue(STORAGE_KEY_DOCS, ''));
  const [docEventType, setDocEventType] = useState(defaultEventType || '');

  // Save to localStorage when values change
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY_INPUT, inputExample);
    } catch {}
  }, [inputExample]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY_OUTPUT, outputExample);
    } catch {}
  }, [outputExample]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY_DOCS, documentation);
    } catch {}
  }, [documentation]);

  const [copied, setCopied] = useState(false);

  // Check if AI is available
  const [aiStatus, setAiStatus] = useState<{ available: boolean; provider: string } | null>(null);

  useEffect(() => {
    if (visible && orgId) {
      checkAIStatus(orgId)
        .then((status) => setAiStatus(status))
        .catch(() => setAiStatus({ available: false, provider: '' }));
    }
  }, [visible, orgId]);

  useEffect(() => {
    return () => {
      if (progressTimerRef.current) {
        clearTimeout(progressTimerRef.current);
      }
      if (progressTimer2Ref.current) {
        clearTimeout(progressTimer2Ref.current);
      }
    };
  }, []);

  const handleGenerateFromExamples = async () => {
    if (!orgId) {
      antMessage.error('Entity not found');
      return;
    }

    try {
      const input = JSON.parse(inputExample);
      const output = JSON.parse(outputExample);

      setLoading(true);
      setLoadingStatus('Analyzing examples...');

      // Create abort controller
      const controller = new AbortController();
      setAbortController(controller);

      // Simulate progress updates
      const progressTimer = window.setTimeout(() => {
        setLoadingStatus('Generating transformation code...');
      }, 2000);
      progressTimerRef.current = progressTimer;

      const response: AITransformationResponse = await generateTransformation(orgId, {
        inputExample: input,
        outputExample: output,
        eventType: selectedEventType || undefined
      }, controller.signal);

      if (progressTimerRef.current) {
        clearTimeout(progressTimerRef.current);
        progressTimerRef.current = null;
      }
      setGeneratedScript(response.script);
      setGeneratedConfig(null); // Clear doc config
      setRateLimit(response.rateLimit);
      antMessage.success('Transformation script generated!');
    } catch (error: any) {
      if (error.name === 'AbortError') {
        antMessage.info('Generation cancelled');
        return;
      }

      if (error.name === 'SyntaxError') {
        antMessage.error('Invalid JSON in input or output examples');
        return;
      }

      try {
        handleAIError(error);
      } catch (aiError: any) {
        if (aiError instanceof AIRateLimitError) {
          antMessage.error(`Rate limit exceeded: ${aiError.usage}/${aiError.limit} requests used today`);
          setRateLimit({ usage: aiError.usage, limit: aiError.limit, remaining: 0 });
        } else if (aiError instanceof AIServiceUnavailableError) {
          antMessage.error(aiError.message);
        } else {
          antMessage.error(error.response?.data?.error || 'Failed to generate transformation');
        }
      }
    } finally {
      if (progressTimerRef.current) {
        clearTimeout(progressTimerRef.current);
        progressTimerRef.current = null;
      }
      setLoading(false);
      setLoadingStatus('');
      setAbortController(null);
    }
  };

  const handleCancelGeneration = () => {
    if (abortController) {
      abortController.abort();
      setLoading(false);
      setLoadingStatus('');
      setAbortController(null);
    }
  };

  const handleGenerateFromDocumentation = async () => {
    if (!orgId) {
      antMessage.error('Entity not found');
      return;
    }

    if (!documentation.trim()) {
      antMessage.error('Please provide API documentation');
      return;
    }

    try {
      setLoading(true);
      setLoadingStatus('Reading documentation...');

      // Create abort controller
      const controller = new AbortController();
      setAbortController(controller);

      // Simulate progress updates
      const progressTimer = window.setTimeout(() => {
        setLoadingStatus('Analyzing API structure...');
      }, 2000);

      const progressTimer2 = window.setTimeout(() => {
        setLoadingStatus('Generating configuration...');
      }, 4000);
      progressTimerRef.current = progressTimer;
      progressTimer2Ref.current = progressTimer2;

      const response: AIDocumentationResponse = await analyzeDocumentation(orgId, {
        documentation: documentation.trim(),
        eventType: docEventType || undefined
      }, controller.signal);

      if (progressTimerRef.current) {
        clearTimeout(progressTimerRef.current);
        progressTimerRef.current = null;
      }
      if (progressTimer2Ref.current) {
        clearTimeout(progressTimer2Ref.current);
        progressTimer2Ref.current = null;
      }

      setGeneratedScript(response.config.transformationScript);
      setGeneratedConfig(response.config); // Save full config
      setRateLimit(response.rateLimit);

      // Show analysis summary
      antMessage.success(
        <div>
          <div>Configuration generated with {response.config.confidence}% confidence!</div>
          {response.config.notes && <div style={{ fontSize: 12, marginTop: 4 }}>{response.config.notes}</div>}
        </div>,
        5
      );
    } catch (error: any) {
      if (error.name === 'AbortError') {
        antMessage.info('Analysis cancelled');
        return;
      }

      try {
        handleAIError(error);
      } catch (aiError: any) {
        if (aiError instanceof AIRateLimitError) {
          antMessage.error(`Rate limit exceeded: ${aiError.usage}/${aiError.limit} requests used today`);
          setRateLimit({ usage: aiError.usage, limit: aiError.limit, remaining: 0 });
        } else if (aiError instanceof AIServiceUnavailableError) {
          antMessage.error(aiError.message);
        } else {
          antMessage.error(error.response?.data?.error || 'Failed to analyze documentation');
        }
      }
    } finally {
      if (progressTimerRef.current) {
        clearTimeout(progressTimerRef.current);
        progressTimerRef.current = null;
      }
      if (progressTimer2Ref.current) {
        clearTimeout(progressTimer2Ref.current);
        progressTimer2Ref.current = null;
      }
      setLoading(false);
      setLoadingStatus('');
      setAbortController(null);
    }
  };

  const handleCopyScript = () => {
    navigator.clipboard.writeText(generatedScript);
    setCopied(true);
    antMessage.success('Copied to clipboard');
    setTimeout(() => setCopied(false), 2000);
  };

  const handleApplyScript = () => {
    onApply(generatedScript);
    antMessage.success('Script applied to transformation');
    onCancel();
  };

  const handleReset = () => {
    setGeneratedScript('');
    setInputExample(
      JSON.stringify(
        {
          type: 'PATIENT_REGISTERED',
          patient: {
            mrn: { documentNumber: 'MRN123' },
            fullName: 'John Doe',
            phone: '9876543210'
          }
        },
        null,
        2
      )
    );
    setOutputExample(
      JSON.stringify(
        {
          patient_id: 'MRN123',
          name: 'John Doe',
          contact: '+919876543210'
        },
        null,
        2
      )
    );
    setDocumentation('');
    try {
      localStorage.removeItem(STORAGE_KEY_INPUT);
      localStorage.removeItem(STORAGE_KEY_OUTPUT);
      localStorage.removeItem(STORAGE_KEY_DOCS);
    } catch {}
  };

  if (!aiStatus) {
    return null;
  }

  const isRateLimited = !!rateLimit && rateLimit.remaining === 0;

  return (
    <Modal
      title={
        <Space>
          <RocketOutlined style={{ color: colors.primary[500] }} />
          <SplitText
            text="AI Assistant"
            tag="span"
            delay={40}
            duration={0.7}
            ease="power3.out"
            splitType="chars"
            from={{ opacity: 0, transform: 'translate3d(0,8px,0)' }}
            to={{ opacity: 1, transform: 'translate3d(0,0,0)' }}
            threshold={0.1}
            rootMargin="-100px"
            textAlign="left"
            showCallback={false}
          />
          {aiStatus && (
            <Tag color="blue" style={{ fontSize: 11, marginLeft: 8 }}>
              {aiStatus.provider.toUpperCase()}
            </Tag>
          )}
        </Space>
      }
      open={visible}
      onCancel={onCancel}
      width={900}
      footer={null}
      styles={{ body: { padding: spacing[4] } }}
    >
      {/* AI Status Alert */}
      {!aiStatus.available && (
        <Alert
          type="warning"
          message="AI service is not enabled"
          description="Contact your administrator to enable AI-powered features."
          showIcon
          icon={<WarningOutlined />}
          style={{ marginBottom: spacing[3] }}
        />
      )}

      {/* Rate Limit Indicator */}
      {rateLimit && (
        <Alert
          type={isRateLimited ? 'error' : 'info'}
          message={
            <Space size={4}>
              <Text strong>
                AI Usage: {rateLimit.usage}/{rateLimit.limit}
              </Text>
              <Text type="secondary">({rateLimit.remaining} remaining today)</Text>
            </Space>
          }
          showIcon
          style={{ marginBottom: spacing[3] }}
        />
      )}

      {/* Loading Status with Cancel Button */}
      {loading && loadingStatus && (
        <Alert
          type="info"
          message={
            <Flex justify="space-between" align="center">
              <Space>
                <Spin size="small" />
                <Text>{loadingStatus}</Text>
              </Space>
              <Button size="small" icon={<StopOutlined />} onClick={handleCancelGeneration}>
                Cancel
              </Button>
            </Flex>
          }
          style={{ marginBottom: spacing[3] }}
        />
      )}

      <Tabs
        activeKey={activeTab}
        onChange={(key) => setActiveTab(key as TabKey)}
        items={[
          {
            key: 'examples',
            label: (
              <Space>
                <BulbOutlined />
                From Examples
              </Space>
            ),
            children: (
              <Space direction="vertical" size={spacingToNumber(spacing[3])} style={{ width: '100%' }}>
                <Alert
                  type="info"
                  message="Provide example input and desired output. AI will generate the transformation script."
                  showIcon
                  style={{ fontSize: 12 }}
                />

                {/* Event Type Selector */}
                {eventTypes.length > 0 && (
                  <div>
                    <Text strong style={{ display: 'block', marginBottom: spacing[1] }}>
                      Event Type (optional)
                    </Text>
                    <Select
                      placeholder="Select event type"
                      style={{ width: '100%' }}
                      value={selectedEventType}
                      onChange={setSelectedEventType}
                      allowClear
                      showSearch
                      options={eventTypes.map((et) => ({ value: et, label: et }))}
                    />
                  </div>
                )}

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: spacing[3] }}>
                  <div>
                    <Text strong style={{ display: 'block', marginBottom: spacing[1] }}>
                      Input Example
                    </Text>
                    <div
                      style={{
                        border: `1px solid ${cssVar.border.default}`,
                        borderRadius: token.borderRadius,
                        overflow: 'hidden'
                      }}
                    >
                      <Editor
                        height="250px"
                        language="json"
                        value={inputExample}
                        onChange={(value) => setInputExample(value || '')}
                        options={{
                          minimap: { enabled: false },
                          fontSize: 12,
                          lineNumbers: 'off',
                          folding: false,
                          wordWrap: 'on'
                        }}
                        theme="vs-dark"
                      />
                    </div>
                  </div>

                  <div>
                    <Text strong style={{ display: 'block', marginBottom: spacing[1] }}>
                      Desired Output
                    </Text>
                    <div
                      style={{
                        border: `1px solid ${cssVar.border.default}`,
                        borderRadius: token.borderRadius,
                        overflow: 'hidden'
                      }}
                    >
                      <Editor
                        height="250px"
                        language="json"
                        value={outputExample}
                        onChange={(value) => setOutputExample(value || '')}
                        options={{
                          minimap: { enabled: false },
                          fontSize: 12,
                          lineNumbers: 'off',
                          folding: false,
                          wordWrap: 'on'
                        }}
                        theme="vs-dark"
                      />
                    </div>
                  </div>
                </div>

                <Button
                  type="primary"
                  icon={<ThunderboltOutlined />}
                  loading={loading}
                  onClick={handleGenerateFromExamples}
                  disabled={!aiStatus.available || isRateLimited}
                  block
                  size="large"
                >
                  Generate Transformation
                </Button>
              </Space>
            )
          },
          {
            key: 'documentation',
            label: (
              <Space>
                <FileTextOutlined />
                From Documentation
              </Space>
            ),
            children: (
              <Space direction="vertical" size={spacingToNumber(spacing[3])} style={{ width: '100%' }}>
                <Alert
                  type="info"
                  message="Paste API documentation. AI will analyze and suggest transformation configuration."
                  showIcon
                  style={{ fontSize: 12 }}
                />

                {/* Event Type Selector */}
                {eventTypes.length > 0 && (
                  <div>
                    <Text strong style={{ display: 'block', marginBottom: spacing[1] }}>
                      Event Type (optional)
                    </Text>
                    <Select
                      placeholder="Select event type"
                      style={{ width: '100%' }}
                      value={docEventType}
                      onChange={setDocEventType}
                      allowClear
                      showSearch
                      options={eventTypes.map((et) => ({ value: et, label: et }))}
                    />
                  </div>
                )}

                <div>
                  <Text strong style={{ display: 'block', marginBottom: spacing[1] }}>
                    API Documentation
                  </Text>
                  <TextArea
                    placeholder={`Paste API documentation here. Example:

POST https://api.example.com/integration
Authentication: Bearer Token
Headers:
  - Authorization: Bearer {token}
  - Content-Type: application/json

Request Body:
{
  "patient_id": "string",
  "name": "string",
  "contact": "string (phone number)",
  "email": "string"
}

Response: 200 OK`}
                    rows={12}
                    value={documentation}
                    onChange={(e) => setDocumentation(e.target.value)}
                    style={{
                      fontFamily: token.fontFamilyCode,
                      fontSize: 12
                    }}
                  />
                </div>

                <Button
                  type="primary"
                  icon={<ThunderboltOutlined />}
                  loading={loading}
                  onClick={handleGenerateFromDocumentation}
                  disabled={!aiStatus.available || isRateLimited || !documentation.trim()}
                  block
                  size="large"
                >
                  Analyze & Generate
                </Button>
              </Space>
            )
          }
        ]}
      />

      {/* Configuration Details (from documentation flow) */}
      {generatedConfig && (
        <>
          <Divider style={{ margin: `${spacing[3]} 0` }} />
          <Collapse
            items={[
              {
                key: '1',
                label: (
                  <Space>
                    <InfoCircleOutlined style={{ color: colors.primary[500] }} />
                    <Text strong>Suggested Configuration Details</Text>
                  </Space>
                ),
                children: (
                  <Space direction="vertical" size={spacingToNumber(spacing[2])} style={{ width: '100%' }}>
                    {generatedConfig.targetUrl && (
                      <div>
                        <Text type="secondary" style={{ fontSize: 12 }}>Endpoint URL:</Text>
                        <div style={{
                          fontFamily: token.fontFamilyCode,
                          fontSize: 13,
                          padding: spacing[1],
                          background: withAlpha(colors.primary[50], 0.5),
                          borderRadius: token.borderRadiusSM,
                          marginTop: 4
                        }}>
                          {generatedConfig.targetUrl}
                        </div>
                      </div>
                    )}

                    {generatedConfig.httpMethod && (
                      <div>
                        <Text type="secondary" style={{ fontSize: 12 }}>HTTP Method:</Text>
                        <div style={{ marginTop: 4 }}>
                          <Tag color="blue">{generatedConfig.httpMethod}</Tag>
                        </div>
                      </div>
                    )}

                    {generatedConfig.authType && (
                      <div>
                        <Text type="secondary" style={{ fontSize: 12 }}>Authentication Type:</Text>
                        <div style={{ marginTop: 4 }}>
                          <Tag color="green">{generatedConfig.authType}</Tag>
                        </div>
                      </div>
                    )}

                    {generatedConfig.authConfig && Object.keys(generatedConfig.authConfig).length > 0 && (
                      <div>
                        <Text type="secondary" style={{ fontSize: 12 }}>Authentication Configuration:</Text>
                        <div style={{
                          fontFamily: token.fontFamilyCode,
                          fontSize: 12,
                          padding: spacing[2],
                          background: withAlpha(colors.primary[50], 0.5),
                          borderRadius: token.borderRadiusSM,
                          marginTop: 4,
                          whiteSpace: 'pre-wrap'
                        }}>
                          {JSON.stringify(generatedConfig.authConfig, null, 2)}
                        </div>
                      </div>
                    )}

                    {generatedConfig.notes && (
                      <Alert
                        type="info"
                        message="Notes"
                        description={generatedConfig.notes}
                        showIcon
                        style={{ fontSize: 12 }}
                      />
                    )}

                    <Alert
                      type="warning"
                      message="Remember to update these configuration fields in the integration form"
                      showIcon
                      style={{ fontSize: 11, marginTop: spacing[1] }}
                    />
                  </Space>
                )
              }
            ]}
            defaultActiveKey={['1']}
            style={{ marginBottom: spacing[3] }}
          />
        </>
      )}

      {/* Generated Script Result */}
      {generatedScript && (
        <>
          <Divider />
          <Space direction="vertical" size={spacingToNumber(spacing[2])} style={{ width: '100%' }}>
            <Text strong>Generated Script:</Text>
            <div
              style={{
                border: `1px solid ${cssVar.border.default}`,
                borderRadius: token.borderRadius,
                overflow: 'hidden'
              }}
            >
              <Editor
                height="300px"
                language="javascript"
                value={generatedScript}
                onChange={(value) => setGeneratedScript(value || '')}
                options={{
                  minimap: { enabled: false },
                  fontSize: 13,
                  lineNumbers: 'on',
                  readOnly: false,
                  wordWrap: 'on'
                }}
                theme="vs-dark"
              />
            </div>

            <Space style={{ width: '100%', justifyContent: 'flex-end' }}>
              <Button onClick={handleReset}>Reset</Button>
              <Button icon={copied ? <CheckOutlined /> : <CopyOutlined />} onClick={handleCopyScript}>
                {copied ? 'Copied!' : 'Copy'}
              </Button>
              <Button
                type="primary"
                icon={<CheckOutlined />}
                onClick={handleApplyScript}
                disabled={!generatedScript || generatedScript.trim().length === 0}
              >
                Use This Script
              </Button>
            </Space>
          </Space>
        </>
      )}
    </Modal>
  );
};
