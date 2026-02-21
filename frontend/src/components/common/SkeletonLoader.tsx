import { Skeleton, Card, Space } from 'antd';
import { useDesignTokens } from '../../design-system/utils';

interface SkeletonLoaderProps {
  variant?: 'card' | 'table' | 'metric' | 'list' | 'chart' | 'form';
  count?: number;
  animated?: boolean;
}

export const SkeletonLoader = ({
  variant = 'card',
  count = 1,
  animated = true
}: SkeletonLoaderProps) => {
  const { spacing } = useDesignTokens();

  const renderMetricSkeleton = () => (
    <Card
      style={{
        height: 140,
        animation: 'fadeInScale 300ms cubic-bezier(0.16, 1, 0.3, 1)'
      }}
    >
      <Space direction="vertical" size="large" style={{ width: '100%' }}>
        <Skeleton.Input active={animated} size="small" style={{ width: 120 }} />
        <Skeleton.Input active={animated} size="large" style={{ width: 180, height: 48 }} />
        <Skeleton.Input active={animated} size="small" style={{ width: 100 }} />
      </Space>
    </Card>
  );

  const renderCardSkeleton = () => (
    <Card
      style={{
        animation: 'fadeInScale 300ms cubic-bezier(0.16, 1, 0.3, 1)'
      }}
    >
      <Skeleton
        active={animated}
        paragraph={{ rows: 4 }}
        title={{ width: '60%' }}
      />
    </Card>
  );

  const renderTableSkeleton = () => (
    <Card
      style={{
        animation: 'fadeInScale 300ms cubic-bezier(0.16, 1, 0.3, 1)'
      }}
    >
      <Skeleton
        active={animated}
        paragraph={{ rows: 8 }}
        title={{ width: '40%' }}
      />
    </Card>
  );

  const renderListSkeleton = () => (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      gap: spacing[3],
      animation: 'fadeInScale 300ms cubic-bezier(0.16, 1, 0.3, 1)'
    }}>
      <Skeleton
        active={animated}
        avatar
        paragraph={{ rows: 2 }}
      />
    </div>
  );

  const renderChartSkeleton = () => (
    <Card
      style={{
        height: 400,
        animation: 'fadeInScale 300ms cubic-bezier(0.16, 1, 0.3, 1)'
      }}
    >
      <Skeleton.Input
        active={animated}
        size="small"
        style={{ width: 150, marginBottom: spacing[4] }}
      />
      <Skeleton.Image
        active={animated}
        style={{ width: '100%', height: 300 }}
      />
    </Card>
  );

  const renderFormSkeleton = () => (
    <Card
      style={{
        animation: 'fadeInScale 300ms cubic-bezier(0.16, 1, 0.3, 1)'
      }}
    >
      <Space direction="vertical" size="large" style={{ width: '100%' }}>
        <div>
          <Skeleton.Input active={animated} size="small" style={{ width: 100, marginBottom: spacing[2] }} />
          <Skeleton.Input active={animated} size="large" block />
        </div>
        <div>
          <Skeleton.Input active={animated} size="small" style={{ width: 120, marginBottom: spacing[2] }} />
          <Skeleton.Input active={animated} size="large" block />
        </div>
        <div>
          <Skeleton.Input active={animated} size="small" style={{ width: 80, marginBottom: spacing[2] }} />
          <Skeleton.Input active={animated} size="large" block style={{ height: 120 }} />
        </div>
        <Skeleton.Button active={animated} size="large" style={{ width: 150 }} />
      </Space>
    </Card>
  );

  const renderVariant = () => {
    switch (variant) {
      case 'metric':
        return renderMetricSkeleton();
      case 'table':
        return renderTableSkeleton();
      case 'list':
        return renderListSkeleton();
      case 'chart':
        return renderChartSkeleton();
      case 'form':
        return renderFormSkeleton();
      default:
        return renderCardSkeleton();
    }
  };

  return (
    <>
      {Array.from({ length: count }).map((_, index) => (
        <div
          key={index}
          style={{
            animationDelay: `${index * 50}ms`
          }}
        >
          {renderVariant()}
        </div>
      ))}
    </>
  );
};
