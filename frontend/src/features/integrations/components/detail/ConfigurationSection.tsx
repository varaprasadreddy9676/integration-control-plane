import { Row, Col, Form, Input, Select, Space, Typography, Tag, Divider, Collapse } from 'antd';
import { CheckCircleFilled, WarningFilled } from '@ant-design/icons';
import type { FormInstance } from 'antd';
import { cssVar, withAlpha } from '../../../../design-system/utils';
import { HelpPopover, UrlRequirementsHelp, DataSecurityHelp } from './shared';

interface ConfigurationSectionProps {
  form: FormInstance;
  eventTypes: any[];
  uiConfig?: any;
  tenant?: any;
  isMultiAction: boolean;
  eventTypesLoading: boolean;
  scopeValue?: string;
  excludedEntityRids?: number[];
  spacing: any;
  token: any;
  colors: any;
}

const spacingToNumber = (value: any): number => {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') return parseInt(value, 10) || 0;
  return 0;
};

/**
 * ConfigurationSection - Basic integration configuration fields
 *
 * Compact enterprise design with help popovers for progressive disclosure.
 * Removes verbose alerts in favor of inline help icons.
 */
export const ConfigurationSection = ({
  form,
  eventTypes,
  uiConfig,
  tenant,
  isMultiAction,
  eventTypesLoading,
  scopeValue,
  excludedEntityRids,
  spacing,
  token,
  colors
}: ConfigurationSectionProps) => {
  // Add wildcard option at the beginning and extract eventType property
  const eventOptions = ['*', ...(eventTypes?.map((et: any) => et.eventType) || [])];

  return (
    <div>
      <Row gutter={[spacingToNumber(spacing[4]), 0]}>
        <Col xs={24} lg={12}>
          <Form.Item name="name" label="Event Rule Name" rules={[{ required: true, message: 'Name is required' }]}>
            <Input placeholder="e.g., Patient Registration to CRM" size="large" />
          </Form.Item>
        </Col>
        <Col xs={24} lg={12}>
          <Form.Item name="eventType" label="Event Type" rules={[{ required: true, message: 'Event type is required' }]}>
            <Select
              options={eventOptions.map((value) => ({
                label: value === '*' ? '* (All Events)' : value,
                value
              }))}
              placeholder="Select event to trigger this event rule"
              loading={eventTypesLoading}
              showSearch
              size="large"
            />
          </Form.Item>
        </Col>
        {isMultiAction ? (
          <Col xs={24}>
            <Space size="small" style={{ color: colors.info[600], marginBottom: spacing[3] }}>
              <Typography.Text type="secondary" style={{ fontSize: 13 }}>
                Target URLs are configured in each action below. Expand the <strong>"Actions"</strong> section to edit.
              </Typography.Text>
            </Space>
          </Col>
        ) : (
          <Col xs={24}>
            <Form.Item
              name="targetUrl"
              label={
                <Space size={4}>
                  Target URL
                  <HelpPopover
                    title="URL Requirements"
                    content={<UrlRequirementsHelp />}
                  />
                </Space>
              }
              rules={[
                { required: !isMultiAction, message: 'Target URL is required' },
                { pattern: /^https?:\/\/.+/i, message: 'Must be a valid HTTP or HTTPS URL' }
              ]}
            >
              <Input placeholder="https://api.example.com/integrations/receive" size="large" />
            </Form.Item>
          </Col>
        )}
        <Col xs={24} sm={12}>
          <Form.Item name="httpMethod" label="HTTP Method" rules={[{ required: true }]}>
            <Select
              options={uiConfig?.httpMethods || []}
              size="large"
            />
          </Form.Item>
        </Col>
        <Col xs={24} sm={12}>
          <Form.Item
            name="scope"
            label={
              <Space size={4}>
                Entity Scope
                {scopeValue === 'INCLUDE_CHILDREN' && tenant && tenant.childEntities && tenant.childEntities.length > 0 && (
                  <HelpPopover
                    title="Multi-Entity Compliance"
                    content={<DataSecurityHelp entityCount={tenant.childEntities.length + 1} />}
                  />
                )}
              </Space>
            }
            rules={[{ required: true }]}
          >
            <Select
              options={uiConfig?.scopeTypes || []}
              size="large"
            />
          </Form.Item>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            Entity only applies to this entity. Include children applies to all child entities of the parent.
          </Typography.Text>
        </Col>
      </Row>

      {/* Child Entities Display - Only show when scope is INCLUDE_CHILDREN */}
      {scopeValue === 'INCLUDE_CHILDREN' && tenant && tenant.childEntities && tenant.childEntities.length > 0 && (
        <Row gutter={[spacingToNumber(spacing[4]), spacingToNumber(spacing[4])]} style={{ marginTop: spacing[4] }}>
          <Col xs={24}>
            <Divider style={{ margin: `${spacing[3]} 0` }} />

            {/* Compact Summary Status */}
            {(excludedEntityRids?.length || 0) === tenant.childEntities.length ? (
              <Space size="small" style={{ marginBottom: spacing[4] }}>
                <WarningFilled style={{ color: colors.error[600], fontSize: 16 }} />
                <Typography.Text strong style={{ color: colors.error[700] }}>
                  All child entities excluded - integration will only process parent events
                </Typography.Text>
              </Space>
            ) : (
              <Space size="small" style={{ marginBottom: spacing[4] }}>
                <CheckCircleFilled style={{ color: colors.success[600], fontSize: 16 }} />
                <Typography.Text strong style={{ color: colors.success[700] }}>
                  Processing events from {tenant.childEntities.length + 1 - (excludedEntityRids?.length || 0)} entities
                </Typography.Text>
                {excludedEntityRids && excludedEntityRids.length > 0 && (
                  <Typography.Text type="secondary" style={{ fontSize: 13 }}>
                    ({excludedEntityRids.length} excluded)
                  </Typography.Text>
                )}
              </Space>
            )}

            {/* Exclusion Field */}
            <Form.Item
              name="excludedEntityRids"
              label={
                <Space>
                  <span>Excluded Child Entities (Optional)</span>
                  <Tag color="default" style={{ fontSize: 11 }}>
                    {tenant.childEntities.length} available
                  </Tag>
                </Space>
              }
              tooltip="Exclude specific child entities"
            >
              <Select
                mode="multiple"
                placeholder="All child entities included by default - select to exclude"
                size="large"
                allowClear
                showSearch
                filterOption={(input, option) =>
                  String(option?.label ?? '').toLowerCase().includes(input.toLowerCase())
                }
                options={tenant.childEntities.map((child: any) => ({
                  label: `${child.name} (RID: ${child.rid})`,
                  value: child.rid
                }))}
                maxTagCount="responsive"
              />
            </Form.Item>

            {/* Visual Display of All Entities */}
            <Collapse
              style={{
                background: cssVar.bg.surface,
                border: `1px solid ${cssVar.border.default}`,
                borderRadius: token.borderRadius
              }}
              items={[
                {
                  key: 'entities',
                  label: (
                    <Space>
                      <Typography.Text strong style={{ fontSize: 14 }}>
                        View all entities ({tenant.childEntities.length + 1})
                      </Typography.Text>
                      <Typography.Text style={{ fontSize: 12, color: cssVar.text.muted }}>
                        Click to see which entities will receive this integration
                      </Typography.Text>
                    </Space>
                  ),
                  children: (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: spacing[2] }}>
                      {/* Parent Entity */}
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          padding: spacing[3],
                          background: cssVar.bg.elevated,
                          border: `1px solid ${cssVar.border.default}`,
                          borderRadius: token.borderRadius
                        }}
                      >
                        <Space>
                          <Typography.Text strong style={{ fontSize: 14 }}>
                            {tenant.tenantName}
                          </Typography.Text>
                          <Tag color="blue" style={{ fontSize: 11 }}>
                            Parent
                          </Tag>
                          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                            RID: {tenant.orgId}
                          </Typography.Text>
                        </Space>
                        <Tag
                          style={{
                            fontSize: 12,
                            margin: 0,
                            color: cssVar.success.text,
                            background: withAlpha(cssVar.success.bg, 0.8),
                            border: `1px solid ${cssVar.success.border}`
                          }}
                        >
                          ✓ Included
                        </Tag>
                      </div>

                      {/* Child Entities */}
                      <Divider style={{ margin: `${spacing[2]} 0` }}>
                        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                          Child Entities ({tenant.childEntities.length})
                        </Typography.Text>
                      </Divider>

                      <div
                        style={{
                          display: 'grid',
                          gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
                          gap: spacing[2],
                          maxHeight: '400px',
                          overflowY: 'auto',
                          padding: spacing[1]
                        }}
                      >
                        {tenant.childEntities.map((child: any) => {
                          const isExcluded = excludedEntityRids?.includes(child.rid);
                          return (
                            <div
                              key={child.rid}
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                padding: spacing[2],
                                background: isExcluded
                                  ? cssVar.bg.subtle
                                  : withAlpha(cssVar.success.bg, 0.35),
                                border: `1px solid ${
                                  isExcluded
                                    ? cssVar.border.default
                                    : cssVar.success.border
                                }`,
                                borderRadius: token.borderRadius,
                                opacity: isExcluded ? 0.75 : 1
                              }}
                            >
                              <Space direction="vertical" size={0}>
                                <Typography.Text
                                  strong={!isExcluded}
                                  style={{
                                    fontSize: 13,
                                    color: isExcluded ? cssVar.text.muted : cssVar.text.primary
                                  }}
                                >
                                  {child.name}
                                </Typography.Text>
                                <Typography.Text
                                  type="secondary"
                                  style={{ fontSize: 11 }}
                                >
                                  RID: {child.rid} • {child.code}
                                </Typography.Text>
                              </Space>
                              <Tag
                                style={{
                                  fontSize: 11,
                                  margin: 0,
                                  color: isExcluded ? cssVar.text.secondary : cssVar.success.text,
                                  background: isExcluded ? cssVar.bg.subtle : withAlpha(cssVar.success.bg, 0.8),
                                  border: `1px solid ${isExcluded ? cssVar.border.default : cssVar.success.border}`
                                }}
                              >
                                {isExcluded ? '✕ Excluded' : '✓ Included'}
                              </Tag>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )
                }
              ]}
            />
          </Col>
        </Row>
      )}
    </div>
  );
};
