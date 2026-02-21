import { useMemo, useState, useEffect, useRef, useCallback } from 'react';
import {
  App,
  Alert,
  Button,
  Card,
  TreeSelect,
  Divider,
  Dropdown,
  Flex,
  Grid,
  Input,
  Radio,
  Select,
  Space,
  Tabs,
  Typography,
  Switch,
  Collapse,
  Tag,
  Tooltip,
  Modal,
  Spin,
  Progress
} from 'antd';
import {
  CodeOutlined,
  InfoCircleOutlined,
  LinkOutlined,
  ReloadOutlined,
  ThunderboltOutlined,
  FileTextOutlined,
  PlusOutlined,
  DeleteOutlined,
  CheckCircleFilled,
  ArrowRightOutlined,
  UndoOutlined,
  HighlightOutlined,
  FileAddOutlined,
  RocketOutlined,
  BulbOutlined,
  CheckOutlined,
  CloseOutlined,
  DatabaseOutlined,
  BookOutlined
} from '@ant-design/icons';
import Editor from '@monaco-editor/react';
import { cssVar, useDesignTokens, withAlpha, spacingToNumber } from "../../../design-system/utils";
import { QuestionCircleOutlined } from '@ant-design/icons';
import { Divider as AntDivider } from 'antd';
import { AIAssistantModal } from './AIAssistantModal';
import { useAIStatus } from '../hooks/useAIStatus';
import { suggestFieldMappings, AIFieldMapping, generateTestPayload, explainTransformation, type ExplainTransformationResult } from '../../../services/ai-api';
import { useTenant } from '../../../app/tenant-context';
import { useQuery } from '@tanstack/react-query';
import { getLookupTypes } from '../../../services/api';

// Default source fields will be dynamically loaded from the API based on selected event type
// No hardcoded values here - everything comes from the event_types collection in MongoDB
const defaultSourceFields: Array<{ key: string; label: string; type: string }> = [];

type TransformKind = 'none' | 'trim' | 'upper' | 'lower' | 'date' | 'default' | 'lookup';

interface MappingRow {
  id: string;
  targetField: string;
  sourceField?: string;
  transform?: TransformKind;
  defaultValue?: string;
  lookupType?: string;
  helper?: string;
}

interface StaticField {
  id: string;
  key: string;
  value: string;
}

const makeTagTone =
  (token: any, spacing: any, colors: any) =>
  (base: string) => ({
    borderRadius: token.borderRadiusLG,
    borderColor: withAlpha(base, 0.4),
    background: withAlpha(base, 0.14),
    color: base,
    fontWeight: 700,
    paddingInline: spacing['2.5'],
    paddingBlock: spacing['0.5']
  });

const getRequiredHint = (targetField?: string) => {
  switch (targetField) {
    case 'patient_id':
      return 'Example: map patient_id -> patientRID';
    case 'bill_id':
      return 'Example: map bill_id -> billNumber';
    case 'event_type':
      return 'Example: map event_type -> eventType';
    case 'source':
      return 'Example: map source -> tenantCode';
    default:
      return 'Map this required target to the matching source field';
  }
};

interface Props {
  transformationTab: 'SIMPLE' | 'SCRIPT';
  onChangeTab: (tab: 'SIMPLE' | 'SCRIPT') => void;
  scriptValue: string;
  onScriptChange: (val: string) => void;
  mappings?: MappingRow[];
  onMappingsChange?: (mappings: MappingRow[]) => void;
  staticFields?: StaticField[];
  onStaticFieldsChange?: (fields: StaticField[]) => void;
  sampleInput: string;
  onSampleInputChange: (val: string) => void;
  // Actual event payload (from schema) to display in preview panel
  eventPayload?: unknown;
  onUseEventPayload?: (payloadText: string) => void;
  sampleOutput: string;
  onSampleOutputChange: (val: string) => void;
  getPreviewContext: () => { eventType: string; entityCode?: string; entityName?: string };
  onValidateScript?: () => void;
  availableFields?: Array<{ key: string; label: string; type: string; path?: string; typeBadge?: string; depth?: number; description?: string; required?: boolean }>;
  availableFieldTree?: any[];
  examplePayloads?: Array<{ label: string; payload: unknown }>;
  onPreviewMeta?: (meta: { durationMs?: number; status?: number }) => void;
  onRegisterRunPreview?: (runner: () => void) => void;
  requiredAnchorRef?: React.RefObject<HTMLDivElement>;
  onMissingRequiredChange?: (count: number) => void;
  eventTypes?: string[];
  currentEventType?: string;
}

/**
 * Generate safe nested access for dot notation paths
 * e.g., 'patient.mrn.documentNumber' -> 'payload?.patient?.mrn?.documentNumber'
 */
const generateSafeAccess = (path: string): string => {
  const parts = path.split('.');
  return `payload?.${parts.join('?.')}`;
};

/**
 * Generate JavaScript code from SIMPLE mode mappings
 * This helps users learn by showing them what their mappings look like as code
 */
const generateScriptFromMappings = (
  mappings: MappingRow[],
  staticFields: StaticField[]
): string => {
  const lines: string[] = [];
  lines.push('// Auto-generated from your field mappings');
  lines.push('// You can customize this code as needed');
  lines.push('');
  lines.push('const result = {};');
  lines.push('');

  // Add mapped fields with transformations
  mappings.forEach((mapping) => {
    if (!mapping.targetField || !mapping.sourceField) return;

    // Use safe optional chaining for nested paths
    const sourceAccess = generateSafeAccess(mapping.sourceField);
    let valueExpression = sourceAccess;

    // Apply transformations
    switch (mapping.transform) {
      case 'trim':
        valueExpression = `${sourceAccess}?.toString().trim()`;
        break;
      case 'upper':
        valueExpression = `${sourceAccess}?.toString().toUpperCase()`;
        break;
      case 'lower':
        valueExpression = `${sourceAccess}?.toString().toLowerCase()`;
        break;
      case 'date':
        valueExpression = `${sourceAccess} ? new Date(${sourceAccess}).toISOString() : null`;
        break;
      case 'default':
        if (mapping.defaultValue) {
          valueExpression = `${sourceAccess} || ${JSON.stringify(mapping.defaultValue)}`;
        }
        break;
      case 'none':
      default:
        valueExpression = sourceAccess;
    }

    lines.push(`result.${mapping.targetField} = ${valueExpression};`);
  });

  // Add static fields
  if (staticFields.length > 0) {
    lines.push('');
    lines.push('// Static fields');
    staticFields.forEach((field) => {
      if (field.key) {
        // Try to parse as number/boolean, otherwise use string
        let value: string;
        if (field.value === 'true' || field.value === 'false') {
          value = field.value;
        } else if (!isNaN(Number(field.value)) && field.value !== '') {
          value = field.value;
        } else {
          value = JSON.stringify(field.value);
        }
        lines.push(`result.${field.key} = ${value};`);
      }
    });
  }

  lines.push('');
  lines.push('return result;');

  return lines.join('\n');
};

