import { Typography } from 'antd';
import { DashboardMetricTile } from './DashboardPrimitives';

interface DashboardKpiSectionProps {
  metrics: Array<{
    label: string;
    value: string;
    delta?: string;
    icon: JSX.Element;
    tone: string;
    trend?: number;
    trendLabel?: string;
    onClick?: () => void;
  }>;
  loading: boolean;
}

export const DashboardKpiSection = ({ metrics, loading }: DashboardKpiSectionProps) => {
  return (
    <section className="dashboard-overview">
      <Typography.Text className="dashboard-section-title">Today's Overview</Typography.Text>
      <div className="dashboard-kpis">
        {loading
          ? metrics.map((metric) => (
            <DashboardMetricTile key={metric.label} {...metric} loading />
          ))
          : metrics.map((metric) => (
            <DashboardMetricTile key={metric.label} {...metric} onClick={metric.onClick} />
          ))}
      </div>
    </section>
  );
};
