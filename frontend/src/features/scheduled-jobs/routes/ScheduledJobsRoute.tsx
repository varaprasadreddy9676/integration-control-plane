import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Card,
  Space,
  Button,
  Tag,
  Tooltip,
  Badge,
  message,
  Modal,
  Typography,
  Input,
  Select,
  Divider,
  Grid
} from 'antd';
import {
  ClockCircleOutlined,
  PlayCircleOutlined,
  EditOutlined,
  DeleteOutlined,
  PlusOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  SyncOutlined,
  SearchOutlined,
  ReloadOutlined,
  FilterOutlined
} from '@ant-design/icons';
import { ModernTable } from '../../../components/common/ModernTable';
import { PageHeader } from '../../../components/common/PageHeader';
import { cssVar, useDesignTokens, withAlpha } from '../../../design-system/utils';
import {
  getAllScheduledJobs,
  deleteScheduledJob,
  executeScheduledJob
} from '../../../services/api';
import { formatDateTime, formatDuration } from '../../../utils/format';

const { Text } = Typography;

interface ScheduledJobsRouteProps {
  hideHeader?: boolean;
  isActive?: boolean;
}

export const ScheduledJobsRoute = ({ hideHeader = false, isActive = true }: ScheduledJobsRouteProps = {}) => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const { spacing, token } = useDesignTokens();
  const colors = cssVar.legacy;
  const screens = Grid.useBreakpoint();
  const isNarrow = !screens.md;
  const orgId = searchParams.get('orgId');

  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'active' | 'paused' | undefined>();

  // Fetch scheduled jobs
  const { data: jobs = [], isLoading } = useQuery({
    queryKey: ['scheduled-jobs', orgId],
    queryFn: () => getAllScheduledJobs(orgId!),
    enabled: isActive
  });

  // Filter jobs
  const filteredJobs = useMemo(() => {
    let filtered = jobs;

    // Apply status filter
    if (statusFilter === 'active') {
      filtered = filtered.filter((job: any) => job.isActive);
    } else if (statusFilter === 'paused') {
      filtered = filtered.filter((job: any) => !job.isActive);
    }

    // Apply search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter((job: any) =>
        job.name.toLowerCase().includes(query) ||
        job.type?.toLowerCase().includes(query) ||
        job.targetUrl?.toLowerCase().includes(query)
      );
    }

    return filtered;
  }, [jobs, searchQuery, statusFilter]);

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: (jobId: string) => deleteScheduledJob(jobId, orgId!),
    onSuccess: () => {
      message.success('Scheduled job deleted successfully');
      queryClient.invalidateQueries({ queryKey: ['scheduled-jobs'] });
      setSelectedJobId(null);
    },
    onError: () => {
      message.error('Failed to delete scheduled job');
    }
  });

  // Execute mutation
  const executeMutation = useMutation({
    mutationFn: (jobId: string) => executeScheduledJob(jobId, orgId!),
    onSuccess: () => {
      message.success('Job execution triggered');
      queryClient.invalidateQueries({ queryKey: ['scheduled-jobs'] });
    },
    onError: () => {
      message.error('Failed to trigger job execution');
    }
  });

  const handleDelete = (jobId: string) => {
    Modal.confirm({
      title: 'Delete Scheduled Job',
      content: 'Are you sure you want to delete this scheduled job? This action cannot be undone.',
      okText: 'Delete',
      okType: 'danger',
      onOk: () => deleteMutation.mutate(jobId)
    });
  };

  const handleExecute = (jobId: string) => {
    executeMutation.mutate(jobId);
  };

  const columns = [
    {
      title: 'Job Name',
      dataIndex: 'name',
      key: 'name',
      sorter: (a: any, b: any) => a.name.localeCompare(b.name),
      render: (name: string, record: any) => (
        <Space direction="vertical" size="small">
          <Text strong style={{ fontSize: 14 }}>
            {name}
          </Text>
          {record.type && (
            <Tag style={{ fontSize: 11 }}>{record.type}</Tag>
          )}
        </Space>
      )
    },
    {
      title: 'Schedule',
      dataIndex: 'schedule',
      key: 'schedule',
      render: (schedule: any) => (
        <Space direction="vertical" size="small">
          <div style={{ display: 'flex', alignItems: 'center', gap: spacing[1] }}>
            <ClockCircleOutlined style={{ color: colors.primary[500] }} />
            <Text style={{ fontSize: 13, fontFamily: 'monospace' }}>
              {schedule.type === 'CRON'
                ? schedule.expression
                : `Every ${schedule.intervalMs / 1000}s`}
            </Text>
          </div>
          {schedule.timezone && (
            <Text type="secondary" style={{ fontSize: 11 }}>
              {schedule.timezone}
            </Text>
          )}
        </Space>
      )
    },
    {
      title: 'Data Source',
      dataIndex: 'dataSource',
      key: 'dataSource',
      render: (dataSource: any) => (
        <Tag color={
          dataSource.type === 'SQL' ? 'blue' :
            dataSource.type === 'MONGODB' ? 'green' :
              'purple'
        }>
          {dataSource.type}
        </Tag>
      )
    },
    {
      title: 'Target',
      dataIndex: 'targetUrl',
      key: 'targetUrl',
      ellipsis: true,
      render: (url: string) => (
        <Tooltip title={url}>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {url}
          </Text>
        </Tooltip>
      )
    },
    {
      title: 'Last Execution',
      dataIndex: 'lastExecution',
      key: 'lastExecution',
      sorter: (a: any, b: any) => {
        const aTime = a.lastExecution?.startedAt ? new Date(a.lastExecution.startedAt).getTime() : 0;
        const bTime = b.lastExecution?.startedAt ? new Date(b.lastExecution.startedAt).getTime() : 0;
        return aTime - bTime;
      },
      render: (lastExecution: any) => {
        if (!lastExecution) {
          return (
            <Text type="secondary" style={{ fontSize: 12 }}>
              Never executed
            </Text>
          );
        }

        const statusIcon = lastExecution.status === 'SUCCESS'
          ? <CheckCircleOutlined style={{ color: colors.success[500] }} />
          : lastExecution.status === 'FAILED'
            ? <CloseCircleOutlined style={{ color: colors.error[500] }} />
            : <SyncOutlined spin style={{ color: colors.primary[500] }} />;

        return (
          <Space direction="vertical" size="small">
            <div style={{ display: 'flex', alignItems: 'center', gap: spacing[1] }}>
              {statusIcon}
              <Badge
                status={lastExecution.status === 'SUCCESS' ? 'success' : 'error'}
                text={
                  <Text style={{ fontSize: 12 }}>
                    {formatDateTime(lastExecution.startedAt)}
                  </Text>
                }
              />
            </div>
            {lastExecution.recordsFetched !== undefined && (
              <Text type="secondary" style={{ fontSize: 11 }}>
                {lastExecution.recordsFetched} records • {formatDuration(lastExecution.durationMs)}
              </Text>
            )}
          </Space>
        );
      }
    },
    {
      title: 'Status',
      dataIndex: 'isActive',
      key: 'isActive',
      filters: [
        { text: 'Active', value: true },
        { text: 'Paused', value: false }
      ],
      onFilter: (value: any, record: any) => record.isActive === value,
      render: (isActive: boolean) => (
        <Tag color={isActive ? 'success' : 'default'}>
          {isActive ? 'Active' : 'Paused'}
        </Tag>
      )
    },
    {
      title: 'Actions',
      key: 'actions',
      width: 180,
      render: (_: any, record: any) => (
        <Space size="small">
          <Tooltip title="View/Edit">
            <Button
              type="text"
              size="small"
              icon={<EditOutlined />}
              onClick={() => navigate(`/scheduled-jobs/${record._id}`)}
            />
          </Tooltip>
          <Tooltip title="Execute Now">
            <Button
              type="text"
              size="small"
              icon={<PlayCircleOutlined />}
              onClick={() => handleExecute(record._id)}
              loading={executeMutation.isPending && selectedJobId === record._id}
              disabled={!record.isActive}
            />
          </Tooltip>
          <Tooltip title="Delete">
            <Button
              type="text"
              size="small"
              danger
              icon={<DeleteOutlined />}
              onClick={() => {
                setSelectedJobId(record._id);
                handleDelete(record._id);
              }}
              loading={deleteMutation.isPending && selectedJobId === record._id}
            />
          </Tooltip>
        </Space>
      )
    }
  ];

  return (
    <div>
      {!hideHeader && (
        <PageHeader
          title="Scheduled Jobs"
          description="Time-driven batch integrations that run on cron schedules or intervals"
          breadcrumb={[
            { label: 'Configuration', path: '/integrations' },
            { label: 'Scheduled Jobs' }
          ]}
          compact
          actions={
            <Button
              type="primary"
              size="middle"
              icon={<PlusOutlined />}
              onClick={() => navigate(`/scheduled-jobs/new?orgId=${orgId}`)}
            >
              Create Scheduled Job
            </Button>
          }
        />
      )}

      <Card style={{ marginTop: hideHeader ? 0 : spacing[2] }} size="small">
        {/* Compact Toolbar */}
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: spacing[2],
            padding: spacing[2],
            borderBottom: `1px solid ${cssVar.border.default}`,
            background: withAlpha(cssVar.bg.subtle, 0.4),
            alignItems: 'center'
          }}
        >
          {/* Count Tags */}
          <Space size="small">
            <Tag
              style={{
                borderRadius: 4,
                padding: `2px ${spacing[2]}`,
                borderColor: cssVar.border.default,
                background: cssVar.bg.elevated,
                color: cssVar.text.secondary,
                fontWeight: 600,
                fontSize: 12,
                margin: 0
              }}
            >
              {`${jobs.length} total`}
            </Tag>
            <Tag
              style={{
                borderRadius: 4,
                padding: `2px ${spacing[2]}`,
                borderColor: cssVar.success.border,
                background: cssVar.success.bg,
                color: cssVar.success.text,
                fontWeight: 600,
                fontSize: 12,
                margin: 0
              }}
            >
              {jobs.filter((j: any) => j.isActive).length} active
            </Tag>
          </Space>

          <Divider type="vertical" style={{ height: 24, margin: 0 }} />

          {/* Search */}
          <Input
            placeholder="Search..."
            prefix={<SearchOutlined />}
            suffix={
              searchQuery ? (
                <CloseCircleOutlined
                  onClick={() => setSearchQuery('')}
                  style={{ cursor: 'pointer', color: token.colorTextSecondary }}
                />
              ) : null
            }
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{ width: isNarrow ? '100%' : 200 }}
            size="small"
            allowClear
          />

          {/* Status Filter */}
          <Select
            placeholder="Status"
            value={statusFilter}
            onChange={setStatusFilter}
            style={{ width: 110 }}
            size="small"
            allowClear
            options={[
              { label: 'Active', value: 'active' },
              { label: 'Paused', value: 'paused' }
            ]}
          />

          {/* Actions */}
          <div style={{ marginLeft: 'auto', display: 'flex', gap: spacing[1] }}>
            <Button
              icon={<FilterOutlined />}
              size="small"
              type="text"
              onClick={() => {
                setSearchQuery('');
                setStatusFilter(undefined);
              }}
            >
              Reset
            </Button>
            <Button
              icon={<ReloadOutlined />}
              size="small"
              onClick={() => queryClient.invalidateQueries({ queryKey: ['scheduled-jobs'] })}
            />
          </div>
        </div>

        <ModernTable
          columns={columns}
          dataSource={filteredJobs}
          loading={isLoading}
          rowKey="_id"
          pagination={{
            pageSize: 20,
            showSizeChanger: true,
            showTotal: (total) => `${total} scheduled jobs`,
            pageSizeOptions: ['10', '20', '50', '100']
          }}
          emptyState={{
            icon: <ClockCircleOutlined style={{ fontSize: 64, color: cssVar.text.muted }} />,
            title: 'No scheduled jobs yet',
            description: 'Create your first scheduled job to start running batch integrations on a schedule',
            action: (
              <Button
                type="primary"
                icon={<PlusOutlined />}
                onClick={() => navigate(`/scheduled-jobs/new`)}
              >
                Create Scheduled Job
              </Button>
            )
          }}
        />
      </Card>
    </div>
  );
};
