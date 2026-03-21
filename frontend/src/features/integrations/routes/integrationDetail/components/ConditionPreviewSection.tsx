import { RadarChartOutlined } from '@ant-design/icons';
import { Alert, Button, Card, Col, Empty, Row, Select, Space, Table, Tag, Tooltip, Typography } from 'antd';
import type { ConditionPreviewResult, SubjectPreviewResult } from '../../../../../services/api';
import type { LifecyclePanelTokenProps } from './LifecyclePanel.types';

const { Title } = Typography;

interface ConditionPreviewSectionProps extends LifecyclePanelTokenProps {
  integrationId?: string;
  conditionEventOptions: string[];
  previewEventType?: string;
  setPreviewEventType: (value: string) => void;
  handlePreviewSubject: () => Promise<void>;
  handlePreviewCondition: () => Promise<void>;
  isPreviewingSubject: boolean;
  isPreviewingCondition: boolean;
  subjectPreview: SubjectPreviewResult | null;
  conditionPreview: ConditionPreviewResult | null;
  previewWarnings: string[];
}

export const ConditionPreviewSection = ({
  integrationId,
  conditionEventOptions,
  previewEventType,
  setPreviewEventType,
  handlePreviewSubject,
  handlePreviewCondition,
  isPreviewingSubject,
  isPreviewingCondition,
  subjectPreview,
  conditionPreview,
  previewWarnings,
  token,
}: ConditionPreviewSectionProps) => {
  const heldImpactEnabled = Boolean(integrationId);
  const extractedSubject = subjectPreview?.subject?.data || null;
  const matchedOnKeys = Array.isArray(conditionPreview?.matchedOn) ? conditionPreview.matchedOn : [];

  const impactColumns = [
    {
      title: 'Integration',
      dataIndex: 'integrationName',
      key: 'integrationName',
      render: (value: string | null) => value || 'Current integration',
    },
    {
      title: 'Held Event',
      dataIndex: 'eventType',
      key: 'eventType',
      render: (value: string | undefined) => value || 'Unknown',
    },
    {
      title: 'Match',
      dataIndex: 'matchedOn',
      key: 'matchedOn',
      render: (value: string | undefined) => (value ? <Tag color="blue">{value}</Tag> : 'N/A'),
    },
    {
      title: 'Status',
      dataIndex: 'status',
      key: 'status',
      render: (value: string | undefined) => (value ? <Tag>{value}</Tag> : 'N/A'),
    },
  ];

  return (
    <Card
      size="small"
      style={{ borderRadius: token.borderRadiusLG }}
      title={
        <Space>
          <RadarChartOutlined />
          Preview
        </Space>
      }
    >
      <Space direction="vertical" size={16} style={{ width: '100%' }}>
        <Row gutter={[12, 12]}>
          <Col xs={24} lg={12}>
            <Button type="primary" onClick={handlePreviewSubject} loading={isPreviewingSubject}>
              Preview Extracted Subject
            </Button>
          </Col>
          <Col xs={24} lg={12}>
            <Space wrap>
              <Tooltip title={conditionEventOptions.length > 0 ? undefined : 'Add a condition rule first'}>
                <Select
                  style={{ minWidth: 260 }}
                  placeholder={conditionEventOptions.length > 0 ? 'Choose follow-up event' : 'Add a condition rule first'}
                  value={previewEventType}
                  onChange={setPreviewEventType}
                  options={conditionEventOptions.map((value) => ({ label: value, value }))}
                />
              </Tooltip>
              <Tooltip title={heldImpactEnabled ? undefined : 'Save this integration first to preview held delivery impact'}>
                <Button onClick={handlePreviewCondition} loading={isPreviewingCondition} disabled={!previewEventType || !heldImpactEnabled}>
                  Preview Held Impact
                </Button>
              </Tooltip>
            </Space>
          </Col>
        </Row>

        {!heldImpactEnabled && <Alert type="info" showIcon message="Save this integration first to preview held delivery impact." />}

        {previewWarnings.length > 0 && (
          <Alert
            type="warning"
            showIcon
            message="Preview warnings"
            description={
              <Space direction="vertical" size={4}>
                {previewWarnings.map((warning) => (
                  <div key={warning}>{warning}</div>
                ))}
              </Space>
            }
          />
        )}

        <Row gutter={[16, 16]}>
          <Col xs={24} lg={heldImpactEnabled ? 10 : 24}>
            <Card size="small" style={{ minHeight: 240, borderRadius: token.borderRadiusLG, background: '#fbfcfe' }}>
              <Space direction="vertical" size={8} style={{ width: '100%' }}>
                <Title level={5} style={{ margin: 0 }}>
                  Extracted Subject
                </Title>
                {extractedSubject ? (
                  <>
                    <Space wrap>
                      {Object.keys(extractedSubject).map((key) => (
                        <Tag key={key} color="blue">
                          {key}
                        </Tag>
                      ))}
                    </Space>
                    <pre
                      style={{
                        margin: 0,
                        padding: 12,
                        borderRadius: token.borderRadius,
                        background: '#0f172a',
                        color: '#e2e8f0',
                        overflowX: 'auto',
                        fontSize: 12,
                      }}
                    >
                      {JSON.stringify(extractedSubject, null, 2)}
                    </pre>
                  </>
                ) : (
                  <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Run the subject preview to inspect extracted keys." />
                )}
              </Space>
            </Card>
          </Col>

          {heldImpactEnabled && (
            <Col xs={24} lg={14}>
              <Card size="small" style={{ minHeight: 240, borderRadius: token.borderRadiusLG, background: '#fffcf5' }}>
                <Space direction="vertical" size={8} style={{ width: '100%' }}>
                  <Title level={5} style={{ margin: 0 }}>
                    Held Delivery Impact
                  </Title>
                  {conditionPreview?.wouldAffect?.length ? (
                    <>
                      <Space wrap>
                        {matchedOnKeys.map((key) => (
                          <Tag key={key} color="gold">
                            Matched on {key}
                          </Tag>
                        ))}
                      </Space>
                      <Table
                        size="small"
                        rowKey="id"
                        columns={impactColumns}
                        dataSource={conditionPreview.wouldAffect}
                        pagination={false}
                      />
                    </>
                  ) : (
                    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Run Preview Held Impact to see which held deliveries would be released or discarded." />
                  )}
                </Space>
              </Card>
            </Col>
          )}
        </Row>
      </Space>
    </Card>
  );
};
