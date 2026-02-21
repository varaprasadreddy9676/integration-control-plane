import { Card, Typography, Space, Alert } from 'antd';
import { WarningOutlined } from '@ant-design/icons';
import { DLQManagement } from '../components/DLQManagement';
import { useDesignTokens, spacingToNumber } from '../../../design-system/utils';
import { PageHeader } from '../../../components/common/PageHeader';

const { Paragraph } = Typography;

export const DLQRoute = () => {
  const { spacing } = useDesignTokens();

  return (
    <div className="dlq-page" style={{ width: '100%', maxWidth: '100%', margin: '0 auto' }}>
      <Space direction="vertical" size={spacingToNumber(spacing[2])} style={{ width: '100%' }}>
        <PageHeader
          title="Dead Letter Queue (DLQ)"
          description="Manage failed integration deliveries. Review errors, retry failed messages, or abandon entries that cannot be processed."
          compact
        />

        {/* Info Alert */}
        <Alert
          type="info"
          showIcon
          icon={<WarningOutlined />}
          message="About the Dead Letter Queue"
          description={
            <div>
              <p style={{ marginBottom: 8 }}>
                Failed integration deliveries are automatically added to the DLQ for retry. The system will:
              </p>
              <ul style={{ marginBottom: 8, paddingLeft: 20 }}>
                <li>Automatically retry failed deliveries using exponential backoff</li>
                <li>Categorize errors (timeout, network, server error, etc.)</li>
                <li>Abandon entries that exceed the maximum retry count</li>
                <li>Track resolution history for audit purposes</li>
              </ul>
              <p style={{ marginBottom: 0 }}>
                You can manually retry or abandon entries at any time. Bulk operations are available for managing multiple entries.
              </p>
            </div>
          }
          closable
          style={{ marginBottom: spacing[2], maxWidth: '100%' }}
        />

        {/* DLQ Management Component */}
        <Card size="small" className="panel">
          <DLQManagement />
        </Card>
      </Space>
    </div>
  );
};