const FieldMapperRow = ({
  row,
  onChange,
  onRemove,
  availableFields,
  onDropSource,
  isDragActive,
  required,
  requiredMissing,
  lookupTypes = []
}: {
  row: MappingRow;
  onChange: (next: Partial<MappingRow>) => void;
  onRemove: () => void;
  availableFields: Array<{ key: string; label: string; type: string }>;
  onDropSource: (fieldKey: string) => void;
  isDragActive: boolean;
  required?: boolean;
  requiredMissing?: boolean;
  lookupTypes?: string[];
}) => {
  const [isDragOver, setIsDragOver] = useState(false);
  const { spacing, token, shadows, transitions, combineTransitions, createTransition } = useDesignTokens();
  const colors = cssVar.legacy;
  const tagTone = makeTagTone(token, spacing, colors);

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const key = e.dataTransfer.getData('text/sourceField');
    if (key) {
      onDropSource(key);
    }
    setIsDragOver(false);
  };

  return (
    <Card
      size="small"
      style={{
        borderRadius: token.borderRadiusLG,
        border: `1px solid ${isDragOver ? colors.primary[300] : cssVar.border.default}`,
        marginBottom: spacing[2],
        boxShadow: isDragOver ? shadows.md : shadows.sm,
        transition: combineTransitions(
          createTransition('border-color', 'fast'),
          createTransition('box-shadow', 'fast'),
          createTransition('transform', 'fast')
        ),
        transform: isDragOver ? 'translateY(-1px)' : undefined,
        background: isDragActive
          ? `linear-gradient(120deg, ${withAlpha(colors.primary[200], 0.12)}, ${withAlpha(colors.primary[100], 0.08)})`
          : cssVar.bg.surface
      }}
      bodyStyle={{ padding: spacing[3] }}
      onDragOver={(e) => {
        e.preventDefault();
        setIsDragOver(true);
      }}
      onDragLeave={() => setIsDragOver(false)}
      onDrop={handleDrop}
    >
      <Flex align="center" gap={spacingToNumber(spacing[3])} wrap>
        <Input
          placeholder="output field"
          value={row.targetField}
          onChange={(e) => onChange({ targetField: e.target.value })}
          style={{ minWidth: 180 }}
        />
        {required && (
          <Space size={spacingToNumber(spacing[1])}>
            <Tag style={tagTone(requiredMissing ? colors.error[600] : colors.success[600])}>
              {requiredMissing ? 'Map required' : 'Required'}
            </Tag>
            {requiredMissing && (
              <Tooltip title={getRequiredHint(row.targetField)}>
                <QuestionCircleOutlined style={{ color: colors.warning[600] }} />
              </Tooltip>
            )}
          </Space>
        )}
        <Select
          placeholder="Select source"
          style={{ minWidth: 220 }}
          value={row.sourceField}
          onChange={(val) => onChange({ sourceField: val })}
          showSearch
          filterOption={(input, option) =>
            (option?.label as any)?.props?.children?.[0]?.props?.children?.toLowerCase().includes(input.toLowerCase()) ||
            (option?.value as string)?.toLowerCase().includes(input.toLowerCase())
          }
          options={availableFields.map((f: any) => ({
            label: (
              <Space size={4}>
                <span>{f.label}</span>
                {f.typeBadge && (
                  <Tag
                    color={f.type === 'array' ? 'blue' : 'purple'}
                    style={{ fontSize: '10px', lineHeight: '16px', marginLeft: 4 }}
                  >
                    {f.typeBadge}
                  </Tag>
                )}
                {f.isComplex && (
                  <Tooltip
                    title={
                      f.type === 'array'
                        ? `Array field - use bracket notation: ${f.key}[0].fieldName`
                        : `Object field - use dot notation: ${f.key}.fieldName`
                    }
                  >
                    <InfoCircleOutlined style={{ color: colors.info[500], fontSize: '12px' }} />
                  </Tooltip>
                )}
              </Space>
            ),
            value: f.key
          }))}
        />
        <Select
          placeholder="Transform"
          style={{ minWidth: 150 }}
          value={row.transform}
          onChange={(val) => onChange({ transform: val as TransformKind })}
            options={[
              { value: 'none', label: 'None' },
              { value: 'trim', label: 'Trim string' },
              { value: 'upper', label: 'Uppercase' },
              { value: 'lower', label: 'Lowercase' },
            { value: 'date', label: 'Format date (ISO)' },
            { value: 'default', label: 'Default if empty' },
            { value: 'lookup', label: 'Lookup code mapping' }
          ]}
        />
        {row.transform === 'lookup' && (
          <Select
            placeholder="Select lookup type"
            style={{ minWidth: 200 }}
            value={row.lookupType ? [row.lookupType] : []}
            onChange={(val) => {
              const lookupType = Array.isArray(val) && val.length > 0 ? val[0] : '';
              onChange({ lookupType });
            }}
            showSearch
            mode="tags"
            maxCount={1}
            tokenSeparators={[',']}
            options={lookupTypes.map(t => ({ label: t, value: t }))}
            notFoundContent={
              <Typography.Text type="secondary" style={{ fontSize: 12, padding: 8, display: 'block' }}>
                No lookup types found. Type to create new (e.g., SERVICE_CODE)
              </Typography.Text>
            }
          />
        )}
        {row.transform === 'default' && (
          <Input
            placeholder="Fallback value"
            style={{ minWidth: 140 }}
            value={row.defaultValue}
            onChange={(e) => onChange({ defaultValue: e.target.value })}
          />
        )}
        <Button
          aria-label="Remove mapping"
          icon={<DeleteOutlined />}
          type="text"
          danger
          onClick={onRemove}
        />
      </Flex>
      {row.helper && (
        <Typography.Text type="secondary" style={{ fontSize: token.fontSizeSM, marginTop: spacing[2], display: 'block' }}>
          {row.helper}
        </Typography.Text>
      )}
    </Card>
  );
};

