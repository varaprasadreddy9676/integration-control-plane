import { useState, useMemo } from 'react';
import type { KeyboardEvent } from 'react';
import { Input, Card, Typography, Space, Tag, Button, Collapse, Empty, Spin, Alert, Grid, Popconfirm, Tooltip, message } from 'antd';
import {
  SearchOutlined,
  ThunderboltOutlined,
  FolderOpenOutlined,
  FileTextOutlined,
  InfoCircleOutlined,
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  DownloadOutlined
} from '@ant-design/icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getAllEventTypes, deleteEventType, importEventTemplates } from '../../../services/api';
import type { EventType } from '../../../services/api';
import { useNavigateWithParams } from '../../../utils/navigation';
import { cssVar, useDesignTokens, withAlpha, spacingToNumber } from '../../../design-system/utils';
import { EventDetailDrawer } from '../components/EventDetailDrawer';
import { useThemeMode } from '../../../app/theme-provider';
import { PermissionGuard } from '../../../components/common/PermissionGuard';
import { FEATURES } from '../../../utils/permissions';
import { EventTypeEditorModal } from './EventTypeEditorModal';

const { Title, Text, Paragraph } = Typography;

export const EventCatalogRoute = () => {
  const { token, themeColors, spacing } = useDesignTokens();
  const colors = cssVar.legacy;
  const { mode } = useThemeMode();
  const screens = Grid.useBreakpoint();
  const isMobile = !screens.md;
  const navigate = useNavigateWithParams();
  const queryClient = useQueryClient();

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedEvent, setSelectedEvent] = useState<EventType | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingEvent, setEditingEvent] = useState<EventType | null>(null);
  const [importing, setImporting] = useState(false);

  // Fetch all event types
  const { data: eventTypes = [], isLoading, error } = useQuery({
    queryKey: ['eventTypes'],
    queryFn: getAllEventTypes,
    staleTime: 10 * 60 * 1000 // 10 minutes
  });

  // Collect categories for the editor modal
  const categories = useMemo(
    () => Array.from(new Set(eventTypes.map(e => e.category).filter(Boolean))),
    [eventTypes]
  );

  // Group events by category
  const eventsByCategory = useMemo(() => {
    const filtered = eventTypes.filter((event) => {
      if (!searchQuery) return true;
      const query = searchQuery.toLowerCase();
      return (
        event.eventType.toLowerCase().includes(query) ||
        event.label.toLowerCase().includes(query) ||
        event.description.toLowerCase().includes(query) ||
        event.category.toLowerCase().includes(query)
      );
    });

    const grouped = filtered.reduce((acc, event) => {
      if (!acc[event.category]) {
        acc[event.category] = [];
      }
      acc[event.category].push(event);
      return acc;
    }, {} as Record<string, EventType[]>);

    // Sort categories and events
    const sorted: Record<string, EventType[]> = {};
    Object.keys(grouped).sort().forEach((category) => {
      sorted[category] = grouped[category].sort((a, b) => a.label.localeCompare(b.label));
    });

    return sorted;
  }, [eventTypes, searchQuery]);

  const totalEvents = useMemo(() => {
    return Object.values(eventsByCategory).reduce((sum, events) => sum + events.length, 0);
  }, [eventsByCategory]);

  const handleEventClick = (event: EventType) => {
    setSelectedEvent(event);
    setDrawerOpen(true);
  };

  const handleEventKeyDown = (eventItem: EventType, e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handleEventClick(eventItem);
    }
  };

  const handleCreateIntegration = (eventType: string) => {
    navigate(`/integrations/new?eventType=${encodeURIComponent(eventType)}`);
  };

  const handleEdit = (event: EventType, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingEvent(event);
    setEditorOpen(true);
  };

  const handleDelete = async (event: EventType) => {
    try {
      await deleteEventType(event.eventType);
      message.success(`Event type "${event.label}" deleted`);
      queryClient.invalidateQueries({ queryKey: ['eventTypes'] });
    } catch (err: any) {
      message.error(err?.message || 'Failed to delete event type');
    }
  };

  const handleImportTemplates = async () => {
    setImporting(true);
    try {
      const result = await importEventTemplates();
      message.success(result.message);
      queryClient.invalidateQueries({ queryKey: ['eventTypes'] });
    } catch (err: any) {
      message.error(err?.message || 'Failed to import templates');
    } finally {
      setImporting(false);
    }
  };

  const handleAddNew = () => {
    setEditingEvent(null);
    setEditorOpen(true);
  };

  const isOrgSpecific = (event: EventType) => event.orgId !== null && event.orgId !== undefined;

  const renderEventCard = (event: EventType) => (
    <Card
      key={event.eventType}
      className="event-card"
      hoverable
      onClick={() => handleEventClick(event)}
      onKeyDown={(e) => handleEventKeyDown(event, e)}
      role="button"
      tabIndex={0}
      aria-label={`View details for ${event.label}`}
      style={{
        marginBottom: spacing[3],
        borderRadius: token.borderRadius,
        background: mode === 'dark' ? withAlpha(colors.neutral[800], 0.5) : cssVar.bg.surface,
        border: `1px solid ${mode === 'dark' ? withAlpha(colors.neutral[700], 0.3) : cssVar.border.default}`,
        cursor: 'pointer'
      }}
      styles={{ body: { padding: spacing[4] } }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: spacing[3] }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <Space direction="vertical" size={spacingToNumber(spacing[2])} style={{ width: '100%' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: spacing[2] }}>
              <FileTextOutlined style={{ color: colors.primary[600], fontSize: 16 }} />
              <Text strong style={{ fontSize: 15, color: token.colorText }}>
                {event.label}
              </Text>
              {/* Global / Custom badge */}
              {isOrgSpecific(event) ? (
                <Tag color="blue" style={{ margin: 0, fontSize: 11 }}>Custom</Tag>
              ) : (
                <Tag color="default" style={{ margin: 0, fontSize: 11 }}>Global template</Tag>
              )}
            </div>

            <Text type="secondary" style={{ fontSize: 13, display: 'block' }}>
              {event.description}
            </Text>

            <Space size={spacingToNumber(spacing[2])} wrap>
              <Tag
                style={{
                  margin: 0,
                  fontSize: 11,
                  padding: '2px 8px',
                  background: mode === 'dark' ? withAlpha(colors.neutral[800], 0.6) : withAlpha(colors.neutral[100], 0.8),
                  color: token.colorTextSecondary,
                  fontFamily: 'monospace'
                }}
              >
                {event.eventType}
              </Tag>
              <Tag
                color="blue"
                style={{ margin: 0, fontSize: 11, padding: '2px 8px' }}
              >
                {event.fields?.length || 0} fields
              </Tag>
              {event.samplePayload && (
                <Tag
                  color="green"
                  style={{ margin: 0, fontSize: 11, padding: '2px 8px' }}
                >
                  Sample available
                </Tag>
              )}
            </Space>
          </Space>
        </div>

        <div style={{ display: 'flex', gap: 6, flexShrink: 0, alignItems: 'center' }}>
          {/* Edit/Delete — only for org-specific events */}
          <PermissionGuard feature={FEATURES.EVENT_CATALOGUE} operation="write">
            {isOrgSpecific(event) && (
              <>
                <Tooltip title="Edit">
                  <Button
                    icon={<EditOutlined />}
                    size="small"
                    onClick={(e) => handleEdit(event, e)}
                  />
                </Tooltip>
                <Popconfirm
                  title={`Delete "${event.label}"?`}
                  description="This will permanently remove this event type from your catalogue."
                  onConfirm={(e) => { e?.stopPropagation(); handleDelete(event); }}
                  onCancel={(e) => e?.stopPropagation()}
                  okText="Delete"
                  okButtonProps={{ danger: true }}
                >
                  <Tooltip title="Delete">
                    <Button
                      icon={<DeleteOutlined />}
                      size="small"
                      danger
                      onClick={(e) => e.stopPropagation()}
                    />
                  </Tooltip>
                </Popconfirm>
              </>
            )}
          </PermissionGuard>

          {!isMobile && (
            <Button
              type="primary"
              size="small"
              icon={<ThunderboltOutlined />}
              onClick={(e) => {
                e.stopPropagation();
                handleCreateIntegration(event.eventType);
              }}
            >
              Create Integration
            </Button>
          )}
        </div>
      </div>
    </Card>
  );

  if (isLoading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 400 }}>
        <Spin size="large" tip="Loading event catalog...">
          <div style={{ minHeight: 80 }} />
        </Spin>
      </div>
    );
  }

  if (error) {
    return (
      <Alert
        type="error"
        message="Failed to load event catalog"
        description={error instanceof Error ? error.message : 'Unknown error occurred'}
        showIcon
      />
    );
  }

  return (
    <>
      <div style={{ maxWidth: 1400, margin: '0 auto' }}>
        {/* Header */}
        <div style={{ marginBottom: spacing[6] }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: spacing[3], marginBottom: spacing[3] }}>
            <Title level={2} style={{ margin: 0, fontSize: isMobile ? 24 : 32 }}>
              Event Catalog
            </Title>

            {/* Action buttons — visible to users with manage permission */}
            <PermissionGuard feature={FEATURES.EVENT_CATALOGUE} operation="write">
              <Space wrap>
                <Button
                  icon={<DownloadOutlined />}
                  loading={importing}
                  onClick={handleImportTemplates}
                >
                  Import Templates
                </Button>
                <Button
                  type="primary"
                  icon={<PlusOutlined />}
                  onClick={handleAddNew}
                >
                  Add Event Type
                </Button>
              </Space>
            </PermissionGuard>
          </div>

          <Paragraph type="secondary" style={{ fontSize: 15, marginBottom: spacing[4] }}>
            Browse all available event types. Global templates are shared across all orgs; Custom types are specific to your org.
          </Paragraph>

          {/* Search */}
          <Input
            size="large"
            placeholder="Search events by name, type, or category..."
            prefix={<SearchOutlined style={{ color: token.colorTextSecondary }} />}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            allowClear
            aria-label="Search event catalog"
            style={{
              maxWidth: 600,
              borderRadius: token.borderRadiusLG
            }}
          />

          {/* Stats */}
          <div style={{ marginTop: spacing[4], display: 'flex', gap: spacing[4], flexWrap: 'wrap' }}>
            <div>
              <Text type="secondary" style={{ fontSize: 13, display: 'block' }}>Total Events</Text>
              <Text strong style={{ fontSize: 24, color: colors.primary[600] }}>
                {eventTypes.length}
              </Text>
            </div>
            <div>
              <Text type="secondary" style={{ fontSize: 13, display: 'block' }}>Categories</Text>
              <Text strong style={{ fontSize: 24, color: colors.info[600] }}>
                {Object.keys(eventsByCategory).length}
              </Text>
            </div>
            <div>
              <Text type="secondary" style={{ fontSize: 13, display: 'block' }}>Custom</Text>
              <Text strong style={{ fontSize: 24, color: colors.success?.[600] || colors.primary[600] }}>
                {eventTypes.filter(isOrgSpecific).length}
              </Text>
            </div>
            {searchQuery && (
              <div>
                <Text type="secondary" style={{ fontSize: 13, display: 'block' }}>Filtered Results</Text>
                <Text strong style={{ fontSize: 24, color: colors.success[600] }}>
                  {totalEvents}
                </Text>
              </div>
            )}
          </div>
        </div>

        {/* Event Categories */}
        {totalEvents === 0 ? (
          <div>
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={
                <span>
                  {searchQuery ? `No events matching "${searchQuery}"` : 'No events available'}
                </span>
              }
            />
            {searchQuery && (
              <div style={{ display: 'flex', justifyContent: 'center', marginTop: spacing[2] }}>
                <Button onClick={() => setSearchQuery('')}>Clear search</Button>
              </div>
            )}
          </div>
        ) : (
          <Collapse
            defaultActiveKey={Object.keys(eventsByCategory)}
            ghost
            expandIconPosition="end"
            style={{ background: 'transparent' }}
            items={Object.entries(eventsByCategory).map(([category, events]) => ({
              key: category,
              label: (
                <div style={{ display: 'flex', alignItems: 'center', gap: spacing[3] }}>
                  <FolderOpenOutlined style={{ color: colors.primary[600], fontSize: 18 }} />
                  <Text strong style={{ fontSize: 16 }}>
                    {category}
                  </Text>
                  <Tag
                    style={{
                      margin: 0,
                      background: mode === 'dark' ? withAlpha(colors.primary[900], 0.3) : withAlpha(colors.primary[50], 0.8),
                      color: mode === 'dark' ? colors.primary[300] : colors.primary[700],
                      fontSize: 12
                    }}
                  >
                    {events.length} {events.length === 1 ? 'event' : 'events'}
                  </Tag>
                </div>
              ),
              children: (
                <div style={{ paddingLeft: isMobile ? 0 : spacing[8], paddingTop: spacing[3] }}>
                  {events.map(renderEventCard)}
                </div>
              ),
              style: {
                marginBottom: spacing[3],
                background: mode === 'dark' ? withAlpha(colors.neutral[800], 0.3) : withAlpha(colors.neutral[50], 0.8),
                borderRadius: token.borderRadiusLG,
                border: `1px solid ${mode === 'dark' ? withAlpha(colors.neutral[700], 0.3) : cssVar.border.default}`,
                padding: `${spacing[3]} ${spacing[4]}`
              }
            }))}
          />
        )}

        {/* Info Alert */}
        <Alert
          icon={<InfoCircleOutlined />}
          message="Event Types & Integrations"
          description="Event types represent different actions that occur in your source system. Global templates are read-only; create custom event types to match your own source system's schema."
          type="info"
          showIcon
          style={{
            marginTop: spacing[6],
            borderRadius: token.borderRadiusLG
          }}
        />
      </div>

      {/* Event Detail Drawer */}
      <EventDetailDrawer
        event={selectedEvent}
        open={drawerOpen}
        onClose={() => {
          setDrawerOpen(false);
          setSelectedEvent(null);
        }}
        onCreateIntegration={handleCreateIntegration}
      />

      {/* Add / Edit Event Type Modal */}
      <EventTypeEditorModal
        open={editorOpen}
        onClose={() => {
          setEditorOpen(false);
          setEditingEvent(null);
        }}
        existing={editingEvent}
        categories={categories}
      />
    </>
  );
};
