import { Button, Typography, Space, theme } from 'antd';
import { SyncOutlined, ApiOutlined, DisconnectOutlined } from '@ant-design/icons';
import { useDesignTokens } from '../../design-system/utils';
import { useThemeMode } from '../../app/theme-provider';

interface Props {
    onRetry?: () => void;
    title?: string;
    description?: string;
}

export const ServerOfflineState = ({
    onRetry = () => window.location.reload(),
    title = "Connection Lost",
    description = "We are unable to reach the integration gateway. Please check your network connection or the server status."
}: Props) => {
    const { spacing, token } = useDesignTokens();
    const { mode } = useThemeMode();
    const isDark = mode === 'dark';

    return (
        <div
            style={{
                minHeight: '100vh',
                width: '100%',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                background: 'var(--color-bg-base)',
                padding: spacing[6],
            }}
        >
            <div
                style={{
                    textAlign: 'center',
                    maxWidth: '480px',
                    padding: spacing[8],
                    background: token.colorBgContainer,
                    borderRadius: token.borderRadiusLG,
                    border: `1px solid ${token.colorBorderSecondary}`,
                    boxShadow: token.boxShadowSecondary,
                }}
            >
                <div
                    style={{
                        marginBottom: spacing[6],
                        display: 'inline-flex',
                        justifyContent: 'center',
                        alignItems: 'center',
                        width: 80,
                        height: 80,
                        borderRadius: '50%',
                        background: isDark ? 'rgba(255, 77, 79, 0.1)' : 'rgba(255, 77, 79, 0.05)',
                        color: token.colorError,
                    }}
                >
                    <DisconnectOutlined style={{ fontSize: 40 }} />
                </div>

                <Typography.Title
                    level={3}
                    style={{
                        marginBottom: spacing[3],
                        fontWeight: 600,
                        color: token.colorTextHeading
                    }}
                >
                    {title}
                </Typography.Title>

                <Typography.Paragraph
                    style={{
                        fontSize: token.fontSize,
                        color: token.colorTextSecondary,
                        lineHeight: 1.6,
                        marginBottom: spacing[8]
                    }}
                >
                    {description}
                </Typography.Paragraph>

                <Space size="middle" style={{ width: '100%', justifyContent: 'center' }}>
                    <Button
                        size="large"
                        icon={<ApiOutlined />}
                        href="/docs"
                    >
                        System Status
                    </Button>
                    <Button
                        type="primary"
                        size="large"
                        icon={<SyncOutlined />}
                        onClick={onRetry}
                    >
                        Retry Connection
                    </Button>
                </Space>
            </div>
        </div>
    );
};