const AIFieldMappingSuggestionsModal = ({
  visible,
  onClose,
  onApply,
  availableFields,
  currentMappings,
  apiContext
}: {
  visible: boolean;
  onClose: () => void;
  onApply: (suggestions: AIFieldMapping[]) => void;
  availableFields: Array<{ key: string; label: string; type: string; path?: string }>;
  currentMappings: MappingRow[];
  apiContext?: string;
}) => {
  const { spacing, token, transitions } = useDesignTokens();
  const colors = cssVar.legacy;
  const { orgId } = useTenant();
  const { message } = App.useApp();
  const [loading, setLoading] = useState(false);
  const [suggestions, setSuggestions] = useState<AIFieldMapping[]>([]);
  const [selectedSuggestions, setSelectedSuggestions] = useState<Set<number>>(new Set());

  useEffect(() => {
    if (visible) {
      // Always regenerate when modal opens (clear cache)
      setSuggestions([]);
      setSelectedSuggestions(new Set());
      handleGenerateSuggestions();
    }
  }, [visible]);

  const handleGenerateSuggestions = async () => {
    setLoading(true);
    try {
      if (!orgId) {
        throw new Error('Entity not found');
      }

      // Extract target fields from current mappings
      const targetFields = currentMappings
        .map(m => m.targetField)
        .filter(Boolean);

      if (targetFields.length === 0) {
        message.warning('Please add some target fields first');
        onClose();
        return;
      }

      // Format source fields for AI
      const sourceFields = availableFields.map(f => ({
        path: f.path || f.key,
        type: f.type,
        description: f.label
      }));

      const response = await suggestFieldMappings(orgId, {
        sourceFields,
        targetFields,
        apiContext: apiContext || 'Generic API integration'
      });

      setSuggestions(response.mappings);
      // Select all by default
      setSelectedSuggestions(new Set(response.mappings.map((_, idx) => idx)));
      message.success(`Generated ${response.mappings.length} mapping suggestions`);
    } catch (error: any) {
      message.error(error.message || 'Failed to generate suggestions');
      onClose();
    } finally {
      setLoading(false);
    }
  };

  const handleApply = () => {
    const selected = suggestions.filter((_, idx) => selectedSuggestions.has(idx));
    onApply(selected);
    // Clear state before closing
    setSuggestions([]);
    setSelectedSuggestions(new Set());
    onClose();
  };

  const toggleSuggestion = (index: number) => {
    const newSelected = new Set(selectedSuggestions);
    if (newSelected.has(index)) {
      newSelected.delete(index);
    } else {
      newSelected.add(index);
    }
    setSelectedSuggestions(newSelected);
  };

  const getConfidenceColor = (confidence: number) => {
    if (confidence >= 0.8) return colors.success[600];
    if (confidence >= 0.6) return colors.warning[600];
    return colors.error[600];
  };

  return (
    <Modal
      open={visible}
      onCancel={onClose}
      title={
        <Space>
          <BulbOutlined style={{ color: colors.primary[600] }} />
          <span>AI Field Mapping Suggestions</span>
        </Space>
      }
      width={800}
      footer={[
        <Button key="cancel" onClick={onClose}>
          Cancel
        </Button>,
        <Button
          key="apply"
          type="primary"
          onClick={handleApply}
          disabled={selectedSuggestions.size === 0}
          icon={<CheckOutlined />}
        >
          Apply {selectedSuggestions.size > 0 && `(${selectedSuggestions.size})`}
        </Button>
      ]}
    >
      {loading ? (
        <div style={{ textAlign: 'center', padding: spacing[10] }}>
          <Spin size="large" />
          <Typography.Text
            type="secondary"
            style={{ display: 'block', marginTop: spacing[3] }}
          >
            Analyzing fields and generating suggestions...
          </Typography.Text>
        </div>
      ) : (
        <Space direction="vertical" size={spacingToNumber(spacing[3])} style={{ width: '100%' }}>
          <Alert
            type="info"
            message="Review AI-generated mappings"
            description="Select the mappings you want to apply. You can customize them after applying."
            showIcon
          />

          <div style={{ maxHeight: 500, overflowY: 'auto' }}>
            <Space direction="vertical" size={spacingToNumber(spacing[2])} style={{ width: '100%' }}>
              {suggestions.map((suggestion, index) => {
                const isSelected = selectedSuggestions.has(index);
                return (
                  <Card
                    key={index}
                    size="small"
                    style={{
                      border: `2px solid ${isSelected ? colors.primary[400] : cssVar.border.default}`,
                      borderRadius: token.borderRadiusLG,
                      cursor: 'pointer',
                      transition: transitions.all,
                      background: isSelected ? withAlpha(colors.primary[100], 0.3) : cssVar.bg.surface
                    }}
                    onClick={() => toggleSuggestion(index)}
                    bodyStyle={{ padding: spacing[3] }}
                  >
                    <Flex justify="space-between" align="center">
                      <Space direction="vertical" size={spacingToNumber(spacing[1])} style={{ flex: 1 }}>
                        <Flex align="center" gap={spacingToNumber(spacing[2])}>
                          <Typography.Text strong style={{ fontSize: 14 }}>
                            {suggestion.targetField}
                          </Typography.Text>
                          <ArrowRightOutlined
                            style={{ color: token.colorTextTertiary, fontSize: 12 }}
                          />
                          <Typography.Text code style={{ fontSize: 13 }}>
                            {suggestion.sourceField}
                          </Typography.Text>
                          {suggestion.transformation && suggestion.transformation !== 'none' && (
                            <Tag color="blue" style={{ fontSize: 11 }}>
                              {suggestion.transformation}
                            </Tag>
                          )}
                        </Flex>
                        <Space size={spacingToNumber(spacing[2])}>
                          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                            Confidence:
                          </Typography.Text>
                          <Progress
                            percent={Math.round(suggestion.confidence * 100)}
                            size="small"
                            strokeColor={getConfidenceColor(suggestion.confidence)}
                            style={{ width: 120 }}
                          />
                          {suggestion.fallback && (
                            <Tooltip title={`Fallback: ${suggestion.fallback}`}>
                              <InfoCircleOutlined style={{ color: colors.info[500] }} />
                            </Tooltip>
                          )}
                        </Space>
                      </Space>
                      {isSelected ? (
                        <CheckCircleFilled style={{ fontSize: 24, color: colors.primary[600] }} />
                      ) : (
                        <div
                          style={{
                            width: 24,
                            height: 24,
                            borderRadius: '50%',
                            border: `2px solid ${cssVar.border.default}`
                          }}
                        />
                      )}
                    </Flex>
                  </Card>
                );
              })}
            </Space>
          </div>

          {suggestions.length === 0 && !loading && (
            <div
              style={{
                textAlign: 'center',
                padding: spacing[10],
                color: token.colorTextSecondary
              }}
            >
              <Typography.Text type="secondary">
                No suggestions available. Add some target fields first.
              </Typography.Text>
            </div>
          )}
        </Space>
      )}
    </Modal>
  );
};

const StaticFieldEditor = ({
  fields,
  onChange
}: {
  fields: StaticField[];
  onChange: (next: StaticField[]) => void;
}) => {
  const { spacing, token } = useDesignTokens();

  const addField = () =>
    onChange([
      ...fields,
      { id: crypto.randomUUID(), key: '', value: '' }
    ]);
  const updateField = (id: string, patch: Partial<StaticField>) => {
    onChange(fields.map((f) => (f.id === id ? { ...f, ...patch } : f)));
  };
  const removeField = (id: string) => onChange(fields.filter((f) => f.id !== id));

  return (
    <div style={{ paddingTop: spacing[2] }}>
      {fields.map((field) => (
        <div
          key={field.id}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: spacing[2],
            marginBottom: spacing[1.5],
            padding: `${spacing[1.5]} ${spacing[2]}`,
            background: cssVar.bg.surface,
            border: `1px solid ${cssVar.border.default}`,
            borderRadius: token.borderRadius
          }}
        >
          <Input
            placeholder="Key"
            value={field.key}
            onChange={(e) => updateField(field.id, { key: e.target.value })}
            style={{ width: 180 }}
          />
          <Input
            placeholder="Value"
            value={field.value}
            onChange={(e) => updateField(field.id, { value: e.target.value })}
            style={{ flex: 1 }}
          />
          <Button icon={<DeleteOutlined />} type="text" danger size="small" onClick={() => removeField(field.id)} />
        </div>
      ))}
      <Button type="dashed" icon={<PlusOutlined />} onClick={addField} block size="small">
        Add Field
      </Button>
    </div>
  );
};

