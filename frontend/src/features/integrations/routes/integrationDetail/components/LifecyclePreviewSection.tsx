import { RadarChartOutlined } from '@ant-design/icons';
import { Alert, Button, Card, Col, Empty, Row, Select, Space, Table, Tag, Tooltip, Typography } from 'antd';
import type { CancellationPreviewResult, SubjectPreviewResult } from '../../../../../services/api';
import { getMatchedOnKeys } from '../utils/lifecyclePreview';
import type { LifecyclePanelTokenProps } from './LifecyclePanel.types';

const { Title } = Typography;

interface LifecyclePreviewSectionProps extends LifecyclePanelTokenProps {
  integrationId?: string;
  lifecycleEventOptions: string[];
  previewEventType?: string;
  setPreviewEventType: (value: string) => void;
  handlePreviewSubject: () => Promise<void>;
  handlePreviewCancellation: () => Promise<void>;
  isPreviewingSubject: boolean;
  isPreviewingCancellation: boolean;
  subjectPreview: SubjectPreviewResult | null;
  cancellationPreview: CancellationPreviewResult | null;
  previewWarnings: string[];
}

export const LifecyclePreviewSection = ({
  integrationId,
  lifecycleEventOptions,
  previewEventType,
  setPreviewEventType,
  handlePreviewSubject,
  handlePreviewCancellation,
  isPreviewingSubject,
  isPreviewingCancellation,
  subjectPreview,
  cancellationPreview,
  previewWarnings,
  token,
}: LifecyclePreviewSectionProps) => {
  const pendingImpactEnabled = Boolean(integrationId);
  const matchedOnKeys = getMatchedOnKeys(cancellationPreview);
  const extractedSubject = subjectPreview?.subject?.data || null;

  const cancellationColumns = [
    {
      title: 'Integration',
      dataIndex: 'integrationName',
      key: 'integrationName',
      render: (value: string | null) => value || 'Current integration',
    },
    {
      title: 'Scheduled For',
      dataIndex: 'scheduledFor',
      key: 'scheduledFor',
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
              <Tooltip title={lifecycleEventOptions.length > 0 ? undefined : 'Add a lifecycle rule first'}>
                <Select
                  style={{ minWidth: 260 }}
                  placeholder={lifecycleEventOptions.length > 0 ? 'Choose lifecycle event' : 'Add a lifecycle rule first'}
                  value={previewEventType}
                  onChange={setPreviewEventType}
                  options={lifecycleEventOptions.map((value) => ({ label: value, value }))}
                />
              </Tooltip>
              <Tooltip title={pendingImpactEnabled ? undefined : 'Save this integration first to preview pending delivery impact'}>
                <Button onClick={handlePreviewCancellation} loading={isPreviewingCancellation} disabled={!previewEventType || !pendingImpactEnabled}>
                  Preview Impact
                </Button>
              </Tooltip>
            </Space>
          </Col>
        </Row>

        {!pendingImpactEnabled && <Alert type="info" showIcon message="Save this integration first to preview pending delivery impact." />}

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
          <Col xs={24} lg={pendingImpactEnabled ? 10 : 24}>
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

          {pendingImpactEnabled && (
            <Col xs={24} lg={14}>
              <Card size="small" style={{ minHeight: 240, borderRadius: token.borderRadiusLG, background: '#fffcf5' }}>
                <Space direction="vertical" size={8} style={{ width: '100%' }}>
                  <Title level={5} style={{ margin: 0 }}>
                    Pending Delivery Impact
                  </Title>
                  {cancellationPreview?.wouldCancel?.length ? (
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
                        columns={cancellationColumns}
                        dataSource={cancellationPreview.wouldCancel}
                        pagination={false}
                      />
                    </>
                  ) : (
                    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Run Preview Impact to see which pending deliveries would be affected." />
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
