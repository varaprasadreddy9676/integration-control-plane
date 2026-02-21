import { useState } from 'react';
import { Space, Button, Select, Input, Row, Col, Typography, Tag, Divider, Empty } from 'antd';
import {
  PlusOutlined,
  DeleteOutlined,
  ArrowRightOutlined,
  FileAddOutlined
} from '@ant-design/icons';
import { cssVar } from '../../../design-system/utils';

const { Text } = Typography;

interface MappingRow {
  id: string;
  targetField: string;
  sourceField?: string;
  transform?: 'none' | 'trim' | 'upper' | 'lower' | 'date' | 'default';
  defaultValue?: string;
}

interface StaticField {
  id: string;
  key: string;
  value: string;
}

interface SimpleTransformationMappingProps {
  availableFields: Array<{ key: string; label: string; type?: string }>;
  mappingState: {
    mappings: MappingRow[];
    staticFields: StaticField[];
  };
  onMappingChange: (state: { mappings: MappingRow[]; staticFields: StaticField[] }) => void;
  spacing: any;
  colors: any;
}

/**
 * SimpleTransformationMapping - Visual field mapping interface
 *
 * Allows users to map source fields to target fields with optional transformations
 */
export const SimpleTransformationMapping = ({
  availableFields,
  mappingState,
  onMappingChange,
  spacing,
  colors
}: SimpleTransformationMappingProps) => {
  const transformOptions = [
    { value: 'none', label: 'None' },
    { value: 'trim', label: 'Trim whitespace' },
    { value: 'upper', label: 'Uppercase' },
    { value: 'lower', label: 'Lowercase' },
    { value: 'date', label: 'Format as date' },
    { value: 'default', label: 'Default value if empty' }
  ];

  const addMapping = () => {
    const newMapping: MappingRow = {
      id: `mapping-${Date.now()}`,
      targetField: '',
      sourceField: undefined,
      transform: 'none'
    };
    onMappingChange({
      ...mappingState,
      mappings: [...mappingState.mappings, newMapping]
    });
  };

  const removeMapping = (id: string) => {
    onMappingChange({
      ...mappingState,
      mappings: mappingState.mappings.filter((m) => m.id !== id)
    });
  };

  const updateMapping = (id: string, updates: Partial<MappingRow>) => {
    onMappingChange({
      ...mappingState,
      mappings: mappingState.mappings.map((m) =>
        m.id === id ? { ...m, ...updates } : m
      )
    });
  };

  const addStaticField = () => {
    const newField: StaticField = {
      id: `static-${Date.now()}`,
      key: '',
      value: ''
    };
    onMappingChange({
      ...mappingState,
      staticFields: [...mappingState.staticFields, newField]
    });
  };

  const removeStaticField = (id: string) => {
    onMappingChange({
      ...mappingState,
      staticFields: mappingState.staticFields.filter((f) => f.id !== id)
    });
  };

  const updateStaticField = (id: string, updates: Partial<StaticField>) => {
    onMappingChange({
      ...mappingState,
      staticFields: mappingState.staticFields.map((f) =>
        f.id === id ? { ...f, ...updates } : f
      )
    });
  };

  return (
    <Space direction="vertical" size="large" style={{ width: '100%' }}>
      {/* Field Mappings */}
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing[3] }}>
          <Text strong>Field Mappings</Text>
          <Button
            type="dashed"
            icon={<PlusOutlined />}
            onClick={addMapping}
            size="small"
          >
            Add Mapping
          </Button>
        </div>

        {mappingState.mappings.length === 0 ? (
          <Empty
            description="No field mappings yet"
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            style={{ margin: `${spacing[4]} 0` }}
          >
            <Button type="primary" icon={<PlusOutlined />} onClick={addMapping}>
              Add First Mapping
            </Button>
          </Empty>
        ) : (
          <Space direction="vertical" size="middle" style={{ width: '100%' }}>
            {mappingState.mappings.map((mapping) => (
              <div
                key={mapping.id}
                style={{
                  padding: spacing[3],
                  background: cssVar.bg.surface,
                  borderRadius: 8,
                  border: `1px solid ${cssVar.border.default}`
                }}
              >
                <Row gutter={[12, 12]} align="middle">
                  {/* Source Field */}
                  <Col xs={24} sm={10}>
                    <Space direction="vertical" size={4} style={{ width: '100%' }}>
                      <Text type="secondary" style={{ fontSize: 12 }}>Source Field</Text>
                      <Select
                        placeholder="Select source field"
                        value={mapping.sourceField}
                        onChange={(value) => updateMapping(mapping.id, { sourceField: value })}
                        style={{ width: '100%' }}
                        showSearch
                        options={availableFields.map((f) => ({
                          label: f.label,
                          value: f.key
                        }))}
                      />
                    </Space>
                  </Col>

                  {/* Arrow */}
                  <Col xs={24} sm={1} style={{ textAlign: 'center' }}>
                    <ArrowRightOutlined style={{ color: colors.primary[500] }} />
                  </Col>

                  {/* Target Field */}
                  <Col xs={24} sm={10}>
                    <Space direction="vertical" size={4} style={{ width: '100%' }}>
                      <Text type="secondary" style={{ fontSize: 12 }}>Target Field</Text>
                      <Input
                        placeholder="e.g., patient_name"
                        value={mapping.targetField}
                        onChange={(e) => updateMapping(mapping.id, { targetField: e.target.value })}
                      />
                    </Space>
                  </Col>

                  {/* Delete Button */}
                  <Col xs={24} sm={3} style={{ textAlign: 'right' }}>
                    <Button
                      type="text"
                      danger
                      icon={<DeleteOutlined />}
                      onClick={() => removeMapping(mapping.id)}
                    />
                  </Col>

                  {/* Transform Function */}
                  <Col xs={24} sm={12}>
                    <Space direction="vertical" size={4} style={{ width: '100%' }}>
                      <Text type="secondary" style={{ fontSize: 12 }}>Transform</Text>
                      <Select
                        value={mapping.transform || 'none'}
                        onChange={(value) => updateMapping(mapping.id, { transform: value })}
                        style={{ width: '100%' }}
                        options={transformOptions}
                      />
                    </Space>
                  </Col>

                  {/* Default Value (if transform = 'default') */}
                  {mapping.transform === 'default' && (
                    <Col xs={24} sm={12}>
                      <Space direction="vertical" size={4} style={{ width: '100%' }}>
                        <Text type="secondary" style={{ fontSize: 12 }}>Default Value</Text>
                        <Input
                          placeholder="Enter default value"
                          value={mapping.defaultValue}
                          onChange={(e) => updateMapping(mapping.id, { defaultValue: e.target.value })}
                        />
                      </Space>
                    </Col>
                  )}
                </Row>
              </div>
            ))}
          </Space>
        )}
      </div>

      <Divider />

      {/* Static Fields */}
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing[3] }}>
          <Space>
            <Text strong>Static Fields</Text>
            <Tag color="blue">Constant Values</Tag>
          </Space>
          <Button
            type="dashed"
            icon={<FileAddOutlined />}
            onClick={addStaticField}
            size="small"
          >
            Add Static Field
          </Button>
        </div>

        {mappingState.staticFields.length === 0 ? (
          <Empty
            description="No static fields"
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            style={{ margin: `${spacing[4]} 0` }}
          >
            <Button type="dashed" icon={<FileAddOutlined />} onClick={addStaticField}>
              Add Static Field
            </Button>
          </Empty>
        ) : (
          <Space direction="vertical" size="middle" style={{ width: '100%' }}>
            {mappingState.staticFields.map((field) => (
              <div
                key={field.id}
                style={{
                  padding: spacing[3],
                  background: colors.primary[50],
                  borderRadius: 8,
                  border: `1px solid ${colors.primary[200]}`
                }}
              >
                <Row gutter={[12, 12]} align="middle">
                  <Col xs={24} sm={10}>
                    <Space direction="vertical" size={4} style={{ width: '100%' }}>
                      <Text type="secondary" style={{ fontSize: 12 }}>Field Name</Text>
                      <Input
                        placeholder="e.g., api_version"
                        value={field.key}
                        onChange={(e) => updateStaticField(field.id, { key: e.target.value })}
                      />
                    </Space>
                  </Col>
                  <Col xs={24} sm={11}>
                    <Space direction="vertical" size={4} style={{ width: '100%' }}>
                      <Text type="secondary" style={{ fontSize: 12 }}>Value</Text>
                      <Input
                        placeholder="e.g., 2.0"
                        value={field.value}
                        onChange={(e) => updateStaticField(field.id, { value: e.target.value })}
                      />
                    </Space>
                  </Col>
                  <Col xs={24} sm={3} style={{ textAlign: 'right' }}>
                    <Button
                      type="text"
                      danger
                      icon={<DeleteOutlined />}
                      onClick={() => removeStaticField(field.id)}
                    />
                  </Col>
                </Row>
              </div>
            ))}
          </Space>
        )}
      </div>
    </Space>
  );
};