const SimpleMappingTab = ({
  mappings,
  onMappingsChange,
  staticFields,
  onStaticFieldsChange,
  availableFields,
  availableFieldTree = []
}: {
  mappings: MappingRow[];
  onMappingsChange: (next: MappingRow[]) => void;
  staticFields: StaticField[];
  onStaticFieldsChange: (next: StaticField[]) => void;
  availableFields: Array<{ key: string; label: string; type: string }>;
  availableFieldTree?: any[];
}) => {
  const { spacing, token, transitions } = useDesignTokens();
  const colors = cssVar.legacy;
  const { message } = App.useApp();
  const tagTone = makeTagTone(token, spacing, colors);
  const screens = Grid.useBreakpoint();
  const isNarrow = !screens.md;
  const rowGridTemplate = isNarrow
    ? '1fr'
    : '160px 16px minmax(280px, 2fr) minmax(200px, 1fr) 32px';
  const labelStyle = { display: 'block', marginBottom: spacing[1], fontSize: 11 };

  // AI Field Mapping Suggestions
  const { isAvailable: isAIAvailable } = useAIStatus();
  const [showAISuggestions, setShowAISuggestions] = useState(false);

  // Fetch available lookup types
  const { data: typesData } = useQuery({
    queryKey: ['lookup-types'],
    queryFn: getLookupTypes
  });
  const lookupTypes = typesData?.types || [];

  const updateMapping = (id: string, patch: Partial<MappingRow>) => {
    onMappingsChange(mappings.map((m) => (m.id === id ? { ...m, ...patch } : m)));
  };

  const removeMapping = (id: string) => {
    onMappingsChange(mappings.filter((m) => m.id !== id));
  };

  const addMapping = () => {
    onMappingsChange([
      ...mappings,
      {
        id: crypto.randomUUID(),
        targetField: '',
        sourceField: '',
        transform: 'none'
      }
    ]);
  };

  const handleApplyAISuggestions = (suggestions: AIFieldMapping[]) => {
    // Map AI suggestions to MappingRow format
    const aiMappings = suggestions.map(s => ({
      id: crypto.randomUUID(),
      targetField: s.targetField,
      sourceField: s.sourceField,
      transform: (s.transformation as TransformKind) || 'none',
      defaultValue: s.fallback || undefined
    }));

    // Create a map of target fields from AI suggestions
    const aiMap = new Map(aiMappings.map(m => [m.targetField, m]));

    let updatedCount = 0;
    let newCount = 0;

    // Update existing mappings with AI suggestions, or keep existing if no suggestion
    const updatedMappings = mappings.map(m => {
      const aiSuggestion = aiMap.get(m.targetField);
      if (aiSuggestion) {
        aiMap.delete(m.targetField); // Mark as applied
        updatedCount++;
        return aiSuggestion; // Replace with AI suggestion
      }
      return m; // Keep existing mapping
    });

    // Add remaining AI suggestions that don't match existing target fields
    const newSuggestions = Array.from(aiMap.values());
    newCount = newSuggestions.length;

    const finalMappings = [...updatedMappings, ...newSuggestions];

    onMappingsChange(finalMappings);

    const parts = [];
    if (updatedCount > 0) parts.push(`${updatedCount} updated`);
    if (newCount > 0) parts.push(`${newCount} new`);
    message.success(`Applied ${aiMappings.length} AI mapping${aiMappings.length !== 1 ? 's' : ''} (${parts.join(', ')})`);
  };

  return (
    <div style={{ width: '100%' }}>
      {/* Compact help hint */}
      <Space align="center" style={{ marginBottom: spacing[3] }}>
        <Typography.Title level={5} style={{ margin: 0 }}>
          Field Mappings
        </Typography.Title>
        {mappings.length > 0 && (
          <Tag color="blue">{mappings.length}</Tag>
        )}
        <Tooltip title="Use dot notation for nested fields (e.g., patient.phoneNumber) or array indices (e.g., Bill[0].billNumber)">
          <InfoCircleOutlined style={{ color: colors.info[500], cursor: 'help' }} />
        </Tooltip>
      </Space>

      {/* Examples collapsible */}
      <Collapse
        size="small"
        ghost
        style={{ marginBottom: spacing[3] }}
        items={[{
          key: 'mapping-examples',
          label: (
            <Space size={4}>
              <BulbOutlined style={{ color: colors.warning[600] }} />
              <Typography.Text strong style={{ fontSize: 13 }}>
                Field Mapping Examples
              </Typography.Text>
            </Space>
          ),
          children: (
            <div style={{ fontSize: 12 }}>
              <Typography.Text style={{ display: 'block', marginBottom: 8 }}>
                <strong>How to use Lookup transform:</strong> Translate codes between your source system and external systems
              </Typography.Text>

              <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' }}>
                <div>
                  <Typography.Text strong style={{ fontSize: 11, color: colors.primary[600] }}>BASIC LOOKUP</Typography.Text>
                  <div style={{ marginTop: 4, padding: spacing[2], background: colors.primary[50], borderRadius: 4, border: `1px solid ${colors.primary[200]}` }}>
                    <div>Source: <code>serviceCode</code></div>
                    <div>Transform: <strong>Lookup</strong></div>
                    <div>Lookup Type: <code>SERVICE_CODE</code></div>
                    <div>Target: <code>externalCode</code></div>
                  </div>
                  <Typography.Text type="secondary" style={{ fontSize: 11, display: 'block', marginTop: 4 }}>
                    Translates SRC_123 → EXT_ABC
                  </Typography.Text>
                </div>

                <div>
                  <Typography.Text strong style={{ fontSize: 11, color: colors.primary[600] }}>NESTED FIELD LOOKUP</Typography.Text>
                  <div style={{ marginTop: 4, padding: spacing[2], background: colors.primary[50], borderRadius: 4, border: `1px solid ${colors.primary[200]}` }}>
                    <div>Source: <code>patient.doctorId</code></div>
                    <div>Transform: <strong>Lookup</strong></div>
                    <div>Lookup Type: <code>PROVIDER_ID</code></div>
                    <div>Target: <code>providerId</code></div>
                  </div>
                  <Typography.Text type="secondary" style={{ fontSize: 11, display: 'block', marginTop: 4 }}>
                    Works with nested source fields
                  </Typography.Text>
                </div>

                <div>
                  <Typography.Text strong style={{ fontSize: 11, color: colors.primary[600] }}>ARRAY FIELD LOOKUP</Typography.Text>
                  <div style={{ marginTop: 4, padding: spacing[2], background: colors.primary[50], borderRadius: 4, border: `1px solid ${colors.primary[200]}` }}>
                    <div>Source: <code>items[].code</code></div>
                    <div>Transform: <strong>Lookup</strong></div>
                    <div>Lookup Type: <code>ITEM_CODE</code></div>
                    <div>Target: <code>items[].externalCode</code></div>
                  </div>
                  <Typography.Text type="secondary" style={{ fontSize: 11, display: 'block', marginTop: 4 }}>
                    Translates codes in array items
                  </Typography.Text>
                </div>
              </div>

              <Alert
                type="info"
                showIcon
                style={{ marginTop: 12, fontSize: 11 }}
                message={
                  <span>
                    <strong>Note:</strong> Lookup tables must be configured first in the <a href="/lookups">Lookups</a> section.
                    If no mapping is found, the original value is kept (passthrough behavior).
                  </span>
                }
              />
            </div>
          )
        }]}
      />

      {mappings.length === 0 && (
        <Typography.Text type="secondary" style={{ display: 'block', marginBottom: spacing[3] }}>
          Map event fields to your target API schema
        </Typography.Text>
      )}

      {/* Cleaner table-like layout */}
      <Space direction="vertical" style={{ width: '100%' }} size={spacingToNumber(spacing[1.5])}>
        {!isNarrow && (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: rowGridTemplate,
              gap: spacing[2],
              padding: `0 ${spacing[1]}`
            }}
          >
            <Typography.Text type="secondary" style={{ fontSize: 11 }}>Target field</Typography.Text>
            <span />
            <Typography.Text type="secondary" style={{ fontSize: 11 }}>Source field</Typography.Text>
            <Typography.Text type="secondary" style={{ fontSize: 11 }}>Transform</Typography.Text>
            <span />
          </div>
        )}
        {mappings.map((row) => (
          <div
            key={row.id}
            style={{
              display: 'grid',
              gridTemplateColumns: rowGridTemplate,
              alignItems: isNarrow ? 'stretch' : 'center',
              gap: spacing[2],
              padding: `${spacing[2]} ${spacing[3]}`,
              background: cssVar.bg.surface,
              border: `1px solid ${cssVar.border.default}`,
              borderRadius: token.borderRadius,
              transition: transitions.all
            }}
          >
            <div>
              {isNarrow && (
                <Typography.Text type="secondary" style={labelStyle}>
                  Target field
                </Typography.Text>
              )}
              <Input
                placeholder="Target field"
                style={{ width: isNarrow ? '100%' : 140 }}
                value={row.targetField}
                onChange={(e) => updateMapping(row.id, { targetField: e.target.value })}
              />
            </div>
            {!isNarrow && (
              <ArrowRightOutlined style={{ color: token.colorTextTertiary, fontSize: 12 }} />
            )}
            <div>
              {isNarrow && (
                <Typography.Text type="secondary" style={labelStyle}>
                  Source field
                </Typography.Text>
              )}
              <TreeSelect
                placeholder="Select source field"
                style={{ width: '100%' }}
                value={row.sourceField}
                onChange={(val) => updateMapping(row.id, { sourceField: val as string })}
                treeData={availableFieldTree}
                treeDefaultExpandAll
                showSearch
                dropdownStyle={{ maxHeight: 360, overflow: 'auto' }}
                filterTreeNode={(input, node) => {
                  const titleText = (node.title as any)?.props?.children?.map((c: any) => (typeof c === 'string' ? c : c?.props?.children)).join(' ') || '';
                  return titleText.toLowerCase().includes(input.toLowerCase()) || (node.key as string).toLowerCase().includes(input.toLowerCase());
                }}
                fieldNames={{ label: 'title', value: 'value', children: 'children' }}
              />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: spacing[2] }}>
              {isNarrow && (
                <Typography.Text type="secondary" style={labelStyle}>
                  Transform
                </Typography.Text>
              )}
              <Select
                placeholder="Transform"
                style={{ width: '100%' }}
                value={row.transform || 'none'}
                onChange={(val) => updateMapping(row.id, { transform: val as TransformKind })}
                options={[
                  { value: 'none', label: 'None' },
                  { value: 'trim', label: 'Trim' },
                  { value: 'upper', label: 'Upper' },
                  { value: 'lower', label: 'Lower' },
                  { value: 'date', label: 'ISO Date' },
                  { value: 'default', label: 'Default' },
                  { value: 'lookup', label: 'Lookup' }
                ]}
              />
              {row.transform === 'lookup' && (
                <div>
                  {isNarrow && (
                    <Typography.Text type="secondary" style={labelStyle}>
                      Lookup Type
                    </Typography.Text>
                  )}
                  <Select
                    placeholder="Select lookup type"
                    style={{ width: '100%' }}
                    value={row.lookupType ? [row.lookupType] : []}
                    onChange={(val) => {
                      const lookupType = Array.isArray(val) && val.length > 0 ? val[0] : '';
                      updateMapping(row.id, { lookupType });
                    }}
                    showSearch
                    mode="tags"
                    maxCount={1}
                    tokenSeparators={[',']}
                    options={lookupTypes.map(t => ({ label: t, value: t }))}
                    notFoundContent={
                      <Typography.Text type="secondary" style={{ fontSize: 12, padding: 8, display: 'block' }}>
                        No lookup types found. Type to create new (e.g., SERVICE_CODE)
                      </Typography.Text>
                    }
                  />
                </div>
              )}
              {row.transform === 'default' && (
                <div>
                  {isNarrow && (
                    <Typography.Text type="secondary" style={labelStyle}>
                      Default Value
                    </Typography.Text>
                  )}
                  <Input
                    placeholder="Default value"
                    style={{ width: '100%' }}
                    value={row.defaultValue}
                    onChange={(e) => updateMapping(row.id, { defaultValue: e.target.value })}
                  />
                </div>
              )}
            </div>
            <div style={{ display: 'flex', justifyContent: isNarrow ? 'flex-end' : 'center' }}>
              <Button
                icon={<DeleteOutlined />}
                type="text"
                danger
                size="small"
                onClick={() => removeMapping(row.id)}
              />
            </div>
          </div>
        ))}
      </Space>

      <Flex gap={spacingToNumber(spacing[2])} style={{ marginTop: spacing[2] }}>
        <Button
          type="dashed"
          icon={<PlusOutlined />}
          onClick={addMapping}
          style={{ flex: 1 }}
        >
          Add Mapping
        </Button>
        {isAIAvailable && mappings.length > 0 && (
          <Button
            icon={<RocketOutlined />}
            onClick={() => setShowAISuggestions(true)}
            style={{
              flex: 1,
              background: `linear-gradient(135deg, ${colors.purple?.[500] || '#9c27b0'}, ${colors.purple?.[600] || '#7b1fa2'})`,
              color: 'white',
              border: 'none'
            }}
          >
            AI Suggest Mappings
          </Button>
        )}
      </Flex>

      {/* AI Field Mapping Suggestions Modal */}
      {isAIAvailable && (
        <AIFieldMappingSuggestionsModal
          visible={showAISuggestions}
          onClose={() => {
            setShowAISuggestions(false);
          }}
          onApply={handleApplyAISuggestions}
          availableFields={availableFields}
          currentMappings={mappings}
        />
      )}

      {/* Static Fields - Collapsed by default */}
      <Divider style={{ margin: `${spacing[4]} 0 ${spacing[3]} 0` }} />
      <Collapse
        ghost
        items={[
          {
            key: 'static',
            label: (
              <Space>
                <Typography.Text strong>Static Fields</Typography.Text>
                {staticFields.length > 0 && (
                  <Tag color="green">{staticFields.length}</Tag>
                )}
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  (Optional)
                </Typography.Text>
              </Space>
            ),
            children: <StaticFieldEditor fields={staticFields} onChange={onStaticFieldsChange} />
          }
        ]}
      />
    </div>
  );
};
const JavascriptTab = ({
  scriptValue,
  onScriptChange,
  onValidate,
  onReset,
  onOpenAI,
  onExplainCode,
  onFixWithAI,
  onApplyFix,
  availableFields,
  validationStatus,
  validationMessage,
  aiExplainResult,
  aiExplainLoading
}: {
  scriptValue: string;
  onScriptChange: (val: string) => void;
  onValidate?: () => void;
  onReset: () => void;
  onOpenAI?: () => void;
  onExplainCode?: () => void;
  onFixWithAI?: () => void;
  onApplyFix?: () => void;
  availableFields: Array<{ key: string; label: string; type: string }>;
  validationStatus?: 'idle' | 'success' | 'error';
  validationMessage?: string;
  aiExplainResult?: ExplainTransformationResult | null;
  aiExplainLoading?: boolean;
}) => {
  const { spacing, token } = useDesignTokens();
  const colors = cssVar.legacy;

  return (
    <div className="panel" style={{ padding: spacing[3], borderRadius: token.borderRadiusLG }}>
      <Space direction="vertical" size={spacingToNumber(spacing[2])} style={{ width: '100%' }}>
        <Flex justify="space-between" align="center">
          <div>
            <Typography.Title level={5} style={{ margin: 0 }}>
              JavaScript Transform
            </Typography.Title>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              Available: <code>payload</code>, <code>context</code>
              <Tooltip title="Sandbox environment: No network, filesystem, or imports. 10s timeout.">
                <InfoCircleOutlined style={{ marginLeft: 6, color: colors.info[500], cursor: 'help' }} />
              </Tooltip>
            </Typography.Text>
          </div>
          <Collapse
            ghost
            items={[
              {
                key: 'example',
                label: (
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    <CodeOutlined /> Example
                  </Typography.Text>
                ),
                children: (
                  <pre
                    style={{
                      margin: 0,
                      whiteSpace: 'pre-wrap',
                      fontFamily: token.fontFamilyCode,
                      fontSize: 12,
                      padding: spacing[2],
                      background: colors.neutral[900],
                      color: colors.neutral[50],
                      borderRadius: token.borderRadius
                    }}
                  >
{`const result = {
  event_type: context.eventType,
  patient_id: payload.patientRID,
  patient_name: payload.patientName
};
return result;`}
                  </pre>
                )
              }
            ]}
          />
        </Flex>

        <Flex align="center" gap={spacingToNumber(spacing[2])} wrap>
          {onOpenAI && (
            <Space direction="vertical" size={4}>
              <Button
                icon={<RocketOutlined />}
                type="primary"
                onClick={onOpenAI}
                size="small"
                style={{
                  background: `linear-gradient(135deg, ${colors.primary[500]}, ${colors.primary[600]})`,
                  border: 'none'
                }}
              >
                AI Assistant
              </Button>
              <Typography.Text type="secondary" style={{ fontSize: 11, display: 'block' }}>
                Review before use. Do not include real patient data.
              </Typography.Text>
            </Space>
          )}
          <Dropdown
            menu={{
              items: availableFields.map((field: any) => ({
                key: field.path || field.key,
                label: (
                  <Space size={4} style={{ paddingLeft: (field.depth || 0) * 8 }}>
                    <span>{field.label}</span>
                    {field.typeBadge && (
                      <Tag
                        color={field.type === 'array' ? 'blue' : 'purple'}
                        style={{ fontSize: '10px', lineHeight: '16px' }}
                      >
                        {field.typeBadge}
                      </Tag>
                    )}
                    <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                      {field.path || field.key}
                    </Typography.Text>
                  </Space>
                ),
                onClick: () => {
                  const safeAccess = generateSafeAccess(field.path || field.key);
                  const comment = field.isComplex
                    ? `// ${field.label} (${field.type}) - use ${field.type === 'array' ? 'payload.' + (field.path || field.key) + '[0].fieldName' : 'payload.' + (field.path || field.key) + '.fieldName'}`
                    : `// ${field.label}`;
                  onScriptChange(`${scriptValue}\n${comment}\n${safeAccess}`);
                }
              }))
            }}
          >
            <Button icon={<FileAddOutlined />} size="small">Insert Field</Button>
          </Dropdown>
          <Button icon={<HighlightOutlined />} onClick={onValidate} size="small">
            Validate
          </Button>
          <Button icon={<UndoOutlined />} onClick={onReset} size="small">
            Reset
          </Button>
        </Flex>

        <Collapse
          size="small"
          ghost
          style={{ marginTop: spacing[3], marginBottom: spacing[2] }}
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
                  Use the <code>lookup(sourceCode, mappingType)</code> function to translate codes using your configured lookup tables:
                </Typography.Text>
                <pre style={{
                  background: colors.neutral[900],
                  color: colors.neutral[100],
                  padding: spacing[2],
                  borderRadius: 4,
                  fontSize: 12,
                  overflow: 'auto',
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
            border: `1px solid ${withAlpha(colors.neutral[900], 0.6)}`,
            boxShadow: token.boxShadowSecondary,
            marginTop: spacing[2]
          }}
        >
          <Editor
            height="400px"
            language="javascript"
            value={scriptValue}
            onChange={(value) => onScriptChange(value ?? '')}
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

        {validationStatus !== 'idle' && (
          <Alert
            type={validationStatus === 'success' ? 'success' : 'error'}
            showIcon
            message={validationStatus === 'success' ? 'Script validated' : 'Validation failed'}
            description={validationMessage}
            style={{ borderRadius: token.borderRadiusLG, marginTop: spacing[2] }}
          />
        )}

        {(onExplainCode || onFixWithAI) && (
          <Flex gap={spacingToNumber(spacing[2])} wrap style={{ marginTop: spacing[2] }}>
            {onExplainCode && (
              <Button
                icon={<BulbOutlined />}
                size="small"
                onClick={onExplainCode}
                loading={aiExplainLoading}
                disabled={aiExplainLoading}
              >
                Explain this code
              </Button>
            )}
            {onFixWithAI && validationStatus === 'error' && (
              <Button
                icon={<ThunderboltOutlined />}
                size="small"
                type="primary"
                danger
                onClick={onFixWithAI}
                loading={aiExplainLoading}
                disabled={aiExplainLoading}
              >
                Fix with AI
              </Button>
            )}
          </Flex>
        )}

        {aiExplainLoading && (
          <Flex justify="center" style={{ padding: spacing[3] }}>
            <Spin size="small" />
            <Typography.Text type="secondary" style={{ marginLeft: spacing[2], fontSize: 13 }}>
              AI is analyzing your code...
            </Typography.Text>
          </Flex>
        )}

        {aiExplainResult && !aiExplainLoading && (
          <Card
            size="small"
            style={{ borderRadius: token.borderRadiusLG, marginTop: spacing[2], borderColor: token.colorPrimary }}
            title={
              <Space>
                <BulbOutlined style={{ color: token.colorPrimary }} />
                <Typography.Text strong style={{ fontSize: 13 }}>AI Analysis</Typography.Text>
              </Space>
            }
            extra={
              aiExplainResult.fixedCode && onApplyFix ? (
                <Button
                  type="primary"
                  size="small"
                  icon={<CheckOutlined />}
                  onClick={onApplyFix}
                >
                  Apply Fix
                </Button>
              ) : null
            }
          >
            <Space direction="vertical" size={spacingToNumber(spacing[2])} style={{ width: '100%' }}>
              <Typography.Paragraph style={{ fontSize: 13, marginBottom: 0 }}>
                {aiExplainResult.explanation}
              </Typography.Paragraph>

              {aiExplainResult.whatChanged && (
                <>
                  <Typography.Text strong style={{ fontSize: 12 }}>What changed:</Typography.Text>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {aiExplainResult.whatChanged}
                  </Typography.Text>
                </>
              )}

              {aiExplainResult.suggestions && aiExplainResult.suggestions.length > 0 && (
                <>
                  <Typography.Text strong style={{ fontSize: 12 }}>Suggestions:</Typography.Text>
                  <ul style={{ margin: 0, paddingLeft: 16 }}>
                    {aiExplainResult.suggestions.map((s, i) => (
                      <li key={i}>
                        <Typography.Text style={{ fontSize: 12 }}>{s}</Typography.Text>
                      </li>
                    ))}
                  </ul>
                </>
              )}

              {aiExplainResult.fixedCode && (
                <>
                  <Typography.Text strong style={{ fontSize: 12 }}>Fixed code:</Typography.Text>
                  <pre
                    style={{
                      margin: 0,
                      padding: spacing[2],
                      background: '#0d1117',
                      color: '#e6edf3',
                      borderRadius: token.borderRadius,
                      fontSize: 12,
                      overflowX: 'auto',
                      maxHeight: 200
                    }}
                  >
                    {aiExplainResult.fixedCode}
                  </pre>
                </>
              )}
            </Space>
          </Card>
        )}
      </Space>
    </div>
  );
};

