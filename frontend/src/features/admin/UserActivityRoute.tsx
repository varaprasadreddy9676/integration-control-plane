import { useState } from 'react';
import {
  Card,
  Space,
  Typography,
  Table,
  Tag,
  DatePicker,
  Input,
  Select,
  Button,
  Statistic,
  Row,
  Col,
  Drawer,
  Descriptions,
  Empty
} from 'antd';
import {
  ClockCircleOutlined,
  UserOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  FilterOutlined,
  EyeOutlined,
  LineChartOutlined
} from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import dayjs, { Dayjs } from 'dayjs';
import {
  getUserActivities,
  getUserActivityStats,
  getActivityEvents,
  getActivityCategories,
  UserActivity,
  UserActivityStats
} from '../../services/api';
import { PageHeader } from '../../components/common/PageHeader';

const { Text, Title } = Typography;
const { RangePicker } = DatePicker;

export function UserActivityRoute() {
  const [dateRange, setDateRange] = useState<[Dayjs, Dayjs]>([
    dayjs().subtract(30, 'days'),
    dayjs()
  ]);
  const [searchText, setSearchText] = useState('');
  const [selectedEvent, setSelectedEvent] = useState<string | undefined>();
  const [selectedCategory, setSelectedCategory] = useState<string | undefined>();
  const [selectedUserId, setSelectedUserId] = useState<string | undefined>();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [selectedActivity, setSelectedActivity] = useState<UserActivity | null>(null);
  const [detailDrawerOpen, setDetailDrawerOpen] = useState(false);

  // Fetch activities
  const { data: activitiesData, isLoading: activitiesLoading } = useQuery({
    queryKey: [
      'user-activities',
      dateRange,
      searchText,
      selectedEvent,
      selectedCategory,
      selectedUserId,
      page,
      pageSize
    ],
    queryFn: async () => {
      return await getUserActivities({
        startDate: dateRange[0].toISOString(),
        endDate: dateRange[1].toISOString(),
        page,
        limit: pageSize,
        ...(searchText && { search: searchText }),
        ...(selectedEvent && { event: selectedEvent }),
        ...(selectedCategory && { category: selectedCategory }),
        ...(selectedUserId && { userId: selectedUserId })
      });
    }
  });

  // Fetch statistics
  const { data: statsData } = useQuery({
    queryKey: ['user-activity-stats', dateRange, selectedUserId],
    queryFn: async () => {
      return await getUserActivityStats({
        startDate: dateRange[0].toISOString(),
        endDate: dateRange[1].toISOString(),
        ...(selectedUserId && { userId: selectedUserId })
      });
    }
  });

  // Fetch available event types
  const { data: eventTypesData } = useQuery({
    queryKey: ['activity-events'],
    queryFn: getActivityEvents
  });

  // Fetch available categories
  const { data: categoriesData } = useQuery({
    queryKey: ['activity-categories'],
    queryFn: getActivityCategories
  });

  const activities: UserActivity[] = activitiesData?.activities || [];
  const total = activitiesData?.pagination?.total || 0;
  const stats: UserActivityStats | undefined = statsData;

  const handleViewDetails = (activity: UserActivity) => {
    setSelectedActivity(activity);
    setDetailDrawerOpen(true);
  };

  const getCategoryColor = (category: string): string => {
    const colors: Record<string, string> = {
      authentication: 'green',
      navigation: 'blue',
      feature_usage: 'purple',
      data_operation: 'orange',
      administration: 'red',
      error: 'volcano'
    };
    return colors[category] || 'default';
  };

  const columns = [
    {
      title: 'Timestamp',
      dataIndex: 'timestamp',
      key: 'timestamp',
      width: 180,
      render: (timestamp: string) => (
        <Space direction="vertical" size={0}>
          <Text>{dayjs(timestamp).format('MMM DD, YYYY')}</Text>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {dayjs(timestamp).format('HH:mm:ss')}
          </Text>
        </Space>
      )
    },
    {
      title: 'User',
      key: 'user',
      width: 200,
      render: (record: UserActivity) => (
        <Space direction="vertical" size={0}>
          <Text strong>{record.userEmail}</Text>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {record.userRole}
          </Text>
        </Space>
      )
    },
    {
      title: 'Event',
      dataIndex: 'event',
      key: 'event',
      width: 200,
      render: (event: string, record: UserActivity) => (
        <Space direction="vertical" size={0}>
          <Text>{event}</Text>
          <Tag color={getCategoryColor(record.category)} style={{ fontSize: 11 }}>
            {record.category}
          </Tag>
        </Space>
      )
    },
    {
      title: 'Page/Feature',
      key: 'location',
      width: 200,
      render: (record: UserActivity) => (
        <Space direction="vertical" size={0}>
          {record.page && <Text>{record.page}</Text>}
          {record.feature && (
            <Text type="secondary" style={{ fontSize: 12 }}>
              {record.feature}
            </Text>
          )}
          {!record.page && !record.feature && <Text type="secondary">-</Text>}
        </Space>
      )
    },
    {
      title: 'Action',
      dataIndex: 'action',
      key: 'action',
      width: 150,
      render: (action: string | null) => action || <Text type="secondary">-</Text>
    },
    {
      title: 'Status',
      dataIndex: 'success',
      key: 'success',
      width: 100,
      render: (success: boolean) =>
        success ? (
          <Tag icon={<CheckCircleOutlined />} color="success">
            Success
          </Tag>
        ) : (
          <Tag icon={<CloseCircleOutlined />} color="error">
            Failed
          </Tag>
        )
    },
    {
      title: 'Duration',
      dataIndex: 'duration',
      key: 'duration',
      width: 100,
      render: (duration: number | null) =>
        duration ? <Text>{duration}ms</Text> : <Text type="secondary">-</Text>
    },
    {
      title: 'Actions',
      key: 'actions',
      width: 100,
      fixed: 'right' as const,
      render: (record: UserActivity) => (
        <Button
          type="link"
          icon={<EyeOutlined />}
          onClick={() => handleViewDetails(record)}
        >
          Details
        </Button>
      )
    }
  ];

  return (
    <div>
      <PageHeader
        title="User Activity Timeline"
        description="Comprehensive tracking of all user interactions and events"
      />

      {/* Statistics Cards */}
      {stats && (
        <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
          <Col xs={24} sm={12} md={6}>
            <Card>
              <Statistic
                title="Total Activities"
                value={stats.totalActivities}
                prefix={<ClockCircleOutlined />}
              />
            </Card>
          </Col>
          <Col xs={24} sm={12} md={6}>
            <Card>
              <Statistic
                title="Unique Users"
                value={stats.uniqueUsers}
                prefix={<UserOutlined />}
              />
            </Card>
          </Col>
          <Col xs={24} sm={12} md={6}>
            <Card>
              <Statistic
                title="Top Event"
                value={stats.eventsByType[0]?.event || 'N/A'}
                valueStyle={{ fontSize: 16 }}
              />
              <Text type="secondary" style={{ fontSize: 12 }}>
                {stats.eventsByType[0]?.count || 0} occurrences
              </Text>
            </Card>
          </Col>
          <Col xs={24} sm={12} md={6}>
            <Card>
              <Statistic
                title="Top Category"
                value={stats.activitiesByCategory[0]?.category || 'N/A'}
                valueStyle={{ fontSize: 16 }}
              />
              <Text type="secondary" style={{ fontSize: 12 }}>
                {stats.activitiesByCategory[0]?.count || 0} activities
              </Text>
            </Card>
          </Col>
        </Row>
      )}

      {/* Filters */}
      <Card style={{ marginBottom: 16 }}>
        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
          <Row gutter={[16, 16]}>
            <Col xs={24} md={12}>
              <Space.Compact style={{ width: '100%' }}>
                <Input
                  placeholder="Search by user email, event, page, or feature..."
                  prefix={<FilterOutlined />}
                  value={searchText}
                  onChange={(e) => setSearchText(e.target.value)}
                  allowClear
                  style={{ width: '100%' }}
                />
              </Space.Compact>
            </Col>
            <Col xs={24} md={12}>
              <RangePicker
                value={dateRange}
                onChange={(dates) => {
                  if (dates && dates[0] && dates[1]) {
                    setDateRange([dates[0], dates[1]]);
                  }
                }}
                style={{ width: '100%' }}
                format="MMM DD, YYYY"
              />
            </Col>
          </Row>

          <Row gutter={[16, 16]}>
            <Col xs={24} sm={8}>
              <Select
                placeholder="Filter by event type"
                value={selectedEvent}
                onChange={setSelectedEvent}
                allowClear
                style={{ width: '100%' }}
                options={eventTypesData?.events?.map((event: string) => ({
                  label: event,
                  value: event
                }))}
              />
            </Col>
            <Col xs={24} sm={8}>
              <Select
                placeholder="Filter by category"
                value={selectedCategory}
                onChange={setSelectedCategory}
                allowClear
                style={{ width: '100%' }}
                options={categoriesData?.categories?.map((category: string) => ({
                  label: category,
                  value: category
                }))}
              />
            </Col>
          </Row>

          {/* Active Filters */}
          {(searchText || selectedEvent || selectedCategory) && (
            <Space wrap>
              <Text type="secondary">Active Filters:</Text>
              {searchText && <Tag closable onClose={() => setSearchText('')}>Search: {searchText}</Tag>}
              {selectedEvent && (
                <Tag closable onClose={() => setSelectedEvent(undefined)}>
                  Event: {selectedEvent}
                </Tag>
              )}
              {selectedCategory && (
                <Tag closable onClose={() => setSelectedCategory(undefined)}>
                  Category: {selectedCategory}
                </Tag>
              )}
              <Button
                type="link"
                size="small"
                onClick={() => {
                  setSearchText('');
                  setSelectedEvent(undefined);
                  setSelectedCategory(undefined);
                }}
              >
                Clear All
              </Button>
            </Space>
          )}
        </Space>
      </Card>

      {/* Activity Table */}
      <Card>
        <Table
          columns={columns}
          dataSource={activities}
          rowKey="_id"
          loading={activitiesLoading}
          pagination={{
            current: page,
            pageSize,
            total,
            onChange: (newPage, newPageSize) => {
              setPage(newPage);
              setPageSize(newPageSize);
            },
            showSizeChanger: true,
            showTotal: (total) => `Total ${total} activities`,
            pageSizeOptions: ['25', '50', '100', '200']
          }}
          scroll={{ x: 1200 }}
          locale={{
            emptyText: (
              <Empty
                description="No activities found"
                image={Empty.PRESENTED_IMAGE_SIMPLE}
              />
            )
          }}
        />
      </Card>

      {/* Detail Drawer */}
      <Drawer
        title="Activity Details"
        placement="right"
        width={600}
        open={detailDrawerOpen}
        onClose={() => setDetailDrawerOpen(false)}
      >
        {selectedActivity && (
          <Space direction="vertical" size="large" style={{ width: '100%' }}>
            <Card title="Event Information" size="small">
              <Descriptions column={1} size="small">
                <Descriptions.Item label="Event">{selectedActivity.event}</Descriptions.Item>
                <Descriptions.Item label="Category">
                  <Tag color={getCategoryColor(selectedActivity.category)}>
                    {selectedActivity.category}
                  </Tag>
                </Descriptions.Item>
                <Descriptions.Item label="Timestamp">
                  {dayjs(selectedActivity.timestamp).format('MMM DD, YYYY HH:mm:ss')}
                </Descriptions.Item>
                <Descriptions.Item label="Status">
                  {selectedActivity.success ? (
                    <Tag icon={<CheckCircleOutlined />} color="success">
                      Success
                    </Tag>
                  ) : (
                    <Tag icon={<CloseCircleOutlined />} color="error">
                      Failed
                    </Tag>
                  )}
                </Descriptions.Item>
                {selectedActivity.errorMessage && (
                  <Descriptions.Item label="Error">{selectedActivity.errorMessage}</Descriptions.Item>
                )}
              </Descriptions>
            </Card>

            <Card title="User Information" size="small">
              <Descriptions column={1} size="small">
                <Descriptions.Item label="Email">{selectedActivity.userEmail}</Descriptions.Item>
                <Descriptions.Item label="Role">{selectedActivity.userRole}</Descriptions.Item>
                <Descriptions.Item label="User ID">{selectedActivity.userId}</Descriptions.Item>
                <Descriptions.Item label="Organization ID">{selectedActivity.orgId}</Descriptions.Item>
              </Descriptions>
            </Card>

            <Card title="Location & Context" size="small">
              <Descriptions column={1} size="small">
                <Descriptions.Item label="Page">{selectedActivity.page || '-'}</Descriptions.Item>
                <Descriptions.Item label="Feature">{selectedActivity.feature || '-'}</Descriptions.Item>
                <Descriptions.Item label="Action">{selectedActivity.action || '-'}</Descriptions.Item>
                {selectedActivity.duration && (
                  <Descriptions.Item label="Duration">{selectedActivity.duration}ms</Descriptions.Item>
                )}
                <Descriptions.Item label="Session ID">
                  {selectedActivity.sessionId || '-'}
                </Descriptions.Item>
              </Descriptions>
            </Card>

            <Card title="Technical Details" size="small">
              <Descriptions column={1} size="small">
                <Descriptions.Item label="IP Address">
                  {selectedActivity.ipAddress || '-'}
                </Descriptions.Item>
                <Descriptions.Item label="User Agent">
                  <Text ellipsis style={{ maxWidth: 400 }}>
                    {selectedActivity.userAgent || '-'}
                  </Text>
                </Descriptions.Item>
              </Descriptions>
            </Card>

            {selectedActivity.changes && (
              <Card title="Changes" size="small">
                <Space direction="vertical" style={{ width: '100%' }}>
                  {selectedActivity.changes.before && (
                    <div>
                      <Text strong>Before:</Text>
                      <pre style={{ marginTop: 8, fontSize: 12 }}>
                        {JSON.stringify(selectedActivity.changes.before, null, 2)}
                      </pre>
                    </div>
                  )}
                  {selectedActivity.changes.after && (
                    <div>
                      <Text strong>After:</Text>
                      <pre style={{ marginTop: 8, fontSize: 12 }}>
                        {JSON.stringify(selectedActivity.changes.after, null, 2)}
                      </pre>
                    </div>
                  )}
                </Space>
              </Card>
            )}

            {selectedActivity.metadata && Object.keys(selectedActivity.metadata).length > 0 && (
              <Card title="Metadata" size="small">
                <pre style={{ fontSize: 12 }}>
                  {JSON.stringify(selectedActivity.metadata, null, 2)}
                </pre>
              </Card>
            )}

            {selectedActivity.target && (
              <Card title="Target" size="small">
                <pre style={{ fontSize: 12 }}>
                  {JSON.stringify(selectedActivity.target, null, 2)}
                </pre>
              </Card>
            )}
          </Space>
        )}
      </Drawer>
    </div>
  );
}
