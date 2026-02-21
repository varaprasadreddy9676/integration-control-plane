import { Tabs, Typography } from 'antd';

interface DashboardDetailsTabsProps {
  activeKey: string;
  onChange: (key: string) => void;
  items: { key: string; label: string }[];
}

export const DashboardDetailsTabs = ({ activeKey, onChange, items }: DashboardDetailsTabsProps) => {
  return (
    <div className="dashboard-details-tabs">
      <Typography.Text className="dashboard-section-title">Details</Typography.Text>
      <Tabs
        size="small"
        activeKey={activeKey}
        onChange={onChange}
        items={items}
        tabBarGutter={16}
        tabBarStyle={{ marginBottom: 0 }}
      />
    </div>
  );
};