/**
 * Get nested value from object using dot notation path
 * e.g., getNestedValue(obj, 'patient.mrn.documentNumber')
 */
const getNestedValue = (obj: any, path: string): any => {
  if (!path) return undefined;

  const keys = path
    .split('.')
    .flatMap((part) => part.split(/[\[\]]/).filter(Boolean)); // support array indices like items[0].field
  let value = obj;

  for (const key of keys) {
    if (value === null || value === undefined) return undefined;
    const isIndex = /^\d+$/.test(key);
    value = isIndex ? value[Number(key)] : value[key];
  }

  return value;
};

const applyTransform = (value: any, transform?: TransformKind, defaultValue?: string, lookupType?: string) => {
  if (value === undefined || value === null || value === '') {
    if (transform === 'default' && defaultValue !== undefined) return defaultValue;
  }
  if (typeof value === 'string') {
    if (transform === 'trim') return value.trim();
    if (transform === 'upper') return value.toUpperCase();
    if (transform === 'lower') return value.toLowerCase();
  }
  if (transform === 'date' && value) {
    const d = new Date(value);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  if (transform === 'lookup' && value && lookupType) {
    // Preview shows placeholder - actual lookup happens on backend
    return `[LOOKUP:${lookupType}(${value})]`;
  }
  return value;
};

const runSimpleMapping = (input: any, mappings: MappingRow[], staticFields: StaticField[]) => {
  const output: Record<string, unknown> = {};
  mappings.forEach((row) => {
    if (row.targetField && row.sourceField) {
      // Use nested value getter to support dot notation paths
      const raw = getNestedValue(input, row.sourceField);
      output[row.targetField] = applyTransform(raw, row.transform, row.defaultValue, row.lookupType);
    }
  });
  staticFields.forEach((field) => {
    if (field.key) {
      output[field.key] = field.value;
    }
  });
  return output;
};

const formatScript = (code: string) => {
  const lines = code.split('\n').map((l) => l.trim()).filter((l, idx, arr) => l.length > 0 || arr[idx + 1]?.trim().length > 0);
  let indent = 0;
  const formatted = lines.map((line) => {
    if (line.startsWith('}') || line.startsWith('];') || line === '}') {
      indent = Math.max(indent - 2, 0);
    }
    const padded = `${' '.repeat(indent)}${line}`;
    if (line.endsWith('{') || line.endsWith('[')) {
      indent += 2;
    }
    return padded;
  });
  return formatted.join('\n').trim();
};

const TestTransformationPanel = ({
  sampleInput,
  onSampleInputChange,
  eventPayload,
  onUseEventPayload,
  sampleOutput,
  onRunPreview,
  onLoadExample,
  onPaste,
  autoRun,
  onToggleAutoRun,
  lastRunMeta,
  currentEventType,
  onGenerateTestData
}: {
  sampleInput: string;
  onSampleInputChange: (val: string) => void;
  eventPayload?: unknown;
  onUseEventPayload?: (payloadText: string) => void;
  sampleOutput: string;
  onRunPreview: () => void;
  onLoadExample: () => void;
  onPaste: () => void;
  autoRun: boolean;
  onToggleAutoRun: (val: boolean) => void;
  lastRunMeta?: { durationMs?: number; status?: number };
  currentEventType?: string;
  onGenerateTestData?: () => void;
}) => {
  const { spacing, token } = useDesignTokens();
  const colors = cssVar.legacy;
  const tagTone = makeTagTone(token, spacing, colors);
  const eventPayloadText = useMemo(
    () => (eventPayload ? JSON.stringify(eventPayload, null, 2) : ''),
    [eventPayload]
  );

  const isSuccess = lastRunMeta?.status && lastRunMeta.status >= 200 && lastRunMeta.status < 300;
  const isError = lastRunMeta?.status && lastRunMeta.status >= 400;

  return (
    <Card className="panel" style={{ borderRadius: token.borderRadiusLG, padding: spacing[3] }}>
      <Flex align="center" justify="space-between" style={{ marginBottom: spacing[3] }}>
        <Space align="center">
          <Typography.Title level={5} style={{ margin: 0 }}>
            Test Preview
          </Typography.Title>
          {lastRunMeta?.durationMs && (
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {isSuccess && <CheckCircleFilled style={{ color: colors.success[600], marginRight: 4 }} />}
              {lastRunMeta.durationMs}ms
            </Typography.Text>
          )}
        </Space>
        <Space size={spacingToNumber(spacing[2])}>
          {onGenerateTestData && currentEventType && (
            <Button
              icon={<RocketOutlined />}
              onClick={onGenerateTestData}
              size="small"
              style={{
                background: `linear-gradient(135deg, ${colors.purple?.[500] || '#9c27b0'}, ${colors.purple?.[600] || '#7b1fa2'})`,
                color: 'white',
                border: 'none'
              }}
            >
              AI Generate
            </Button>
          )}
          <Dropdown
            menu={{
              items: [
                {
                  key: 'load',
                  label: 'Load example',
                  icon: <FileTextOutlined />,
                  onClick: onLoadExample
                },
                {
                  key: 'paste',
                  label: 'Paste from clipboard',
                  icon: <LinkOutlined />,
                  onClick: onPaste
                },
                eventPayloadText && {
                  key: 'schema',
                  label: 'Use event schema',
                  icon: <ReloadOutlined />,
                  onClick: () => onUseEventPayload?.(eventPayloadText)
                }
              ].filter(Boolean) as any
            }}
            placement="bottomRight"
          >
            <Button icon={<InfoCircleOutlined />} size="small">Load</Button>
          </Dropdown>
          <Space size={4}>
            <Switch checked={autoRun} onChange={onToggleAutoRun} size="small" />
            <Typography.Text style={{ fontSize: 12 }}>Auto</Typography.Text>
          </Space>
          <Button
            icon={<ThunderboltOutlined />}
            type="primary"
            onClick={onRunPreview}
            size="small"
          >
            Run
          </Button>
        </Space>
      </Flex>

      {/* Event Schema Reference - Collapsed */}
      {eventPayloadText && (
        <Collapse
          ghost
          style={{ marginBottom: spacing[2] }}
          items={[
            {
              key: 'schema',
              label: (
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  <InfoCircleOutlined /> Event Schema
                </Typography.Text>
              ),
              children: (
                <Input.TextArea
                  rows={5}
                  value={eventPayloadText}
                  readOnly
                  style={{
                    fontFamily: token.fontFamilyCode,
                    fontSize: 12,
                    background: colors.neutral[900],
                    color: colors.neutral[50]
                  }}
                />
              )
            }
          ]}
        />
      )}

      {/* Compact Input/Output Grid */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: spacing[2]
        }}
      >
        <div>
          <Typography.Text strong style={{ display: 'block', marginBottom: spacing[1.5], fontSize: 13 }}>
            Input
          </Typography.Text>
          <Input.TextArea
            rows={12}
            value={sampleInput}
            onChange={(e) => onSampleInputChange(e.target.value)}
            placeholder='{"patientRID": 12345}'
            style={{
              fontFamily: token.fontFamilyCode,
              fontSize: 12,
              background: colors.neutral[900],
              color: colors.neutral[50],
              borderRadius: token.borderRadius
            }}
          />
        </div>
        <div>
          <Flex justify="space-between" align="center" style={{ marginBottom: spacing[1.5] }}>
            <Typography.Text strong style={{ fontSize: 13 }}>Output</Typography.Text>
            {isError && <Tag color="error" style={{ margin: 0, fontSize: 11 }}>Error</Tag>}
            {isSuccess && <Tag color="success" style={{ margin: 0, fontSize: 11 }}>Success</Tag>}
          </Flex>
          <Input.TextArea
            rows={12}
            value={sampleOutput}
            readOnly
            style={{
              fontFamily: token.fontFamilyCode,
              fontSize: 12,
              background: colors.neutral[900],
              color: colors.neutral[50],
              borderRadius: token.borderRadius
            }}
          />
        </div>
      </div>
    </Card>
  );
};

