import { useEffect } from 'react';
import { ApartmentOutlined, DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import { Button, Card, Col, Form, Input, Row, Select, Space, Tooltip, Typography } from 'antd';
import type { FormInstance } from 'antd';
import { MonacoEditorInput } from '../../../components/MonacoEditorInput';
import type { SubjectExtractionPathEntry } from '../utils/lifecycle';
import type { LifecyclePanelSurfaceProps } from './LifecyclePanel.types';

const { Text, Title } = Typography;
const { TextArea } = Input;

interface LifecycleSubjectSectionProps extends LifecyclePanelSurfaceProps {
  form: FormInstance;
  extractionMode: 'PATHS' | 'SCRIPT';
  hasExtractionConfig: boolean;
  ruleCount: number;
  pathEntries: SubjectExtractionPathEntry[];
}

const buildHeroCardStyle = (token: any, colors: any) => ({
  height: '100%',
  borderRadius: token.borderRadiusLG,
  borderColor: colors.primary[200],
  background: `linear-gradient(135deg, ${colors.primary[50]} 0%, #ffffff 68%)`,
});

export const LifecycleSubjectSection = ({
  form,
  extractionMode,
  hasExtractionConfig,
  ruleCount,
  pathEntries,
  token,
  colors,
}: LifecycleSubjectSectionProps) => {
  useEffect(() => {
    if (hasExtractionConfig || ruleCount > 0) {
      void form.validateFields(['resourceType']).catch(() => undefined);
    }
  }, [form, hasExtractionConfig, ruleCount]);

  return (
    <>
      <Row gutter={[16, 16]}>
        <Col xs={24} lg={10}>
          <Card size="small" style={buildHeroCardStyle(token, colors)}>
            <Space direction="vertical" size={4} style={{ width: '100%' }}>
              <Title level={5} style={{ margin: 0 }}>
                Subject Type
              </Title>
              <Text type="secondary">
                Name the real-world object this schedule belongs to, like APPOINTMENT, ORDER, or BOOKING.
              </Text>
            </Space>
            <Form.Item
              name="resourceType"
              rules={[
                {
                  validator: async (_rule, value) => {
                    if ((hasExtractionConfig || ruleCount > 0) && (!value || String(value).trim() === '')) {
                      throw new Error('Subject type is required when extraction or lifecycle rules are configured');
                    }
                  },
                },
              ]}
              style={{ marginTop: 12, marginBottom: 0 }}
            >
              <Input placeholder="APPOINTMENT" size="large" prefix={<ApartmentOutlined />} />
            </Form.Item>
          </Card>
        </Col>

        <Col xs={24} lg={14}>
          <Card size="small" style={buildHeroCardStyle(token, colors)}>
            <Space direction="vertical" size={4} style={{ width: '100%' }}>
              <Title level={5} style={{ margin: 0 }}>
                Subject Extraction
              </Title>
              <Text type="secondary">
                Extract an opaque subject object from the event payload. Lifecycle rules match on the keys you define here.
              </Text>
            </Space>
            <Form.Item name="subjectExtractionMode" style={{ marginTop: 12, marginBottom: 0 }}>
              <Select
                size="large"
                options={[
                  { label: 'Guided Paths', value: 'PATHS' },
                  { label: 'Custom Script', value: 'SCRIPT' },
                ]}
              />
            </Form.Item>
          </Card>
        </Col>
      </Row>

      {extractionMode === 'SCRIPT' ? (
        <Form.Item
          name="subjectExtractionScript"
          label="Extraction Script"
          extra="Return a plain object with the exact keys you want to match on. Only flat scalar values are kept."
          style={{ marginBottom: 0 }}
        >
          <MonacoEditorInput
            height="260px"
            placeholder={"return {\n  appointment_id: payload.appt?.apptRID,\n  booking_ref: payload.appt?.bookingNumber,\n};"}
          />
        </Form.Item>
      ) : (
        <Form.List name="subjectExtractionPaths">
          {(fields, { add, remove }) => (
            <Space direction="vertical" size={12} style={{ width: '100%' }}>
              {fields.map((field) => {
                const { key: _ignoredKey, ...fieldProps } = field;

                return (
                  <Card key={field.key} size="small" style={{ borderRadius: token.borderRadiusLG, borderColor: colors.neutral[300] }}>
                    <Row gutter={[12, 12]} align="middle">
                      <Col xs={24} lg={7}>
                        <Form.Item
                          {...fieldProps}
                          name={[field.name, 'key']}
                          label="Key"
                          rules={[{ required: true, message: 'Key is required' }]}
                          style={{ marginBottom: 0 }}
                        >
                          <Input placeholder="appointment_id" />
                        </Form.Item>
                      </Col>
                      <Col xs={24} lg={15}>
                        <Form.Item
                          {...fieldProps}
                          name={[field.name, 'paths']}
                          label="Paths"
                          rules={[{ required: true, message: 'At least one path is required' }]}
                          extra="Add one path per line. The first non-empty value wins."
                          style={{ marginBottom: 0 }}
                        >
                          <TextArea placeholder={'appt.apptRID\nappointment.id'} autoSize={{ minRows: 2, maxRows: 4 }} />
                        </Form.Item>
                      </Col>
                      <Col xs={24} lg={2}>
                        <Tooltip title="Remove">
                          <Button
                            danger
                            title="Remove"
                            aria-label="Remove subject key"
                            icon={<DeleteOutlined />}
                            onClick={() => remove(field.name)}
                          />
                        </Tooltip>
                      </Col>
                    </Row>
                  </Card>
                );
              })}
              <Button icon={<PlusOutlined />} onClick={() => add({ key: '', paths: '' })}>
                Add Subject Key
              </Button>
              {pathEntries.length === 0 && (
                <Text type="secondary">Add at least one subject key so lifecycle rules can match the same object later.</Text>
              )}
            </Space>
          )}
        </Form.List>
      )}
    </>
  );
};
