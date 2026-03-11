import { Button, Dropdown, Tooltip, Typography } from 'antd';
import type { MenuProps } from 'antd';
import { ArrowRightOutlined, DownloadOutlined, ReloadOutlined } from '@ant-design/icons';

interface DashboardHeaderProps {
  title: string;
  subtitle: string;
  manageLabel: string;
  onManage: () => void;
  onViewLogs: () => void;
  onRefresh: () => void;
  refreshing: boolean;
  refreshSeconds: number;
  refreshCountdown: number | null;
  exportMenuItems: MenuProps['items'];
  isExporting: boolean;
}

export const DashboardHeader = ({
  title,
  subtitle,
  manageLabel,
  onManage,
  onViewLogs,
  onRefresh,
  refreshing,
  refreshSeconds,
  refreshCountdown,
  exportMenuItems,
  isExporting
}: DashboardHeaderProps) => {
  return (
    <header className="dashboard-header">
      <div className="dashboard-title-wrap">
        <div className="dashboard-title-row">
          <Typography.Title level={3} className="dashboard-title">
            {title}
          </Typography.Title>
          <Button type="link" size="small" className="dashboard-manage-link" onClick={onManage}>
            {manageLabel}
          </Button>
        </div>
        <Typography.Text type="secondary" className="dashboard-subtitle">
          {subtitle}
        </Typography.Text>
      </div>
      <div className="dashboard-actions">
        <Typography.Text type="secondary">
          {refreshSeconds > 0
            ? `Auto-refresh in ${refreshCountdown ?? refreshSeconds}s`
            : 'Auto-refresh off'}
        </Typography.Text>
        <Button type="primary" icon={<ArrowRightOutlined />} onClick={onViewLogs}>
          View Logs
        </Button>
        <Tooltip title={`Refresh now${refreshSeconds > 0 ? ` (next auto refresh in ${refreshCountdown ?? refreshSeconds}s)` : ''}`}>
          <Button icon={<ReloadOutlined />} onClick={onRefresh} loading={refreshing} aria-label="Refresh dashboard" />
        </Tooltip>
        <Dropdown menu={{ items: exportMenuItems }} trigger={['click']} placement="bottomRight">
          <Button icon={<DownloadOutlined />} loading={isExporting} aria-label="Export dashboard" />
        </Dropdown>
      </div>
    </header>
  );
};
