import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useNavigateWithParams } from '../../../utils/navigation';
import {
  App,
  Button,
  Card,
  Col,
  Form,
  Input,
  InputNumber,
  Row,
  Select,
  Space,
  Switch,
  Tabs,
  Typography,
  Divider,
  Alert,
  Collapse
} from 'antd';
import { SaveOutlined, ArrowLeftOutlined, DatabaseOutlined, BookOutlined } from '@ant-design/icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Editor from '@monaco-editor/react';
import { PageHeader } from '../../../components/common/PageHeader';
import { getTemplateById, createTemplate, updateTemplate } from '../../../services/api';
import { useDesignTokens, spacingToNumber, withAlpha, cssVar } from '../../../design-system/utils';

const { TextArea } = Input;
const { Title, Text } = Typography;

const CATEGORIES = ['EHR', 'PMS', 'BILLING', 'LAB', 'IMAGING', 'OTHER'];
const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];
const AUTH_TYPES = ['NONE', 'API_KEY', 'BEARER_TOKEN', 'BASIC_AUTH', 'OAUTH'];
const TRANSFORMATION_MODES = ['SIMPLE', 'SCRIPT'];

const DEFAULT_EVENT_TYPES = [
  'PATIENT_CREATED',
  'PATIENT_UPDATED',
  'PATIENT_DELETED',
  'APPOINTMENT_CREATED',
  'APPOINTMENT_UPDATED',
  'APPOINTMENT_CANCELLED',
  'BILL_CREATED',
  'BILL_UPDATED',
  'PAYMENT_RECEIVED',
  'LAB_RESULT_AVAILABLE',
  'PRESCRIPTION_CREATED',
  'CLINICAL_NOTE_ADDED'
];

const DEFAULT_SCRIPT = `// Transform integration payload
function transform(payload, context) {
  return {
    eventType: context.eventType,
    timestamp: new Date().toISOString(),
    data: payload
  };
}`;

