import { Alert, Spin, Typography } from 'antd';
import { useDesignTokens } from '../../design-system/utils';

interface Props {
  variant: 'loading' | 'error';
  title: string;
  description: string;
}

export const TenantLoadingState = ({ variant, title, description }: Props) => {
  const { spacing, token } = useDesignTokens();
  const foreground = 'rgba(255, 255, 255, 0.96)';
  const foregroundMuted = 'rgba(255, 255, 255, 0.84)';

  const shellStyle = {
    minHeight: '100vh',
    display: 'grid',
    placeItems: 'center',
    background: 'linear-gradient(180deg, var(--color-primary-800) 0%, var(--color-primary-700) 100%)',
    color: foreground,
    padding: spacing[6]
  } as const;

  if (variant === 'error') {
    return (
      <div style={shellStyle}>
        <Alert message={title} description={description} type="error" showIcon />
      </div>
    );
  }

  return (
    <div style={shellStyle}>
      <div style={{ textAlign: 'center' }}>
        <Spin size="large" style={{ color: foreground }} />
        <Typography.Paragraph style={{ marginTop: spacing[4], color: foregroundMuted, fontSize: token.fontSize, margin: 0 }}>
          {title} — {description}
        </Typography.Paragraph>
      </div>
    </div>
  );
};
