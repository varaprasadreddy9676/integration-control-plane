import { useEffect, useMemo, useState } from 'react';
import { App, Button, Card, Form, Input, Select, Space, Switch, Typography, Divider, Grid } from 'antd';
import { SaveOutlined, ArrowLeftOutlined, DatabaseOutlined } from '@ant-design/icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import { useNavigateWithParams } from '../../../utils/navigation';
import { getLookup, createLookup, updateLookup, getLookupTypes } from '../../../services/api';
import { useTenant } from '../../../app/tenant-context';
import type { Lookup } from '../../../mocks/types';
import { useDesignTokens, spacingToNumber, cssVar } from '../../../design-system/utils';

export const LookupDetailRoute = () => {
  const { id } = useParams<{ id: string }>();
  const isEditMode = id !== 'new';
  const navigate = useNavigateWithParams();
  const queryClient = useQueryClient();
  const { spacing, token, shadows } = useDesignTokens();
  const colors = cssVar.legacy;
  const { message: msgApi } = App.useApp();
  const { tenant } = useTenant();
  const screens = Grid.useBreakpoint();
  const isNarrow = !screens.md;
  const [form] = Form.useForm();
  const [isSaving, setIsSaving] = useState(false);

  const { data: lookup, isLoading } = useQuery({
    queryKey: ['lookup', id],
    queryFn: () => getLookup(id!),
    enabled: isEditMode
  });

  const { data: typesData } = useQuery({
    queryKey: ['lookup-types'],
    queryFn: getLookupTypes
  });

  const types = typesData?.types || [];

  useEffect(() => {
    if (lookup && isEditMode) {
      form.setFieldsValue({
        type: [lookup.type], // Wrap in array for tags mode
        sourceId: lookup.source.id,
        sourceLabel: lookup.source.label,
        targetId: lookup.target.id,
        targetLabel: lookup.target.label,
        orgUnitRid: lookup.orgUnitRid,
        isActive: lookup.isActive
      });
    } else if (!isEditMode) {
      // Set defaults for new lookup
      form.setFieldsValue({
        isActive: true,
        orgUnitRid: null
      });
    }
  }, [lookup, isEditMode, form]);

  const onFinish = async (values: any) => {
    setIsSaving(true);

    try {
      // Extract type from array (tags mode returns array)
      const typeValue = Array.isArray(values.type) ? values.type[0] : values.type;

      const lookupData: Partial<Lookup> = {
        type: typeValue,
        source: {
          id: values.sourceId,
          label: values.sourceLabel || undefined
        },
        target: {
          id: values.targetId,
          label: values.targetLabel || undefined
        },
        orgUnitRid: values.orgUnitRid || null,
        isActive: values.isActive
      };

      if (isEditMode) {
        await updateLookup(id!, lookupData);
        msgApi.success('Lookup mapping updated successfully');
      } else {
        await createLookup(lookupData);
        msgApi.success('Lookup mapping created successfully');
      }

      queryClient.invalidateQueries({ queryKey: ['lookups'] });
      queryClient.invalidateQueries({ queryKey: ['lookup-types'] });
      navigate('/lookups');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to save lookup mapping';
      msgApi.error(errorMessage);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div style={{ padding: isNarrow ? spacing[4] : spacing[6] }}>
      <Card
        bordered={false}
        style={{
          background: cssVar.bg.surface,
          borderRadius: token.borderRadiusLG,
          boxShadow: shadows.sm,
          maxWidth: 800,
          margin: '0 auto'
        }}
      >
        {/* Header */}
        <div style={{ marginBottom: spacingToNumber(spacing[6]) }}>
          <Button
            type="link"
            icon={<ArrowLeftOutlined />}
            onClick={() => navigate('/lookups')}
            style={{ paddingLeft: 0, marginBottom: spacing[3] }}
          >
            Back to Lookups
          </Button>
          <Typography.Title level={3} style={{ margin: 0, display: 'flex', alignItems: 'center', gap: spacing[2] }}>
            <DatabaseOutlined style={{ color: colors.primary[600] }} />
            {isEditMode ? 'Edit Lookup Mapping' : 'New Lookup Mapping'}
          </Typography.Title>
          <Typography.Text type="secondary">
            {isEditMode ? 'Update an existing code mapping' : 'Create a new code mapping between systems'}
          </Typography.Text>
        </div>

        {/* Form */}
        <Form
          form={form}
          layout="vertical"
          onFinish={onFinish}
          disabled={isSaving || (isEditMode && isLoading)}
          requiredMark="optional"
        >
          {/* Mapping Type */}
          <Form.Item
            name="type"
            label="Mapping Type"
            rules={[{ required: true, message: 'Please enter a mapping type' }]}
            extra="The category of this code mapping (e.g., SERVICE_CODE, DIAGNOSIS_CODE, PROVIDER_ID)"
          >
            <Select
              placeholder="Select or type to create new"
              showSearch
              mode="tags"
              maxCount={1}
              options={types.map(t => ({ label: t, value: t }))}
              tokenSeparators={[',']}
            />
          </Form.Item>

          <Divider orientation="left">Source Code</Divider>

          {/* Source ID */}
          <Form.Item
            name="sourceId"
            label="Source Code ID"
            rules={[
              { required: true, message: 'Please enter source code ID' },
              { max: 255, message: 'Source ID must be less than 255 characters' }
            ]}
            extra="The code from the source system (e.g., your core app)"
          >
            <Input placeholder="e.g., SVC001, DX12345" />
          </Form.Item>

          {/* Source Label */}
          <Form.Item
            name="sourceLabel"
            label="Source Label (Optional)"
            rules={[{ max: 500, message: 'Source label must be less than 500 characters' }]}
            extra="Human-readable description of the source code"
          >
            <Input placeholder="e.g., General Consultation" />
          </Form.Item>

          <Divider orientation="left">Target Code</Divider>

          {/* Target ID */}
          <Form.Item
            name="targetId"
            label="Target Code ID"
            rules={[
              { required: true, message: 'Please enter target code ID' },
              { max: 255, message: 'Target ID must be less than 255 characters' }
            ]}
            extra="The code in the target system (e.g., external CRM/ERP)"
          >
            <Input placeholder="e.g., EXT_001, TARGET_XYZ" />
          </Form.Item>

          {/* Target Label */}
          <Form.Item
            name="targetLabel"
            label="Target Label (Optional)"
            rules={[{ max: 500, message: 'Target label must be less than 500 characters' }]}
            extra="Human-readable description of the target code"
          >
            <Input placeholder="e.g., Standard Consultation" />
          </Form.Item>

          <Divider orientation="left">Configuration</Divider>

          {/* Org Unit RID */}
          <Form.Item
            name="orgUnitRid"
            label="Org Unit Override"
            extra="Leave empty for parent-level mapping, or specify an org unit RID for unit-specific override"
          >
            <Select
              placeholder="Parent Level (applies to all org units)"
              allowClear
              options={[
                { label: 'Parent Level (default)', value: null },
                ...(tenant?.childEntities || []).map(e => ({
                  label: `${e.name} (RID: ${e.rid})`,
                  value: e.rid
                }))
              ]}
            />
          </Form.Item>

          {/* Active Status */}
          <Form.Item
            name="isActive"
            label="Status"
            valuePropName="checked"
            extra="Inactive mappings are preserved for audit but not used in transformations"
          >
            <Switch checkedChildren="Active" unCheckedChildren="Inactive" />
          </Form.Item>

          {/* Actions */}
          <Form.Item style={{ marginTop: spacingToNumber(spacing[6]), marginBottom: 0 }}>
            <Space>
              <Button
                type="primary"
                htmlType="submit"
                icon={<SaveOutlined />}
                loading={isSaving}
              >
                {isEditMode ? 'Update Mapping' : 'Create Mapping'}
              </Button>
              <Button onClick={() => navigate('/lookups')}>
                Cancel
              </Button>
            </Space>
          </Form.Item>
        </Form>
      </Card>
    </div>
  );
};
