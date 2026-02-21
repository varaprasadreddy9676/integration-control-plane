import { Card, Typography, Row, Col, Space, Grid } from 'antd';
import { BookOutlined, DatabaseOutlined, CodeOutlined, ApiOutlined, ThunderboltOutlined, SettingOutlined } from '@ant-design/icons';
import { useNavigateWithParams } from '../../../utils/navigation';
import { cssVar, useDesignTokens, spacingToNumber } from '../../../design-system/utils';
import { useMemo } from 'react';

const { Title, Paragraph, Text } = Typography;

export const HelpRoute = () => {
  const navigate = useNavigateWithParams();
  const { spacing, token, shadows, transitions } = useDesignTokens();
  const colors = cssVar.legacy;
  const screens = Grid.useBreakpoint();
  const isNarrow = !screens.md;

  const guides = [
    {
      key: 'lookup-guide',
      title: 'Lookup Tables Guide',
      description: 'Learn how to use code mappings to translate identifiers between systems',
      icon: <DatabaseOutlined style={{ fontSize: 32, color: colors.primary[600] }} />,
      path: '/help/lookup-guide',
      topics: ['Setup & Configuration', 'Integration Integration', 'Script Usage', 'Real-World Examples']
    },
    {
      key: 'transformations',
      title: 'Transformations Guide',
      description: 'Master SIMPLE and SCRIPT transformations to reshape event data',
      icon: <CodeOutlined style={{ fontSize: 32, color: colors.success[600] }} />,
      path: '/help/transformations',
      topics: ['Field Mappings', 'JavaScript Scripting', 'Available Functions', 'Best Practices'],
      comingSoon: true
    },
    {
      key: 'integrations',
      title: 'Integrations Overview',
      description: 'Complete guide to creating and managing integration configurations',
      icon: <ApiOutlined style={{ fontSize: 32, color: colors.warning[600] }} />,
      path: '/help/integrations',
      topics: ['Configuration', 'Authentication', 'Delivery Modes', 'Troubleshooting'],
      comingSoon: true
    },
    {
      key: 'multi-action',
      title: 'Multi-Action Integrations',
      description: 'Execute multiple HTTP requests for a single event with conditional logic',
      icon: <ThunderboltOutlined style={{ fontSize: 32, color: colors.error[600] }} />,
      path: '/help/multi-action',
      topics: ['Setup', 'Conditional Execution', 'CleverTap Example', 'Error Handling'],
      comingSoon: true
    },
    {
      key: 'best-practices',
      title: 'Best Practices',
      description: 'Enterprise-grade patterns and recommendations for production deployments',
      icon: <SettingOutlined style={{ fontSize: 32, color: cssVar.text.secondary }} />,
      path: '/help/best-practices',
      topics: ['Security', 'Performance', 'Monitoring', 'Maintenance'],
      comingSoon: true
    }
  ];

  return (
    <div style={{ padding: isNarrow ? spacing[4] : spacing[6] }}>
      <Card
        variant="borderless"
        style={{
          background: cssVar.bg.surface,
          borderRadius: token.borderRadiusLG,
          boxShadow: shadows.sm,
          maxWidth: 1400,
          margin: '0 auto'
        }}
      >
        {/* Header */}
        <div style={{ marginBottom: spacingToNumber(spacing[6]) }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: spacing[3], marginBottom: spacing[3] }}>
            <BookOutlined style={{ fontSize: 36, color: colors.primary[600] }} />
            <div>
              <Title level={2} style={{ margin: 0 }}>Help & Documentation</Title>
              <Text type="secondary">Comprehensive guides to help you get the most out of the Event Gateway</Text>
            </div>
          </div>
        </div>

        {/* Guide Cards */}
        <Row gutter={[16, 16]}>
          {guides.map(guide => (
            <Col xs={24} md={12} lg={8} key={guide.key}>
              <Card
                hoverable={!guide.comingSoon}
                style={{
                  height: '100%',
                  borderRadius: token.borderRadius,
                  border: `1px solid ${colors.neutral[200]}`,
                  cursor: guide.comingSoon ? 'not-allowed' : 'pointer',
                  opacity: guide.comingSoon ? 0.6 : 1,
                  transition: transitions.allSlow
                }}
                onClick={() => !guide.comingSoon && navigate(guide.path)}
              >
                <Space direction="vertical" size="middle" style={{ width: '100%' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    {guide.icon}
                    {guide.comingSoon && (
                      <span style={{
                        background: colors.neutral[200],
                        color: cssVar.text.secondary,
                        padding: '2px 8px',
                        borderRadius: token.borderRadiusSM,
                        fontSize: 11,
                        fontWeight: 500,
                        textTransform: 'uppercase'
                      }}>
                        Coming Soon
                      </span>
                    )}
                  </div>

                  <div>
                    <Title level={4} style={{ marginBottom: 8 }}>{guide.title}</Title>
                    <Paragraph type="secondary" style={{ marginBottom: 12 }}>
                      {guide.description}
                    </Paragraph>
                  </div>

                  <div>
                    <Text strong style={{ fontSize: 13, color: cssVar.text.secondary }}>Topics Covered:</Text>
                    <ul style={{
                      marginTop: 8,
                      marginBottom: 0,
                      paddingLeft: 20,
                      fontSize: 13,
                      color: cssVar.text.secondary
                    }}>
                      {guide.topics.map(topic => (
                        <li key={topic}>{topic}</li>
                      ))}
                    </ul>
                  </div>
                </Space>
              </Card>
            </Col>
          ))}
        </Row>
      </Card>
    </div>
  );
};
