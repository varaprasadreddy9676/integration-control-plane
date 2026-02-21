import { useMemo, useState } from 'react';
import { Button, Card, Form, Select, Input, Space, Typography, Alert, Collapse, Tag, Tooltip, Divider } from 'antd';
import { PlusOutlined, DeleteOutlined, InfoCircleOutlined, DatabaseOutlined, SwapOutlined, BookOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { getLookupTypes } from '../../../services/api';
import { cssVar, useDesignTokens } from '../../../design-system/utils';
import type { LookupConfig, UnmappedBehavior } from '../../../mocks/types';

interface LookupConfigSectionProps {
  value?: LookupConfig[];
  onChange?: (value: LookupConfig[]) => void;
}

export const LookupConfigSection = ({ value = [], onChange }: LookupConfigSectionProps) => {
  const { spacing } = useDesignTokens();
  const colors = cssVar.legacy;
  const [expanded, setExpanded] = useState<string[]>([]);

  const { data: typesData } = useQuery({
    queryKey: ['lookup-types'],
    queryFn: getLookupTypes
  });

  const types = typesData?.types || [];

  const handleAdd = () => {
    const newLookup: LookupConfig = {
      type: '',
      sourceField: '',
      targetField: '',
      unmappedBehavior: 'PASSTHROUGH',
      defaultValue: undefined
    };
    onChange?.([...value, newLookup]);
    setExpanded([`${value.length}`]);
  };

  const handleRemove = (index: number) => {
    const newValue = value.filter((_, i) => i !== index);
    onChange?.(newValue);
  };

  const handleChange = (index: number, field: keyof LookupConfig, fieldValue: any) => {
    const newValue = [...value];
    newValue[index] = {
      ...newValue[index],
      [field]: fieldValue
    };
    onChange?.(newValue);
  };

  return (
    <div>
      <div style={{ marginBottom: spacing[4], display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: spacing[2] }}>
          <DatabaseOutlined style={{ color: colors.primary[600], fontSize: 18 }} />
          <Typography.Title level={5} style={{ margin: 0 }}>
            Code Mappings (Lookups)
          </Typography.Title>
          <Tooltip title="Apply code translation after transformation completes">
            <InfoCircleOutlined style={{ color: cssVar.text.muted, fontSize: 14 }} />
          </Tooltip>
        </div>
        <Button
          type="dashed"
          size="small"
          icon={<PlusOutlined />}
          onClick={handleAdd}
        >
          Add Mapping
        </Button>
      </div>

      <Alert
        type="info"
        showIcon
        icon={<InfoCircleOutlined />}
        message="Lookup mappings run AFTER standard transformations"
        description={
          <div>
            <p style={{ marginBottom: 8 }}>Lookups translate codes from your system to external system codes. They execute in the following order:</p>
            <ol style={{ marginBottom: 8, paddingLeft: 20 }}>
              <li>Standard transformation (SIMPLE or SCRIPT) runs first</li>
              <li>Lookup mappings apply to the transformed payload</li>
              <li>Final payload delivered to target endpoint</li>
            </ol>
            <p style={{ marginBottom: 8 }}>
              <strong>In Scripts:</strong> You can also use lookups directly in transformation scripts with the <code>lookup(code, type)</code> function.
            </p>
            <p style={{ marginBottom: 0 }}>
              <Link to="/help/lookup-guide" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <BookOutlined /> View Complete Lookup Tables Guide
              </Link>
            </p>
          </div>
        }
        style={{ marginBottom: spacing[4] }}
      />

      {value.length === 0 ? (
        <Card
          style={{
            textAlign: 'center',
            padding: spacing[6],
            background: colors.neutral[50],
            border: `1px dashed ${colors.neutral[300]}`
          }}
        >
          <DatabaseOutlined style={{ fontSize: 48, color: cssVar.text.muted, marginBottom: spacing[3] }} />
          <Typography.Text type="secondary">
            No lookup mappings configured. Click "Add Mapping" to start.
          </Typography.Text>
        </Card>
      ) : (
        <Collapse
          activeKey={expanded}
          onChange={(keys) => setExpanded(keys as string[])}
          items={value.map((lookup, index) => ({
            key: `${index}`,
            label: (
              <Space>
                <SwapOutlined style={{ color: colors.primary[600] }} />
                <Typography.Text strong>
                  {lookup.type || 'Untitled Mapping'}
                </Typography.Text>
                {lookup.sourceField && lookup.targetField && (
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {lookup.sourceField} → {lookup.targetField}
                  </Typography.Text>
                )}
                <Tag color={lookup.unmappedBehavior === 'FAIL' ? 'error' : lookup.unmappedBehavior === 'DEFAULT' ? 'warning' : 'default'}>
                  {lookup.unmappedBehavior}
                </Tag>
              </Space>
            ),
            extra: (
              <Button
                type="text"
                danger
                size="small"
                icon={<DeleteOutlined />}
                onClick={(e) => {
                  e.stopPropagation();
                  handleRemove(index);
                }}
              />
            ),
            children: (
              <div>
                <Space direction="vertical" style={{ width: '100%' }} size="middle">
                  {/* Mapping Type */}
                  <div>
                    <Typography.Text strong style={{ display: 'block', marginBottom: 4 }}>
                      Mapping Type *
                    </Typography.Text>
                    <Select
                      placeholder="Select or type to create new (e.g., SERVICE_CODE, DIAGNOSIS_CODE)"
                      style={{ width: '100%' }}
                      value={lookup.type ? [lookup.type] : undefined}
                      onChange={(val) => handleChange(index, 'type', Array.isArray(val) ? val[0] : val)}
                      showSearch
                      mode="tags"
                      maxCount={1}
                      tokenSeparators={[',']}
                      options={types.map(t => ({ label: t, value: t }))}
                    />
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      The category of code mapping (matches lookup table type)
                    </Typography.Text>
                  </div>

                  <Divider style={{ margin: '8px 0' }} />

                  {/* Source and Target Fields */}
                  <div>
                    <Typography.Text strong style={{ display: 'block', marginBottom: 4 }}>
                      Source Field *
                    </Typography.Text>
                    <Input
                      placeholder="e.g., serviceCode or items[].serviceCode"
                      value={lookup.sourceField}
                      onChange={(e) => handleChange(index, 'sourceField', e.target.value)}
                    />
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      Field path in payload to translate. Supports arrays using [] notation.
                    </Typography.Text>
                  </div>

                  <div>
                    <Typography.Text strong style={{ display: 'block', marginBottom: 4 }}>
                      Target Field *
                    </Typography.Text>
                    <Input
                      placeholder="e.g., externalServiceCode or items[].externalCode"
                      value={lookup.targetField}
                      onChange={(e) => handleChange(index, 'targetField', e.target.value)}
                    />
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      Field path where translated code will be written
                    </Typography.Text>
                  </div>

                  <Divider style={{ margin: '8px 0' }} />

                  {/* Unmapped Behavior */}
                  <div>
                    <Typography.Text strong style={{ display: 'block', marginBottom: 4 }}>
                      Unmapped Behavior *
                    </Typography.Text>
                    <Select
                      style={{ width: '100%' }}
                      value={lookup.unmappedBehavior}
                      onChange={(val: UnmappedBehavior) => handleChange(index, 'unmappedBehavior', val)}
                      options={[
                        {
                          label: 'PASSTHROUGH - Keep original value',
                          value: 'PASSTHROUGH',
                        },
                        {
                          label: 'FAIL - Block delivery',
                          value: 'FAIL',
                        },
                        {
                          label: 'DEFAULT - Use default value',
                          value: 'DEFAULT',
                        }
                      ]}
                    />
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      What to do when no mapping is found for a code
                    </Typography.Text>
                  </div>

                  {/* Default Value (only show if DEFAULT behavior selected) */}
                  {lookup.unmappedBehavior === 'DEFAULT' && (
                    <div>
                      <Typography.Text strong style={{ display: 'block', marginBottom: 4 }}>
                        Default Value *
                      </Typography.Text>
                      <Input
                        placeholder="Enter default value for unmapped codes"
                        value={lookup.defaultValue}
                        onChange={(e) => handleChange(index, 'defaultValue', e.target.value)}
                      />
                      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                        This value will be used when no mapping exists
                      </Typography.Text>
                    </div>
                  )}
                </Space>
              </div>
            )
          }))}
        />
      )}

      {/* Script Helper Documentation */}
      {value.length > 0 && (
        <Alert
          type="success"
          showIcon
          style={{ marginTop: spacing[4] }}
          message="Using Lookups in Transformation Scripts"
          description={
            <div>
              <p style={{ marginBottom: 8 }}>You can also use lookups directly in your SCRIPT transformations:</p>
              <pre style={{
                background: colors.neutral[900],
                color: colors.neutral[100],
                padding: spacing[3],
                borderRadius: 4,
                fontSize: 12,
                overflow: 'auto'
              }}>
{`// In your transformation script:
return {
  ...payload,
  // Simple lookup
  externalServiceCode: lookup(payload.serviceCode, 'SERVICE_CODE'),

  // With fallback
  externalDiagCode: lookup(payload.diagCode, 'DIAGNOSIS_CODE') || 'UNKNOWN',

  // Array mapping
  items: payload.items.map(item => ({
    ...item,
    externalCode: lookup(item.code, 'ITEM_CODE')
  }))
};`}
              </pre>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                The <code>lookup(code, type)</code> function is available in all transformation scripts and respects the hierarchical lookup resolution (entity-specific → parent-level).
              </Typography.Text>
            </div>
          }
        />
      )}
    </div>
  );
};
