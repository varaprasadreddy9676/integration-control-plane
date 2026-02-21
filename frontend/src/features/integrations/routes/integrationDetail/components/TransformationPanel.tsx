import { Button, Skeleton, Space, Tag, Tooltip, Typography, Row, Col, Alert } from 'antd';
import { ThunderboltOutlined } from '@ant-design/icons';
import { cssVar, spacingToNumber, withAlpha } from '../../../../../design-system/utils';
import { MonacoEditorInput } from '../../../components/MonacoEditorInput';
import { SectionCard } from './SectionCard';

interface TransformationPanelProps {
  isCreate: boolean;
  isEditMode: boolean;
  transformationTab: 'SIMPLE' | 'SCRIPT';
  selectedEventType?: string;
  mappingState: { mappings: any[]; staticFields: any[] };
  scriptValue: string;
  lastPreviewMeta?: { durationMs?: number; status?: number };
  spacing: Record<string, string>;
  token: any;
  colors: any;
  tagTone: (base: string) => any;
  onPreview: () => void;
  onOpenDesigner: () => void;
  formatScriptForDisplay: (script?: string) => string;
  isLoading?: boolean;
}

export const TransformationPanelHeader = ({
  spacing,
  colors
}: Pick<TransformationPanelProps, 'spacing' | 'colors'>) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: spacingToNumber(spacing[2]) }}>
    <ThunderboltOutlined style={{ fontSize: 18, color: colors.primary[600] }} />
    <div>
      <Typography.Text strong style={{ fontSize: 15 }}>Payload Transformation</Typography.Text>
    </div>
  </div>
);