export const TransformationSection = ({
  transformationTab,
  onChangeTab,
  scriptValue,
  onScriptChange,
  mappings: propMappings,
  onMappingsChange,
  staticFields: propStaticFields,
  onStaticFieldsChange,
  sampleInput,
  onSampleInputChange,
  sampleOutput,
  onSampleOutputChange,
  getPreviewContext,
  onValidateScript,
  eventPayload,
  onUseEventPayload,
  availableFields = defaultSourceFields,
  availableFieldTree = [],
  examplePayloads = [],
  onPreviewMeta,
  onRegisterRunPreview,
  onMissingRequiredChange,
  requiredAnchorRef,
  eventTypes = [],
  currentEventType
}: Props) => {
  const { message, modal } = App.useApp();
  const { spacing, token } = useDesignTokens();
  const colors = cssVar.legacy;
  const { orgId } = useTenant();
  const tagTone = makeTagTone(token, spacing, colors);
  const [draggingSource, setDraggingSource] = useState<string | undefined>(undefined);
  const [validationState, setValidationState] = useState<{ status: 'idle' | 'success' | 'error'; message?: string }>({ status: 'idle' });
  const [lastRunMeta, setLastRunMeta] = useState<{ durationMs?: number; status?: number }>();
  const [isAIModalVisible, setIsAIModalVisible] = useState(false);
  const [explainResult, setExplainResult] = useState<ExplainTransformationResult | null>(null);
  const [explainLoading, setExplainLoading] = useState(false);

  // Check if AI Assistant is available for this entity
  const { isAvailable: isAIAvailable } = useAIStatus();

  // Default mappings - start with empty array, let user define what they need
  const defaultMappings: MappingRow[] = [];

  const defaultStaticFields: StaticField[] = [];

  // Use controlled props if provided, otherwise fall back to defaults
  const mappings = propMappings !== undefined ? propMappings : defaultMappings;
  const setMappings = onMappingsChange || (() => {});
  const staticFields = propStaticFields !== undefined ? propStaticFields : defaultStaticFields;
  const setStaticFields = onStaticFieldsChange || (() => {});

  const [autoRun, setAutoRun] = useState(true);
  const [missingRequiredCount, setMissingRequiredCount] = useState(0);

  // No universal required fields - each integration has its own target API schema
  const requiredFields: string[] = [];
  useEffect(() => {
    onMissingRequiredChange?.(missingRequiredCount);
  }, [missingRequiredCount, onMissingRequiredChange]);

  const handleRunPreview = useCallback(() => {
    const started = performance.now();
    try {
      const parsed = JSON.parse(sampleInput || '{}');
      const ctx = getPreviewContext();
      if (transformationTab === 'SCRIPT') {
        const fn = new Function('payload', 'context', `${scriptValue}`);
        const result = fn(parsed, ctx);
        onSampleOutputChange(JSON.stringify(result, null, 2));
      } else {
        const mapped = runSimpleMapping(parsed, mappings, staticFields);
        mapped.event_type = mapped.event_type ?? ctx.eventType;
        onSampleOutputChange(JSON.stringify(mapped, null, 2));
      }
      const meta = { durationMs: Math.max(1, Math.round(performance.now() - started)), status: 200 };
      setLastRunMeta(meta);
      onPreviewMeta?.(meta);
      message.success('Preview generated');
    } catch (err: any) {
      message.error('Unable to generate preview. Check JSON or script syntax.');
      onSampleOutputChange(
        JSON.stringify(
          {
            error: err?.message ?? 'Unknown error',
            hint: transformationTab === 'SCRIPT' ? 'Validate your script.' : 'Check mapping and sample input.'
          },
          null,
          2
        )
      );
      const meta = { durationMs: Math.max(1, Math.round(performance.now() - started)), status: 500 };
      setLastRunMeta(meta);
      onPreviewMeta?.(meta);
    }
  }, [sampleInput, getPreviewContext, transformationTab, scriptValue, mappings, staticFields, onSampleOutputChange, onPreviewMeta, message]);

  useEffect(() => {
    onRegisterRunPreview?.(handleRunPreview);
  }, [handleRunPreview, onRegisterRunPreview]);

  const handleValidateScript = () => {
    try {
      const formatted = formatScript(scriptValue);
      onScriptChange(formatted);
      // Test with mock payload and context
      const mockPayload = {};
      const mockContext = { eventType: 'TEST_EVENT', tenantId: 100, entityName: 'Test Entity' };
      const fn = new Function('payload', 'context', formatted);
      const result = fn(mockPayload, mockContext);
      // Validate that result is an object
      if (typeof result !== 'object' || result === null) {
        throw new Error('Transform must return an object');
      }
      setValidationState({ status: 'success', message: 'Script validated successfully. Transform function returns an object.' });
      onValidateScript?.();
      message.success('Formatted and validated');
    } catch (err: any) {
      const msg = err?.message ?? 'Unknown error';
      setValidationState({ status: 'error', message: msg });
      message.error(`Validation failed: ${msg}`);
    }
  };

  const handleResetScript = () => {
    onScriptChange(`// Transform the incoming event payload
// Available: payload (event data), context (eventType, tenantId, entityName)
// lookup(sourceCode, mappingType) - Translate codes using lookup tables

// Example: Map payload fields to your target API format
const result = {
  // Add your field mappings here based on the selected event type
  event_type: context.eventType,
  source: "source-system",
  entity_name: context.entityName,

  // Using lookup tables to translate codes:
  // externalServiceCode: lookup(payload.serviceCode, 'SERVICE_CODE'),
  // providerID: lookup(payload.doctorId, 'PROVIDER_ID') || 'UNKNOWN',

  // Array mapping with lookups:
  // items: payload.items?.map(item => ({
  //   ...item,
  //   externalCode: lookup(item.code, 'ITEM_CODE')
  // }))
};

return result;`);
    message.success('Script reset');
  };

  const handleApplyAIScript = (script: string) => {
    onScriptChange(script);
    setIsAIModalVisible(false);
    message.success('AI-generated script applied');
  };

  const handleExplainCode = async () => {
    if (!orgId || !scriptValue?.trim()) return;
    setExplainLoading(true);
    setExplainResult(null);
    try {
      const result = await explainTransformation(orgId, { code: scriptValue, eventType: currentEventType });
      setExplainResult(result);
    } catch (err: any) {
      message.error(`AI explain failed: ${err.message || 'Unknown error'}`);
    } finally {
      setExplainLoading(false);
    }
  };

  const handleFixWithAI = async () => {
    if (!orgId || !scriptValue?.trim()) return;
    setExplainLoading(true);
    setExplainResult(null);
    try {
      const result = await explainTransformation(orgId, {
        code: scriptValue,
        errorMessage: validationState.message,
        eventType: currentEventType
      });
      setExplainResult(result);
    } catch (err: any) {
      message.error(`AI fix failed: ${err.message || 'Unknown error'}`);
    } finally {
      setExplainLoading(false);
    }
  };

  const handleApplyAIFix = () => {
    if (explainResult?.fixedCode) {
      onScriptChange(explainResult.fixedCode);
      setExplainResult(null);
      message.success('AI fix applied');
    }
  };

  const handleGenerateTestData = async () => {
    if (!currentEventType) {
      message.warning('Please select an event type first');
      return;
    }

    const hide = message.loading('Generating realistic test data with AI...', 0);
    try {
      if (!orgId) {
        throw new Error('Entity not found');
      }

      const response = await generateTestPayload(orgId, { eventType: currentEventType });
      const payloadText = JSON.stringify(response.payload, null, 2);
      onSampleInputChange(payloadText);
      if (autoRun) handleRunPreview();
      hide();
      message.success('AI-generated test payload loaded');
    } catch (error: any) {
      hide();
      message.error(error.message || 'Failed to generate test payload');
    }
  };

  return (
    <div className="panel" style={{ padding: spacing[3], borderRadius: token.borderRadiusLG }}>
      <Flex align="center" justify="space-between" style={{ marginBottom: spacing[3] }}>
        <div>
          <Typography.Title level={4} style={{ margin: 0 }}>
            Transformation
          </Typography.Title>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            Map event fields to your API format
          </Typography.Text>
        </div>
      </Flex>

      {/* Compact Tabs-style Mode Selection */}
      <Tabs
        activeKey={transformationTab}
        onChange={(key) => {
          const newMode = key as 'SIMPLE' | 'SCRIPT';
          const hasData = transformationTab === 'SIMPLE'
            ? mappings.some(m => m.sourceField && m.targetField) || staticFields.length > 0
            : scriptValue && scriptValue.trim().length > 0 && !scriptValue.includes('// Transform the incoming event payload');

          if (hasData) {
            modal.confirm({
              title: 'Switch mode?',
              content: `Switching will clear your ${transformationTab === 'SIMPLE' ? 'field mappings' : 'JavaScript code'}. Continue?`,
              okText: 'Switch',
              cancelText: 'Cancel',
              okButtonProps: { danger: true },
              onOk: () => {
                onChangeTab(newMode);
                message.info(`Switched to ${newMode === 'SIMPLE' ? 'Field Mapping' : 'JavaScript'}`);
              }
            });
          } else {
            onChangeTab(newMode);
          }
        }}
        items={[
          {
            key: 'SIMPLE',
            label: (
              <Space>
                <LinkOutlined />
                Field Mapping
              </Space>
            ),
            children: (
              <SimpleMappingTab
                mappings={mappings}
                onMappingsChange={setMappings}
                staticFields={staticFields}
                onStaticFieldsChange={setStaticFields}
                availableFields={availableFields}
                availableFieldTree={availableFieldTree}
              />
            )
          },
          {
            key: 'SCRIPT',
            label: (
              <Space>
                <CodeOutlined />
                JavaScript
              </Space>
            ),
            children: (
              <JavascriptTab
                scriptValue={scriptValue}
                onScriptChange={onScriptChange}
                onValidate={handleValidateScript}
                onReset={handleResetScript}
                onOpenAI={isAIAvailable ? () => setIsAIModalVisible(true) : undefined}
                onExplainCode={isAIAvailable ? handleExplainCode : undefined}
                onFixWithAI={isAIAvailable ? handleFixWithAI : undefined}
                onApplyFix={isAIAvailable && explainResult?.fixedCode ? handleApplyAIFix : undefined}
                availableFields={availableFields}
                validationStatus={validationState.status}
                validationMessage={validationState.message}
                aiExplainResult={explainResult}
                aiExplainLoading={explainLoading}
              />
            )
          }
        ]}
        style={{ marginBottom: spacing[3] }}
      />

      <Divider style={{ margin: `${spacing[3]} 0` }} />

      <TestTransformationPanel
        sampleInput={sampleInput}
        onSampleInputChange={(val) => {
          onSampleInputChange(val);
          if (autoRun) handleRunPreview();
        }}
        eventPayload={eventPayload}
        onUseEventPayload={(payloadText) => {
          onSampleInputChange(payloadText);
          if (autoRun) handleRunPreview();
        }}
        sampleOutput={sampleOutput}
        onRunPreview={handleRunPreview}
        onLoadExample={() => {
          onSampleInputChange(JSON.stringify(examplePayloads[0]?.payload ?? {}, null, 2));
          if (autoRun) handleRunPreview();
        }}
        onPaste={async () => {
          const text = await navigator.clipboard.readText();
          onSampleInputChange(text);
          if (autoRun) handleRunPreview();
        }}
        autoRun={autoRun}
        onToggleAutoRun={setAutoRun}
        lastRunMeta={lastRunMeta}
        currentEventType={currentEventType}
        onGenerateTestData={isAIAvailable ? handleGenerateTestData : undefined}
      />

      {/* AI Assistant Modal */}
      <AIAssistantModal
        visible={isAIModalVisible}
        onCancel={() => setIsAIModalVisible(false)}
        onApply={handleApplyAIScript}
        eventTypes={eventTypes}
        defaultEventType={currentEventType}
      />
    </div>
  );
};
