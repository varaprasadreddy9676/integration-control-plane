import { Segmented, Select, Typography } from 'antd';

interface DashboardToolbarProps {
  days: number;
  setDays: (value: number) => void;
  direction: 'ALL' | 'OUTBOUND' | 'INBOUND' | 'SCHEDULED';
  setDirection: (value: 'ALL' | 'OUTBOUND' | 'INBOUND' | 'SCHEDULED') => void;
  integrationId?: string;
  setIntegrationId: (value: string | undefined) => void;
  integrationOptions?: Array<{ label: string; value: string; direction?: string }>;
  statusText: string;
}

export const DashboardToolbar = ({
  days,
  setDays,
  direction,
  setDirection,
  integrationId,
  setIntegrationId,
  integrationOptions = [],
  statusText
}: DashboardToolbarProps) => {
  return (
    <section className="dashboard-toolbar">
      <div className="dashboard-filters" role="toolbar" aria-label="Dashboard filters">
        <Select
          value={days}
          onChange={setDays}
          options={[
            { label: 'Today', value: 1 },
            { label: '7 days', value: 7 },
            { label: '30 days', value: 30 },
            { label: '90 days', value: 90 }
          ]}
          style={{ width: 132 }}
        />
        <Segmented
          size="small"
          value={direction}
          onChange={(value) => setDirection(value as typeof direction)}
          options={[
            { label: 'All', value: 'ALL' },
            { label: 'Outbound', value: 'OUTBOUND' },
            { label: 'Inbound', value: 'INBOUND' },
            { label: 'Scheduled', value: 'SCHEDULED' }
          ]}
        />
        <Select
          placeholder="Integration"
          allowClear
          value={integrationId}
          onChange={(value, option: any) => {
            setIntegrationId(value);
            if (value && option?.direction && direction === 'ALL') {
              setDirection(option.direction as typeof direction);
            }
          }}
          options={integrationOptions}
          style={{ width: 220 }}
          optionFilterProp="label"
          showSearch
        />
      </div>
      <div className="dashboard-status">
        <Typography.Text type="secondary">{statusText}</Typography.Text>
      </div>
    </section>
  );
};
