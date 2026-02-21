import { useState, useEffect } from 'react';
import { Modal, Form, Input, Switch, Button, Space, Alert, Typography, Select } from 'antd';
import { PlusOutlined, DeleteOutlined } from '@ant-design/icons';
import { useQueryClient } from '@tanstack/react-query';
import type { EventType, EventTypeInput } from '../../../services/api';
import { createEventType, updateEventType } from '../../../services/api';

const { TextArea } = Input;
const { Text } = Typography;

/** Simplified field shape used in the form (matches actual backend storage) */
interface FormField {
  path: string;
  type: string;
  description: string;
  example: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  /** When provided, the modal is in edit mode */
  existing?: EventType | null;
  /** Pre-populated category list from current catalogue */
  categories?: string[];
}

const FIELD_TYPES = ['string', 'number', 'boolean', 'object', 'array'];

const emptyField = (): FormField => ({ path: '', type: 'string', description: '', example: '' });

/**
 * Modal for creating or editing an org-specific event type.
 *
 * - Create: eventType ID is editable (set once, then immutable)
 * - Edit: eventType ID is read-only; all other fields can be changed
 */
export const EventTypeEditorModal = ({ open, onClose, existing, categories = [] }: Props) => {
  const [form] = Form.useForm();
  const queryClient = useQueryClient();

  const [fields, setFields] = useState<FormField[]>([emptyField()]);
  const [samplePayloadText, setSamplePayloadText] = useState('');
  const [samplePayloadError, setSamplePayloadError] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const isEdit = !!existing;

  useEffect(() => {
    if (open) {
      if (existing) {
        form.setFieldsValue({
          eventType: existing.eventType,
          label: existing.label,
          description: existing.description,
          category: existing.category,
          isActive: existing.isActive !== false
        });
        setFields(existing.fields?.length ? (existing.fields as unknown as FormField[]) : [emptyField()]);
        setSamplePayloadText(existing.samplePayload ? JSON.stringify(existing.samplePayload, null, 2) : '');
      } else {
        form.resetFields();
        setFields([emptyField()]);
        setSamplePayloadText('');
      }
      setSamplePayloadError('');
      setError('');
    }
  }, [open, existing, form]);

  const handleFieldChange = (index: number, key: keyof FormField, value: string) => {
    setFields(prev => prev.map((f, i) => i === index ? { ...f, [key]: value } : f));
  };

  const addField = () => setFields(prev => [...prev, emptyField()]);

  const removeField = (index: number) => {
    setFields(prev => prev.filter((_, i) => i !== index));
  };

  const validateSamplePayload = () => {
    if (!samplePayloadText.trim()) {
      setSamplePayloadError('');
      return null;
    }
    try {
      const parsed = JSON.parse(samplePayloadText);
      setSamplePayloadError('');
      return parsed;
    } catch {
      setSamplePayloadError('Invalid JSON');
      return undefined; // undefined = parse error
    }
  };

  const handleSave = async () => {
    try {
      const values = await form.validateFields();
      const samplePayload = validateSamplePayload();
      if (samplePayloadText.trim() && samplePayload === undefined) return; // JSON error

      const validFields = fields.filter(f => f.path.trim());
      if (validFields.length === 0) {
        setError('At least one field with a non-empty path is required.');
        return;
      }

      const payload: EventTypeInput = {
        eventType: values.eventType,
        label: values.label,
        description: values.description || '',
        category: values.category || 'Custom',
        isActive: values.isActive !== false,
        fields: validFields as unknown as EventTypeInput['fields'],
        ...(samplePayload !== null && { samplePayload })
      };

      setSaving(true);
      setError('');

      if (isEdit) {
        const { eventType: _, ...updatePayload } = payload;
        await updateEventType(existing!.eventType, updatePayload);
      } else {
        await createEventType(payload);
      }

      queryClient.invalidateQueries({ queryKey: ['eventTypes'] });
      onClose();
    } catch (err: any) {
      if (err?.errorFields) return; // Ant Design validation error — already displayed inline
      setError(err?.message || 'Failed to save event type');
    } finally {
      setSaving(false);
    }
  };

  const categoryOptions = Array.from(new Set([...categories, 'Custom'])).map(c => ({ value: c, label: c }));

  return (
    <Modal
      open={open}
      title={isEdit ? `Edit: ${existing?.eventType}` : 'Add Event Type'}
      onCancel={onClose}
      width={720}
      footer={
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <Button onClick={onClose}>Cancel</Button>
          <Button type="primary" loading={saving} onClick={handleSave}>
            {isEdit ? 'Update' : 'Create'}
          </Button>
        </div>
      }
      destroyOnClose
    >
      {error && <Alert type="error" message={error} style={{ marginBottom: 16 }} showIcon />}

      <Form form={form} layout="vertical" initialValues={{ isActive: true }}>
        <Form.Item
          name="eventType"
          label="Event Type ID"
          rules={[
            { required: true, message: 'Event type ID is required' },
            { pattern: /^[A-Z0-9_]+$/, message: 'Use uppercase letters, numbers, and underscores only (e.g. ORDER_PLACED)' }
          ]}
          extra={isEdit ? 'Event type ID cannot be changed after creation.' : 'Uppercase, e.g. ORDER_PLACED'}
        >
          <Input disabled={isEdit} placeholder="ORDER_PLACED" style={{ fontFamily: 'monospace' }} />
        </Form.Item>

        <Form.Item name="label" label="Label" rules={[{ required: true, message: 'Label is required' }]}>
          <Input placeholder="Order Placed" />
        </Form.Item>

        <Form.Item name="description" label="Description">
          <TextArea rows={2} placeholder="Triggered when an order is placed by a customer" />
        </Form.Item>

        <Space style={{ width: '100%' }} direction="horizontal">
          <Form.Item name="category" label="Category" style={{ width: 280 }}>
            <Select
              showSearch
              allowClear
              placeholder="Custom"
              options={categoryOptions}
              mode={undefined}
            />
          </Form.Item>

          <Form.Item name="isActive" label="Active" valuePropName="checked">
            <Switch />
          </Form.Item>
        </Space>

        {/* Fields editor */}
        <div style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <Text strong>Fields</Text>
            <Button size="small" icon={<PlusOutlined />} onClick={addField}>
              Add Field
            </Button>
          </div>

          {fields.map((field, index) => (
            <div
              key={index}
              style={{
                display: 'grid',
                gridTemplateColumns: '2fr 100px 2fr 1fr 32px',
                gap: 6,
                marginBottom: 6,
                alignItems: 'center'
              }}
            >
              <Input
                placeholder="path (e.g. patient.name)"
                value={field.path}
                onChange={e => handleFieldChange(index, 'path', e.target.value)}
                style={{ fontFamily: 'monospace', fontSize: 12 }}
              />
              <Select
                value={field.type || 'string'}
                onChange={v => handleFieldChange(index, 'type', v)}
                options={FIELD_TYPES.map(t => ({ value: t, label: t }))}
                size="small"
              />
              <Input
                placeholder="description"
                value={field.description}
                onChange={e => handleFieldChange(index, 'description', e.target.value)}
                style={{ fontSize: 12 }}
              />
              <Input
                placeholder="example"
                value={field.example}
                onChange={e => handleFieldChange(index, 'example', e.target.value)}
                style={{ fontSize: 12 }}
              />
              <Button
                icon={<DeleteOutlined />}
                size="small"
                danger
                onClick={() => removeField(index)}
                disabled={fields.length === 1}
              />
            </div>
          ))}
          {fields.length === 0 && (
            <Button type="dashed" block icon={<PlusOutlined />} onClick={addField}>
              Add first field
            </Button>
          )}
        </div>

        {/* Sample payload JSON editor */}
        <div>
          <Text strong style={{ display: 'block', marginBottom: 6 }}>Sample Payload (JSON, optional)</Text>
          <TextArea
            rows={5}
            value={samplePayloadText}
            onChange={e => {
              setSamplePayloadText(e.target.value);
              setSamplePayloadError('');
            }}
            placeholder={'{\n  "orderId": "ORD-123",\n  "amount": 99.99\n}'}
            style={{ fontFamily: 'monospace', fontSize: 12 }}
          />
          {samplePayloadError && (
            <Text type="danger" style={{ fontSize: 12 }}>{samplePayloadError}</Text>
          )}
        </div>
      </Form>
    </Modal>
  );
};