export const TemplateDetailRoute = () => {
  const { id } = useParams();
  const navigate = useNavigateWithParams();
  const queryClient = useQueryClient();
  const { message: msgApi } = App.useApp();
  const { spacing, token } = useDesignTokens();
  const colors = cssVar.legacy;
  const [form] = Form.useForm();
  const isCreate = !id || id === 'new';

  const [headersJson, setHeadersJson] = useState('{}');
  const [authConfigJson, setAuthConfigJson] = useState('{}');
  const [metadataJson, setMetadataJson] = useState('{}');
  const [transformScript, setTransformScript] = useState(DEFAULT_SCRIPT);
  const [isSaving, setIsSaving] = useState(false);

  const { data: template, isLoading } = useQuery({
    queryKey: ['template', id],
    queryFn: () => (id && id !== 'new' ? getTemplateById(id) : Promise.resolve(null)),
    enabled: Boolean(id && id !== 'new')
  });

  useEffect(() => {
    if (template) {
      form.setFieldsValue({
        name: template.name,
        description: template.description,
        category: template.category,
        eventType: template.eventType || [],
        targetUrl: template.targetUrl,
        httpMethod: template.httpMethod,
        authType: template.authType,
        timeoutMs: template.timeoutMs || 10000,
        retryCount: template.retryCount || 3,
        transformationMode: template.transformationMode || 'SIMPLE',
        isActive: template.isActive !== false
      });

      if (template.headers) {
        setHeadersJson(JSON.stringify(template.headers, null, 2));
      }
      if (template.authConfig) {
        setAuthConfigJson(JSON.stringify(template.authConfig, null, 2));
      }
      if (template.metadata) {
        setMetadataJson(JSON.stringify(template.metadata, null, 2));
      }
      if (template.transformation?.script) {
        setTransformScript(template.transformation.script);
      }
    }
  }, [template, form]);

  const handleSubmit = async (values: any) => {
    setIsSaving(true);
    try {
      // Parse JSON fields
      let headers = {};
      let authConfig = {};
      let metadata = {};

      try {
        headers = JSON.parse(headersJson);
      } catch (e) {
        msgApi.error('Invalid JSON in Headers field');
        return;
      }

      try {
        authConfig = JSON.parse(authConfigJson);
      } catch (e) {
        msgApi.error('Invalid JSON in Auth Config field');
        return;
      }

      try {
        metadata = JSON.parse(metadataJson);
      } catch (e) {
        msgApi.error('Invalid JSON in Metadata field');
        return;
      }

      const templateData = {
        name: values.name,
        description: values.description,
        category: values.category,
        eventType: values.eventType,
        targetUrl: values.targetUrl,
        httpMethod: values.httpMethod,
        authType: values.authType,
        authConfig,
        headers,
        timeoutMs: values.timeoutMs,
        retryCount: values.retryCount,
        transformationMode: values.transformationMode,
        transformation: {
          mode: values.transformationMode,
          script: transformScript
        },
        isActive: values.isActive,
        metadata
      };

      if (isCreate) {
        await createTemplate(templateData);
        msgApi.success('Template created successfully');
      } else {
        await updateTemplate(id!, templateData);
        msgApi.success('Template updated successfully');
      }

      queryClient.invalidateQueries({ queryKey: ['templates'] });
      navigate('/templates');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to save template';
      msgApi.error(errorMessage);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div>
      <PageHeader
        title={isCreate ? 'Create Template' : template?.name || 'Edit Template'}
        description="Define a reusable event rule template for common integrations"
        breadcrumb={[
          { label: 'Templates', path: '/templates' },
          { label: isCreate ? 'Create' : 'Edit' }
        ]}
        compact
        actions={
          <Space>
            <Button size="middle" icon={<ArrowLeftOutlined />} onClick={() => navigate('/templates')}>
              Back to Templates
            </Button>
            <Button type="primary" size="middle" icon={<SaveOutlined />} onClick={() => form.submit()} loading={isSaving}>
              {isCreate ? 'Create Template' : 'Save Changes'}
            </Button>
          </Space>
        }
      />

      <Form
        form={form}
        layout="vertical"
        onFinish={handleSubmit}
        initialValues={{
          httpMethod: 'POST',
          authType: 'API_KEY',
          timeoutMs: 10000,
          retryCount: 3,
          transformationMode: 'SIMPLE',
          isActive: true,
          eventTypes: []
        }}
      >
        <Row gutter={[spacingToNumber(spacing[4]), spacingToNumber(spacing[4])]}>
          {/* Left Column */}
          <Col xs={24} lg={12}>
            <Card title="Basic Information" className="panel" size="small">
              <Form.Item
                label="Template Name"
                name="name"
                rules={[{ required: true, message: 'Template name is required' }]}
              >
                <Input placeholder="e.g., Epic EHR Integration" />
              </Form.Item>

              <Form.Item
                label="Description"
                name="description"
                rules={[{ required: true, message: 'Description is required' }]}
              >
                <TextArea rows={3} placeholder="Describe the purpose of this template..." />
              </Form.Item>

              <Row gutter={spacingToNumber(spacing[4])}>
                <Col span={12}>
                  <Form.Item
                    label="Category"
                    name="category"
                    rules={[{ required: true, message: 'Category is required' }]}
                  >
                    <Select placeholder="Select category">
                      {CATEGORIES.map(cat => (
                        <Select.Option key={cat} value={cat}>{cat}</Select.Option>
                      ))}
                    </Select>
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item label="Active" name="isActive" valuePropName="checked">
                    <Switch checkedChildren="Active" unCheckedChildren="Inactive" />
                  </Form.Item>
                </Col>
              </Row>

              <Form.Item
                label="Event Types"
                name="eventType"
                rules={[{ required: true, message: 'At least one event type is required' }]}
              >
                <Select
                  mode="multiple"
                  placeholder="Select event types"
                  allowClear
                  showSearch
                >
                  {DEFAULT_EVENT_TYPES.map(event => (
                    <Select.Option key={event} value={event}>{event}</Select.Option>
                  ))}
                </Select>
              </Form.Item>
            </Card>

            <Card title="HTTP Configuration" className="panel" size="small" style={{ marginTop: spacing[3] }}>
              <Form.Item
                label="Target URL"
                name="targetUrl"
                rules={[
                  { required: true, message: 'Target URL is required' },
                  { type: 'url', message: 'Must be a valid URL' }
                ]}
              >
                <Input placeholder="https://api.example.com/integration" />
              </Form.Item>

              <Row gutter={spacingToNumber(spacing[4])}>
                <Col span={12}>
                  <Form.Item
                    label="HTTP Method"
                    name="httpMethod"
                    rules={[{ required: true, message: 'HTTP method is required' }]}
                  >
                    <Select>
                      {HTTP_METHODS.map(method => (
                        <Select.Option key={method} value={method}>{method}</Select.Option>
                      ))}
                    </Select>
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item
                    label="Timeout (ms)"
                    name="timeoutMs"
                    rules={[{ required: true, message: 'Timeout is required' }]}
                  >
                    <InputNumber min={1000} max={60000} step={1000} style={{ width: '100%' }} />
                  </Form.Item>
                </Col>
              </Row>

              <Form.Item label="Retry Count" name="retryCount">
                <InputNumber min={0} max={10} style={{ width: '100%' }} />
              </Form.Item>

              <Form.Item label="Custom Headers (JSON)">
                <TextArea
                  rows={4}
                  value={headersJson}
                  onChange={(e) => setHeadersJson(e.target.value)}
                  placeholder={'{\n  "Content-Type": "application/json"\n}'}
                  style={{ fontFamily: token.fontFamilyCode }}
                />
                <Text type="secondary" style={{ fontSize: token.fontSizeSM }}>
                  JSON object with custom HTTP headers
                </Text>
              </Form.Item>
            </Card>
          </Col>

          {/* Right Column */}
          <Col xs={24} lg={12}>
            <Card title="Authentication" className="panel" size="small">
              <Form.Item
                label="Authentication Type"
                name="authType"
                rules={[{ required: true, message: 'Auth type is required' }]}
              >
                <Select>
                  {AUTH_TYPES.map(type => (
                    <Select.Option key={type} value={type}>{type}</Select.Option>
                  ))}
                </Select>
              </Form.Item>

              <Form.Item label="Auth Configuration (JSON)">
                <TextArea
                  rows={6}
                  value={authConfigJson}
                  onChange={(e) => setAuthConfigJson(e.target.value)}
                  placeholder={'{\n  "apiKey": "your-key",\n  "headerName": "X-API-Key"\n}'}
                  style={{ fontFamily: token.fontFamilyCode }}
                />
                <Text type="secondary" style={{ fontSize: token.fontSizeSM }}>
                  Configuration depends on auth type (apiKey, token, username/password, etc.)
                </Text>
              </Form.Item>
            </Card>

            <Card title="Transformation" className="panel" size="small" style={{ marginTop: spacing[3] }}>
              <Form.Item label="Transformation Mode" name="transformationMode">
                <Select>
                  {TRANSFORMATION_MODES.map(mode => (
                    <Select.Option key={mode} value={mode}>{mode}</Select.Option>
                  ))}
                </Select>
              </Form.Item>

              <Form.Item label="Transformation Script">
                <Alert
                  type="success"
                  showIcon
                  closable
                  message="Editor Keyboard Shortcuts"
                  description={
                    <div style={{ fontSize: token.fontSizeSM }}>
                      <ul style={{ margin: 0, paddingLeft: 20 }}>
                        <li><strong>Cmd/Ctrl + F</strong> - Find text</li>
                        <li><strong>Cmd/Ctrl + H</strong> - Find and replace</li>
                        <li><strong>Cmd/Ctrl + /</strong> - Toggle line comment</li>
                        <li><strong>Cmd/Ctrl + Shift + K</strong> - Delete line</li>
                        <li><strong>Alt + Up/Down</strong> - Move line up/down</li>
                        <li><strong>Cmd/Ctrl + D</strong> - Select next occurrence</li>
                        <li><strong>Cmd/Ctrl + Scroll</strong> - Zoom in/out</li>
                      </ul>
                    </div>
                  }
                  style={{ marginBottom: spacing[3] }}
                />
                <Collapse
                  size="small"
                  ghost
                  style={{ marginBottom: spacing[3] }}
                  items={[{
                    key: 'lookup-help',
                    label: (
                      <Space size={4}>
                        <DatabaseOutlined style={{ color: colors.primary[600] }} />
                        <Typography.Text strong style={{ fontSize: 13 }}>
                          Using Lookup Tables in Scripts
                        </Typography.Text>
                      </Space>
                    ),
                    children: (
                      <div>
                        <Typography.Text style={{ fontSize: 12 }}>
                          Use <code>lookup(sourceCode, mappingType)</code> to translate codes using your configured lookup tables:
                        </Typography.Text>
                        <pre style={{
                          background: '#1e1e1e',
                          color: '#d4d4d4',
                          padding: '8px',
                          borderRadius: 4,
                          fontSize: 11,
                          marginTop: 8,
                          marginBottom: 8
                        }}>
{`// Simple lookup
externalServiceCode: lookup(payload.serviceCode, 'SERVICE_CODE'),

// With fallback
providerID: lookup(payload.doctorId, 'PROVIDER_ID') || 'UNKNOWN',

// Array mapping
items: payload.items?.map(item => ({
  ...item,
  externalCode: lookup(item.code, 'ITEM_CODE')
}))`}
                        </pre>
                        <Typography.Link href="/help/lookup-guide" target="_blank" style={{ fontSize: 12 }}>
                          <BookOutlined style={{ marginRight: 4 }} />
                          View Complete Lookup Tables Guide
                        </Typography.Link>
                      </div>
                    )
                  }]}
                />
                <div
                  style={{
                    borderRadius: token.borderRadiusLG,
                    overflow: 'hidden',
                    border: `1px solid ${token.colorBorder}`,
                    boxShadow: token.boxShadowSecondary,
                    marginBottom: spacing[2]
                  }}
                >
                  <Editor
                    height="400px"
                    language="javascript"
                    value={transformScript}
                    onChange={(value) => setTransformScript(value ?? '')}
                    options={{
                      // Display
                      minimap: { enabled: false },
                      fontSize: 14,
                      fontFamily: '"JetBrains Mono", "Fira Code", "Cascadia Code", "SF Mono", Monaco, "Courier New", monospace',
                      lineNumbers: 'on',
                      wordWrap: 'on',
                      glyphMargin: true,
                      folding: true,
                      lineDecorationsWidth: 10,
                      lineNumbersMinChars: 3,
                      renderLineHighlight: 'all',

                      // Editing behavior
                      tabSize: 2,
                      insertSpaces: true,
                      autoIndent: 'full',
                      formatOnPaste: true,
                      formatOnType: true,

                      // IntelliSense & suggestions
                      quickSuggestions: {
                        other: true,
                        comments: false,
                        strings: true
                      },
                      suggestOnTriggerCharacters: true,
                      acceptSuggestionOnCommitCharacter: true,
                      acceptSuggestionOnEnter: 'on',
                      tabCompletion: 'on',
                      wordBasedSuggestions: true,
                      suggest: {
                        showKeywords: true,
                        showSnippets: true,
                        showFunctions: true,
                        showVariables: true
                      },

                      // Bracket matching & pairing
                      matchBrackets: 'always',
                      autoClosingBrackets: 'always',
                      autoClosingQuotes: 'always',
                      autoSurround: 'languageDefined',
                      bracketPairColorization: {
                        enabled: true
                      },

                      // Find/Replace
                      find: {
                        addExtraSpaceOnTop: false,
                        autoFindInSelection: 'never',
                        seedSearchStringFromSelection: 'always'
                      },

                      // Scrolling
                      scrollBeyondLastLine: false,
                      smoothScrolling: true,
                      mouseWheelZoom: true,

                      // Context menu
                      contextmenu: true,

                      // Additional features
                      parameterHints: {
                        enabled: true
                      },
                      hover: {
                        enabled: true
                      },
                      links: true,
                      colorDecorators: true,
                      comments: {
                        insertSpace: true
                      }
                    }}
                    theme="vs-dark"
                  />
                </div>
                <Text type="secondary" style={{ fontSize: token.fontSizeSM }}>
                  JavaScript function to transform integration payloads
                </Text>
              </Form.Item>
            </Card>

            <Card title="Metadata (Optional)" className="panel" style={{ marginTop: spacing[6] }}>
              <Form.Item label="Template Metadata (JSON)">
                <TextArea
                  rows={6}
                  value={metadataJson}
                  onChange={(e) => setMetadataJson(e.target.value)}
                  placeholder={'{\n  "vendor": "Epic Systems",\n  "documentation": "https://..."\n}'}
                  style={{ fontFamily: token.fontFamilyCode }}
                />
                <Text type="secondary" style={{ fontSize: token.fontSizeSM }}>
                  Additional metadata like vendor, documentation links, format, etc.
                </Text>
              </Form.Item>
            </Card>
          </Col>
        </Row>
      </Form>
    </div>
  );
};
