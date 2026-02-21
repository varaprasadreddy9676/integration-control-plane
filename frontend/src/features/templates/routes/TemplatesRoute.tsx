import { useMemo, useState } from 'react';
import { App, Button, Card, Modal, Tag, Typography, Space, Input, Select, Tooltip, Badge, Empty, Divider, Alert, Collapse } from 'antd';
import { FilterOutlined, PlusOutlined, SearchOutlined, AppstoreOutlined, BookOutlined, CodeOutlined, InfoCircleOutlined, DeleteOutlined, PlusCircleOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { PageHeader } from '../../../components/common/PageHeader';
import { FilterBar } from '../../../components/common/FilterBar';
import { StatusBadge } from '../../../components/common/StatusBadge';
import { getTemplates, createIntegrationFromTemplate } from '../../../services/api';
import type { IntegrationTemplate } from '../../../mocks/types';
import { cssVar, useDesignTokens, withAlpha, spacingToNumber } from '../../../design-system/utils';
import { useNavigateWithParams } from '../../../utils/navigation';

const { Title, Text, Paragraph } = Typography;
const { TextArea } = Input;

export const TemplatesRoute = () => {
  const navigate = useNavigateWithParams();
  const { spacing, token, borderRadius, transitions } = useDesignTokens();
  const colors = cssVar.legacy;
  const { data: templates = [], isLoading, refetch } = useQuery({ queryKey: ['templates'], queryFn: getTemplates });
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [categoryFilter, setCategoryFilter] = useState<string | undefined>();
  const [selectedTemplate, setSelectedTemplate] = useState<IntegrationTemplate | null>(null);
  const [createModalVisible, setCreateModalVisible] = useState(false);
  const [createLoading, setCreateLoading] = useState(false);
  const [overrides, setOverrides] = useState<Record<string, any>>({});
  const [placeholderValues, setPlaceholderValues] = useState<Record<string, string>>({});
  const [bodyParams, setBodyParams] = useState<Array<{ field: string; default: string }>>([]);
  const { message: msgApi } = App.useApp();

  const categories = useMemo(() => {
    if (!Array.isArray(templates)) return [];
    return [...new Set(templates.map(t => t.category))];
  }, [templates]);

  const filteredTemplates = useMemo(() => {
    if (!Array.isArray(templates)) return [];
    return templates.filter(template => {
      const matchesSearch = !searchTerm ||
        template.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        template.description?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        template.metadata?.vendor?.toLowerCase().includes(searchTerm.toLowerCase());
      const matchesCategory = !categoryFilter || template.category === categoryFilter;
      return matchesSearch && matchesCategory;
    });
  }, [templates, searchTerm, categoryFilter]);

  const handleCreateFromTemplate = async (template: IntegrationTemplate) => {
    setSelectedTemplate(template);
    setCreateModalVisible(true);

    // Initialize overrides with template defaults
    setOverrides({
      name: `${template.name} Integration`,
      targetUrl: template.targetUrl || '',
      httpMethod: template.httpMethod || 'POST',
      timeoutMs: template.timeoutMs || 30000,
      retryCount: template.retryCount !== undefined ? template.retryCount : 3,
      eventType: template.eventType || '',
      scope: 'ENTITY_ONLY',
      outgoingAuthType: template.authType || 'NONE',
      outgoingAuthConfig: template.authConfig || {},
      transformationMode: template.transformationMode || null,
      transformation: template.transformation || {},
      actions: template.actions || null
    });

    // Initialize placeholder values (empty - user will fill them in)
    const placeholders: Record<string, string> = {};
    if (template.metadata?.placeholders) {
      Object.keys(template.metadata.placeholders).forEach(key => {
        placeholders[key] = '';
      });
    }
    setPlaceholderValues(placeholders);

    // Initialize body params with default example if BODY_PARAMS placeholder exists
    if (template.metadata?.placeholders?.BODY_PARAMS) {
      // Try to get default from first example
      const firstExample = template.metadata.examples?.[0];
      if (firstExample && (firstExample as any).bodyParams) {
        try {
          const parsedParams = JSON.parse((firstExample as any).bodyParams);
          setBodyParams(parsedParams);
        } catch {
          // Fallback to 3 empty params
          setBodyParams([
            { field: '', default: '' },
            { field: '', default: '' },
            { field: '', default: '' }
          ]);
        }
      } else {
        setBodyParams([
          { field: '', default: '' },
          { field: '', default: '' },
          { field: '', default: '' }
        ]);
      }
    } else {
      setBodyParams([]);
    }
  };

  const handleCreateIntegration = async () => {
    if (!selectedTemplate) return;

    // Validate required fields
    if (!overrides.name?.trim()) {
      msgApi.warning('Please provide a integration name.');
      return;
    }

    // Validate placeholders
    const missingPlaceholders: string[] = [];
    if (selectedTemplate.metadata?.placeholders) {
      Object.keys(selectedTemplate.metadata.placeholders).forEach(key => {
        // Skip BODY_PARAMS as it's handled separately
        if (key === 'BODY_PARAMS') return;

        if (!placeholderValues[key]?.trim()) {
          missingPlaceholders.push(key);
        }
      });
    }

    // Validate body params if template has BODY_PARAMS
    if (selectedTemplate.metadata?.placeholders?.BODY_PARAMS) {
      if (bodyParams.length === 0) {
        msgApi.warning('Please add at least one body parameter');
        return;
      }

      const invalidParams = bodyParams.some(p => !p.field?.trim());
      if (invalidParams) {
        msgApi.warning('All body parameters must have a field name');
        return;
      }
    }

    if (missingPlaceholders.length > 0) {
      msgApi.warning(`Please fill in all required placeholders: ${missingPlaceholders.join(', ')}`);
      return;
    }

    // Validate URL if not using placeholder
    const urlPattern = /^https?:\/\/.+/i;
    if (overrides.targetUrl && !overrides.targetUrl.includes('{{') && !urlPattern.test(overrides.targetUrl)) {
      msgApi.warning('Enter a valid HTTP/HTTPS target URL.');
      return;
    }

    if (overrides.timeoutMs && (overrides.timeoutMs < 500 || overrides.timeoutMs > 60000)) {
      msgApi.warning('Timeout must be between 500 and 60000 ms.');
      return;
    }

    if (overrides.retryCount !== undefined && (overrides.retryCount < 0 || overrides.retryCount > 10)) {
      msgApi.warning('Retry count must be between 0 and 10.');
      return;
    }

    try {
      setCreateLoading(true);

      // Prepare placeholders with BODY_PARAMS serialization if needed
      const finalPlaceholders = { ...placeholderValues };

      // If template has BODY_PARAMS placeholder, serialize the bodyParams array
      if (selectedTemplate.metadata?.placeholders?.BODY_PARAMS) {
        finalPlaceholders.BODY_PARAMS = JSON.stringify(bodyParams);
      }

      // Prepare payload with placeholders
      const payload = {
        templateId: selectedTemplate.id,
        overrides: {
          ...overrides,
          placeholders: finalPlaceholders
        }
      };

      const integration = await createIntegrationFromTemplate(payload);

      msgApi.success('Integration created successfully from template');
      setCreateModalVisible(false);
      setSelectedTemplate(null);
      setOverrides({});
      setPlaceholderValues({});
      setBodyParams([]);
      navigate(`/integrations/${integration.id}`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      msgApi.error(`Failed to create event rule: ${errorMessage}`);
    } finally {
      setCreateLoading(false);
    }
  };

  const tagTone = (base: string) => ({
    borderRadius: borderRadius.full,
    borderColor: withAlpha(base, 0.4),
    background: withAlpha(base, 0.14),
    color: base,
    fontWeight: 700,
    paddingInline: spacing['2.5'],
    paddingBlock: spacing['0.5']
  });

  const getCategoryIcon = (category: string) => {
    const toneMap: Record<string, string> = {
      EHR: colors.info[600],
      PMS: colors.success[600],
      BILLING: colors.warning[600],
      LAB: colors.primary[600],
      IMAGING: colors.error[600],
      default: colors.neutral[600]
    };

    const color = toneMap[category] ?? toneMap.default;

    switch (category) {
      case 'EHR': return <BookOutlined style={{ color }} />;
      case 'PMS': return <AppstoreOutlined style={{ color }} />;
      case 'BILLING': return <FilterOutlined style={{ color }} />;
      case 'LAB': return <SearchOutlined style={{ color }} />;
      case 'IMAGING': return <FilterOutlined style={{ color }} />;
      default: return <AppstoreOutlined style={{ color }} />;
    }
  };

  const renderTemplateCard = (template: IntegrationTemplate) => (
    <Card
      key={template.id}
      hoverable
      className="template-card"
      style={{
        height: '100%',
        transition: transitions.allSlow,
        borderRadius: token.borderRadiusLG,
        border: `1px solid ${cssVar.border.default}`
      }}
      actions={[
        <Button
          key="details"
          type="text"
          onClick={() => navigate(`/templates/${template.id}`)}
          block
        >
          Edit Template
        </Button>,
        <Button
          key="create"
          type="primary"
          onClick={() => handleCreateFromTemplate(template)}
          block
        >
          Use Template
        </Button>
      ]}
    >
      <Card.Meta
        avatar={getCategoryIcon(template.category)}
        title={
          <Space>
            {template.name}
            {template.isActive && <Badge status="success" />}
          </Space>
        }
        description={
          <Space direction="vertical" size="small" style={{ width: '100%' }}>
            <Text type="secondary">{template.description}</Text>
            <Space wrap>
              <Tag style={tagTone(colors.info[600])}>{template.category}</Tag>
              {template.metadata?.vendor && <Tag style={tagTone(colors.success[600])}>{template.metadata.vendor}</Tag>}
              {template.eventType && <Tag style={tagTone(colors.warning[600])}>{template.eventType}</Tag>}
            </Space>
            {template.transformationMode && (
              <Tag style={tagTone(colors.primary[600])}>{template.transformationMode} Transform</Tag>
            )}
            {template.actions && template.actions.length > 0 && (
              <Tag style={tagTone(colors.error[600])}>{template.actions.length} Actions</Tag>
            )}
          </Space>
        }
      />
    </Card>
  );

  return (
    <div>
      <PageHeader
        title="Event Rule Templates"
        description="Pre-built templates for common healthcare system integrations. Quickly configure event rules for Epic, Cerner, Athenahealth, and more."
        statusChips={[
          { label: `${templates?.length || 0} templates` },
          { label: `${categories.length} categories`, color: colors.primary[600] }
        ]}
        compact
        actions={
          <Space>
            <Button size="middle" onClick={() => refetch()}>
              Refresh Templates
            </Button>
            <Button type="primary" size="middle" icon={<PlusOutlined />} onClick={() => navigate('/templates/new')}>
              Create Template
            </Button>
          </Space>
        }
      />

      <FilterBar
        rightSlot={
          <Button
            icon={<FilterOutlined />}
            type="text"
            onClick={() => {
              setSearchTerm('');
              setCategoryFilter(undefined);
            }}
          >
            Reset
          </Button>
        }
      >
        <Input
          placeholder="Search templates..."
          prefix={<SearchOutlined />}
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          style={{ width: 250 }}
          allowClear
        />
        <Select
          placeholder="Category"
          value={categoryFilter}
          onChange={setCategoryFilter}
          style={{ width: 150 }}
          allowClear
          options={categories.map(cat => ({ value: cat, label: cat }))}
        />
      </FilterBar>

      <div style={{ padding: `${spacing[3]} 0` }}>
        {filteredTemplates.length === 0 ? (
          <Empty
            description="No templates found"
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            style={{ margin: `${spacing[12]} 0` }}
          />
        ) : (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
              gap: spacing[3]
            }}
          >
            {filteredTemplates.map(renderTemplateCard)}
          </div>
        )}
      </div>

      {/* Create Integration from Template Modal */}
      <Modal
        title={`Create Event Rule from: ${selectedTemplate?.name}`}
        open={createModalVisible}
        onOk={handleCreateIntegration}
        onCancel={() => {
          setCreateModalVisible(false);
          setSelectedTemplate(null);
          setOverrides({});
          setPlaceholderValues({});
          setBodyParams([]);
        }}
        confirmLoading={createLoading}
        width={700}
      >
        {selectedTemplate && (
          <Space direction="vertical" size="middle" style={{ width: '100%' }}>
            {/* Template Information */}
            <div>
              <Text strong>Template Information</Text>
              <div style={{ marginTop: spacing[2] }}>
                <Paragraph>{selectedTemplate.description}</Paragraph>
                <Space wrap>
                  <Tag color={colors.info[600]}>{selectedTemplate.category}</Tag>
                  {selectedTemplate.metadata?.vendor && <Tag color={colors.success[600]}>{selectedTemplate.metadata.vendor}</Tag>}
                  {selectedTemplate.transformationMode && (
                    <Tag icon={<CodeOutlined />} color={colors.primary[600]}>
                      {selectedTemplate.transformationMode}
                    </Tag>
                  )}
                  {selectedTemplate.actions && selectedTemplate.actions.length > 0 && (
                    <Tag color={colors.warning[600]}>
                      {selectedTemplate.actions.length} Actions
                    </Tag>
                  )}
                </Space>
                {selectedTemplate.metadata?.documentation && (
                  <div style={{ marginTop: spacing[2] }}>
                    <Text type="secondary">
                      <InfoCircleOutlined /> <a href={selectedTemplate.metadata.documentation} target="_blank" rel="noopener noreferrer">View Documentation</a>
                    </Text>
                  </div>
                )}
              </div>
            </div>

            <Divider style={{ margin: `${spacing[2]} 0` }} />

            {/* Placeholder Configuration */}
            {selectedTemplate.metadata?.placeholders && Object.keys(selectedTemplate.metadata.placeholders).length > 0 && (
              <>
                <div>
                  <Text strong>Template Placeholders *</Text>
                  <Alert
                    message="Fill in the required values below to customize this template"
                    type="info"
                    showIcon
                    style={{ marginTop: spacing[2], marginBottom: spacing[2] }}
                  />
                  <Space direction="vertical" size="small" style={{ width: '100%' }}>
                    {Object.entries(selectedTemplate.metadata.placeholders).map(([key, description]) => {
                      // Special handling for BODY_PARAMS - render dynamic parameter builder
                      if (key === 'BODY_PARAMS') {
                        return (
                          <div key={key}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing[1] }}>
                              <Text strong>Body Parameters *</Text>
                              <Button
                                type="dashed"
                                size="small"
                                icon={<PlusCircleOutlined />}
                                onClick={() => setBodyParams([...bodyParams, { field: '', default: '' }])}
                              >
                                Add Parameter
                              </Button>
                            </div>
                            <Text type="secondary" style={{ fontSize: '12px', display: 'block', marginBottom: spacing[2] }}>
                              {description as string}
                            </Text>
                            <Space direction="vertical" size="small" style={{ width: '100%' }}>
                              {bodyParams.map((param, idx) => (
                                <div key={idx} style={{
                                  display: 'flex',
                                  gap: spacing[2],
                                  padding: spacing[2],
                                  background: colors.neutral[50],
                                  borderRadius: token.borderRadius,
                                  alignItems: 'center'
                                }}>
                                  <div style={{ flex: 1 }}>
                                    <Text style={{ fontSize: '12px', color: cssVar.text.secondary }}>Field Name</Text>
                                    <Input
                                      size="small"
                                      value={param.field}
                                      onChange={(e) => {
                                        const newParams = [...bodyParams];
                                        newParams[idx].field = e.target.value;
                                        setBodyParams(newParams);
                                      }}
                                      placeholder="e.g., patientName"
                                    />
                                  </div>
                                  <div style={{ flex: 1 }}>
                                    <Text style={{ fontSize: '12px', color: cssVar.text.secondary }}>Default Value</Text>
                                    <Input
                                      size="small"
                                      value={param.default}
                                      onChange={(e) => {
                                        const newParams = [...bodyParams];
                                        newParams[idx].default = e.target.value;
                                        setBodyParams(newParams);
                                      }}
                                      placeholder="e.g., Guest"
                                    />
                                  </div>
                                  <Button
                                    type="text"
                                    danger
                                    size="small"
                                    icon={<DeleteOutlined />}
                                    onClick={() => {
                                      const newParams = bodyParams.filter((_, i) => i !== idx);
                                      setBodyParams(newParams);
                                    }}
                                    style={{ marginTop: '18px' }}
                                  />
                                </div>
                              ))}
                            </Space>
                          </div>
                        );
                      }

                      // Regular placeholder input
                      return (
                        <div key={key}>
                          <Text>{key} *</Text>
                          <Tooltip title={description}>
                            <Input
                              value={placeholderValues[key] || ''}
                              onChange={(e) => setPlaceholderValues(prev => ({ ...prev, [key]: e.target.value }))}
                              placeholder={description as string}
                              suffix={<InfoCircleOutlined style={{ color: cssVar.text.muted }} />}
                            />
                          </Tooltip>
                        </div>
                      );
                    })}
                  </Space>
                </div>
                <Divider style={{ margin: `${spacing[2]} 0` }} />
              </>
            )}

            {/* Basic Configuration */}
            <div>
              <Text strong>Integration Configuration</Text>
              <Space direction="vertical" size="small" style={{ width: '100%', marginTop: spacing[2] }}>
                <div>
                  <Text>Integration Name *</Text>
                  <Input
                    value={overrides.name}
                    onChange={(e) => setOverrides(prev => ({ ...prev, name: e.target.value }))}
                    placeholder="Enter event rule name"
                  />
                </div>

                <div>
                  <Text>Event Type</Text>
                  <Input
                    value={overrides.eventType}
                    onChange={(e) => setOverrides(prev => ({ ...prev, eventType: e.target.value }))}
                    placeholder={selectedTemplate.eventType || "Enter event type or use * for all events"}
                    disabled={!!selectedTemplate.metadata?.placeholders?.EVENT_TYPE}
                  />
                  {selectedTemplate.metadata?.placeholders?.EVENT_TYPE && (
                    <Text type="secondary" style={{ fontSize: '12px' }}>
                      This will be set from the EVENT_TYPE placeholder above
                    </Text>
                  )}
                </div>

                <div>
                  <Space style={{ width: '100%' }}>
                    <div style={{ flex: 1 }}>
                      <Text>Timeout (ms)</Text>
                      <Input
                        type="number"
                        value={overrides.timeoutMs}
                        onChange={(e) => setOverrides(prev => ({ ...prev, timeoutMs: parseInt(e.target.value) || 30000 }))}
                        min="1000"
                        max="60000"
                      />
                    </div>
                    <div style={{ flex: 1 }}>
                      <Text>Retry Count</Text>
                      <Input
                        type="number"
                        value={overrides.retryCount}
                        onChange={(e) => setOverrides(prev => ({ ...prev, retryCount: parseInt(e.target.value) || 3 }))}
                        min="0"
                        max="10"
                      />
                    </div>
                  </Space>
                </div>
              </Space>
            </div>

            {/* Advanced Details (Collapsible) */}
            <Collapse
              items={[
                {
                  key: 'advanced',
                  label: 'Advanced Details',
                  children: (
                    <Space direction="vertical" size="small" style={{ width: '100%' }}>
                      {/* Multi-Action Display */}
                      {selectedTemplate.actions && selectedTemplate.actions.length > 0 && (
                        <div>
                          <Text strong>Actions ({selectedTemplate.actions.length})</Text>
                          {selectedTemplate.actions.map((action, idx) => (
                            <div key={idx} style={{
                              marginTop: spacing[2],
                              padding: spacing[2],
                              background: colors.neutral[100],
                              borderRadius: token.borderRadius
                            }}>
                              <Text strong>{idx + 1}. {action.name}</Text>
                              {action.condition && (
                                <div style={{ marginTop: spacing[1] }}>
                                  <Text type="secondary" style={{ fontSize: '12px' }}>
                                    Condition: <code>{action.condition}</code>
                                  </Text>
                                </div>
                              )}
                              {action.transformationMode && (
                                <div style={{ marginTop: spacing[1] }}>
                                  <Tag style={{ fontSize: '12px' }}>{action.transformationMode}</Tag>
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Transformation Script Preview */}
                      {selectedTemplate.transformationMode === 'SCRIPT' && selectedTemplate.transformation?.script && (
                        <div>
                          <Text strong>Transformation Script</Text>
                          <TextArea
                            value={selectedTemplate.transformation.script}
                            readOnly
                            rows={6}
                            style={{
                              marginTop: spacing[1],
                              fontFamily: 'monospace',
                              fontSize: '12px',
                              background: colors.neutral[100]
                            }}
                          />
                        </div>
                      )}

                      {/* Examples */}
                      {selectedTemplate.metadata?.examples && selectedTemplate.metadata.examples.length > 0 && (
                        <div>
                          <Text strong>Usage Examples</Text>
                          {selectedTemplate.metadata.examples.map((example, idx) => (
                            <div key={idx} style={{
                              marginTop: spacing[1],
                              padding: spacing[2],
                              background: colors.neutral[50],
                              borderRadius: token.borderRadius
                            }}>
                              <Text>{example.name}</Text>
                              {example.eventType && (
                                <div><Text type="secondary" style={{ fontSize: '12px' }}>Event: {example.eventType}</Text></div>
                              )}
                              {example.params && (
                                <div><Text type="secondary" style={{ fontSize: '12px' }}>Params: {example.params.join(', ')}</Text></div>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </Space>
                  )
                }
              ]}
            />
          </Space>
        )}
      </Modal>
    </div>
  );
};