export const TransformationPanelContent = ({
  isCreate,
  isEditMode,
  transformationTab,
  selectedEventType,
  mappingState,
  scriptValue,
  lastPreviewMeta,
  spacing,
  token,
  colors,
  tagTone,
  onPreview,
  onOpenDesigner,
  formatScriptForDisplay,
  isLoading = false
}: TransformationPanelProps) => {
  if (isLoading) {
    return (
      <div style={{ padding: spacing[3] }}>
        <Skeleton active paragraph={{ rows: 8 }} />
      </div>
    );
  }

  // Disable transformation section until event type is selected
  if (!selectedEventType) {
    return (
      <Row gutter={[spacingToNumber(spacing[4]), 0]}>
        <Col xs={24}>
          <Alert
            type="info"
            showIcon
            message="Select an event type first"
            description="Payload transformation configuration will be available after you select an event type in the Configuration section above."
            style={{ marginBottom: 0 }}
          />
        </Col>
      </Row>
    );
  }

  return (
    <>
      <SectionCard
        title="Payload Transformation"
        description="Transform event payloads before delivery"
        spacing={spacing}
        token={token}
        headerExtras={
          (isCreate || isEditMode) ? (
            <Space>
              <Button
                icon={<ThunderboltOutlined />}
                onClick={onPreview}
              >
                Preview
              </Button>
              <Button
                onClick={onOpenDesigner}
                type="primary"
              >
                Configure Transformation
              </Button>
            </Space>
          ) : undefined
        }
      >
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: spacingToNumber(spacing[3]),
              padding: `${spacing[4]} ${spacing[4]}`,
              background: cssVar.bg.subtle,
              borderRadius: token.borderRadius,
              border: `1px solid ${cssVar.border.default}`
            }}
          >
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: spacingToNumber(spacing[2]), alignItems: 'center' }}>
              <Typography.Text strong>Transformation Mode:</Typography.Text>
              <Tag style={tagTone(colors.info[600])}>
                {transformationTab === 'SCRIPT' ? 'JavaScript Function' : 'Field Mapping'}
              </Tag>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: spacingToNumber(spacing[3]) }}>
              <div style={{ display: 'flex', gap: spacingToNumber(spacing[1]), alignItems: 'center' }}>
                <Typography.Text type="secondary" style={{ color: cssVar.text.secondary }}>Mapped Fields:</Typography.Text>
                <Tag style={tagTone(colors.success[600])}>{(mappingState.mappings as any[])?.length ?? 0}</Tag>
              </div>
              <div style={{ display: 'flex', gap: spacingToNumber(spacing[1]), alignItems: 'center' }}>
                <Typography.Text type="secondary" style={{ color: cssVar.text.secondary }}>Static Fields:</Typography.Text>
                <Tag style={tagTone(colors.neutral[600])}>{(mappingState.staticFields as any[])?.length ?? 0}</Tag>
              </div>
              {lastPreviewMeta && (
                <div style={{ display: 'flex', gap: spacingToNumber(spacing[1]), alignItems: 'center' }}>
                  <Typography.Text type="secondary" style={{ color: cssVar.text.secondary }}>Last Preview:</Typography.Text>
                  <Tag>{lastPreviewMeta.durationMs ?? 0} ms</Tag>
                </div>
              )}
            </div>

            {!isCreate && !isEditMode && transformationTab === 'SCRIPT' && scriptValue && (
              <div style={{ marginTop: spacing[3] }}>
                <Typography.Text strong style={{ display: 'block', marginBottom: spacing[2] }}>
                  Transformation Script:
                </Typography.Text>
                <MonacoEditorInput
                  height="300px"
                  value={formatScriptForDisplay(scriptValue)}
                  readOnly
                />
              </div>
            )}

            {!isCreate && !isEditMode && transformationTab === 'SIMPLE' && (mappingState.mappings as any[])?.length > 0 && (
              <div style={{ marginTop: spacing[3] }}>
                <Typography.Text strong style={{ display: 'block', marginBottom: spacing[2] }}>
                  Field Mappings:
                </Typography.Text>
                <div style={{
                  background: cssVar.bg.surface,
                  border: `1px solid ${cssVar.border.default}`,
                  borderRadius: token.borderRadius,
                  overflow: 'hidden'
                }}>
                  {(mappingState.mappings as any[]).map((mapping: any, index: number) => (
                    <div
                      key={index}
                      style={{
                        padding: `${spacing[2]} ${spacing[3]}`,
                        borderBottom: index < (mappingState.mappings as any[]).length - 1 ? `1px solid ${cssVar.border.default}` : 'none',
                        display: 'flex',
                        alignItems: 'center',
                        gap: spacing[3]
                      }}
                    >
                      <code style={{ fontSize: 13, color: colors.primary[600], fontWeight: 600 }}>
                        {mapping.targetField}
                      </code>
                      <span style={{ color: cssVar.text.muted }}>←</span>
                      <code style={{ fontSize: 13, color: cssVar.text.secondary }}>
                        {mapping.sourceField}
                      </code>
                      {mapping.transform && mapping.transform !== 'none' && (
                        <Tag style={{ fontSize: 11 }}>
                          {mapping.transform}
                        </Tag>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {!isCreate && !isEditMode && (mappingState.staticFields as any[])?.length > 0 && (
              <div style={{ marginTop: spacing[3] }}>
                <Typography.Text strong style={{ display: 'block', marginBottom: spacing[2] }}>
                  Static Fields:
                </Typography.Text>
                <div style={{
                  background: cssVar.bg.surface,
                  border: `1px solid ${cssVar.border.default}`,
                  borderRadius: token.borderRadius,
                  overflow: 'hidden'
                }}>
                  {(mappingState.staticFields as any[]).map((field: any, index: number) => (
                    <div
                      key={index}
                      style={{
                        padding: `${spacing[2]} ${spacing[3]}`,
                        borderBottom: index < (mappingState.staticFields as any[]).length - 1 ? `1px solid ${cssVar.border.default}` : 'none',
                        display: 'flex',
                        alignItems: 'center',
                        gap: spacing[3]
                      }}
                    >
                      <code style={{ fontSize: 13, color: colors.primary[600], fontWeight: 600 }}>
                        {field.key}
                      </code>
                      <span style={{ color: cssVar.text.muted }}>←</span>
                      <code style={{ fontSize: 13, color: cssVar.text.secondary }}>
                        {field.value}
                      </code>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </SectionCard>
    </>
  );
};
