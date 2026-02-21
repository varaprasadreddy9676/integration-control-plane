/**
 * Flow Builder List Route
 *
 * Standalone list view for managing integrations via Flow Builder
 */

import React, { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Table,
  Button,
  Space,
  Tag,
  Input,
  Card,
  Dropdown,
  Typography,
  Tooltip,
  Alert,
  Empty,
} from 'antd';
import type { MenuProps, TableColumnsType } from 'antd';
import {
  PlusOutlined,
  SearchOutlined,
  EditOutlined,
  DeleteOutlined,
  EllipsisOutlined,
  BlockOutlined,
  ThunderboltOutlined,
  ClockCircleOutlined,
  ApiOutlined,
} from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { PageHeader } from '../../../components/common/PageHeader';
import { getAllIntegrations } from '../../../services/api';
import { cssVar } from '../../../design-system/utils';
import type { IntegrationMode } from '../state/flowTypes';

const { Text } = Typography;

interface IntegrationListItem {
  id: string;
  name: string;
  direction: 'INBOUND' | 'OUTBOUND';
  mode: IntegrationMode;
  isActive: boolean;
  orgId: number;
  targetUrl?: string;
  eventType?: string;
  deliveryMode?: 'IMMEDIATE' | 'SCHEDULED';
  updatedAt?: string;
}

export const FlowBuilderListRoute: React.FC = () => {
  const navigate = useNavigate();
  const [searchText, setSearchText] = useState('');
  const [selectedMode, setSelectedMode] = useState<'all' | IntegrationMode>('all');

  // Fetch all integrations
  const { data: integrations = [], isLoading } = useQuery({
    queryKey: ['integrations', 'flow-builder'],
    queryFn: async () => {
      const result = await getAllIntegrations();

      // Map to our interface
      return result.map((integration: any): IntegrationListItem => {
        const direction = integration.direction || 'OUTBOUND';
        const deliveryMode = integration.deliveryMode || 'IMMEDIATE';

        let mode: IntegrationMode;
        if (direction === 'INBOUND') {
          mode = 'INBOUND';
        } else if (deliveryMode === 'SCHEDULED') {
          mode = 'OUTBOUND_SCHEDULED';
        } else {
          mode = 'OUTBOUND_EVENT';
        }

        return {
          id: integration.id,
          name: integration.name,
          direction,
          mode,
          isActive: integration.isActive ?? true,
          orgId: integration.orgId || integration.tenantId || 100,
          targetUrl: integration.targetUrl,
          eventType: integration.eventType,
          deliveryMode: integration.deliveryMode,
          updatedAt: integration.updatedAt,
        };
      });
    },
  });

  // Filter integrations
  const filteredIntegrations = useMemo(() => {
    return integrations.filter((integration) => {
      const matchesSearch =
        searchText === '' ||
        integration.name.toLowerCase().includes(searchText.toLowerCase()) ||
        integration.targetUrl?.toLowerCase().includes(searchText.toLowerCase()) ||
        integration.eventType?.toLowerCase().includes(searchText.toLowerCase());

      const matchesMode = selectedMode === 'all' || integration.mode === selectedMode;

      return matchesSearch && matchesMode;
    });
  }, [integrations, searchText, selectedMode]);

  // Handle create new
  const handleCreateNew = (mode: IntegrationMode) => {
    navigate(`/flow-builder/new?mode=${mode}&orgId=100`);
  };

  // Handle edit
  const handleEdit = (integration: IntegrationListItem) => {
    navigate(`/flow-builder/${integration.id}?mode=${integration.mode}&orgId=${integration.orgId}`);
  };

  // Handle delete (TODO: implement)
  const handleDelete = (integration: IntegrationListItem) => {
    console.log('Delete integration:', integration);
    // TODO: Implement delete functionality
  };

  // Get mode color
  const getModeColor = (mode: IntegrationMode): string => {
    switch (mode) {
      case 'INBOUND':
        return 'blue';
      case 'OUTBOUND_EVENT':
        return 'green';
      case 'OUTBOUND_SCHEDULED':
        return 'orange';
      default:
        return 'default';
    }
  };

  // Get mode icon
  const getModeIcon = (mode: IntegrationMode) => {
    switch (mode) {
      case 'INBOUND':
        return <ApiOutlined />;
      case 'OUTBOUND_EVENT':
        return <ThunderboltOutlined />;
      case 'OUTBOUND_SCHEDULED':
        return <ClockCircleOutlined />;
      default:
        return <BlockOutlined />;
    }
  };

  // Table columns
  const columns: TableColumnsType<IntegrationListItem> = [
    {
      title: 'Name',
      dataIndex: 'name',
      key: 'name',
      width: '25%',
      render: (name: string, record: IntegrationListItem) => (
        <Space direction="vertical" size={0}>
          <Text strong>{name}</Text>
          {record.eventType && (
            <Text type="secondary" style={{ fontSize: '12px' }}>
              Event: {record.eventType}
            </Text>
          )}
        </Space>
      ),
    },
    {
      title: 'Mode',
      dataIndex: 'mode',
      key: 'mode',
      width: '20%',
      render: (mode: IntegrationMode) => (
        <Tag color={getModeColor(mode)} icon={getModeIcon(mode)}>
          {mode.replace('_', ' ')}
        </Tag>
      ),
      filters: [
        { text: 'Inbound', value: 'INBOUND' },
        { text: 'Outbound Event', value: 'OUTBOUND_EVENT' },
        { text: 'Outbound Scheduled', value: 'OUTBOUND_SCHEDULED' },
      ],
      onFilter: (value, record) => record.mode === value,
    },
    {
      title: 'Target URL',
      dataIndex: 'targetUrl',
      key: 'targetUrl',
      width: '30%',
      render: (url?: string) =>
        url ? (
          <Tooltip title={url}>
            <Text
              style={{
                maxWidth: '300px',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                display: 'block',
              }}
            >
              {url}
            </Text>
          </Tooltip>
        ) : (
          <Text type="secondary">-</Text>
        ),
    },
    {
      title: 'Status',
      dataIndex: 'isActive',
      key: 'isActive',
      width: '10%',
      render: (isActive: boolean) => (
        <Tag color={isActive ? 'success' : 'default'}>
          {isActive ? 'Active' : 'Inactive'}
        </Tag>
      ),
      filters: [
        { text: 'Active', value: true },
        { text: 'Inactive', value: false },
      ],
      onFilter: (value, record) => record.isActive === value,
    },
    {
      title: 'Org ID',
      dataIndex: 'orgId',
      key: 'orgId',
      width: '10%',
      render: (orgId: number) => <Text>{orgId}</Text>,
    },
    {
      title: 'Actions',
      key: 'actions',
      width: '15%',
      align: 'right',
      render: (_: any, record: IntegrationListItem) => {
        const menuItems: MenuProps['items'] = [
          {
            key: 'edit',
            label: 'Edit in Flow Builder',
            icon: <EditOutlined />,
            onClick: () => handleEdit(record),
          },
          {
            type: 'divider',
          },
          {
            key: 'delete',
            label: 'Delete',
            icon: <DeleteOutlined />,
            danger: true,
            onClick: () => handleDelete(record),
          },
        ];

        return (
          <Space size="small">
            <Button
              type="primary"
              size="small"
              icon={<BlockOutlined />}
              onClick={() => handleEdit(record)}
            >
              Edit Flow
            </Button>
            <Dropdown menu={{ items: menuItems }} trigger={['click']}>
              <Button size="small" icon={<EllipsisOutlined />} />
            </Dropdown>
          </Space>
        );
      },
    },
  ];

  // Create dropdown menu items
  const createMenuItems: MenuProps['items'] = [
    {
      key: 'inbound',
      label: 'Inbound Integration',
      icon: <ApiOutlined />,
      onClick: () => handleCreateNew('INBOUND'),
    },
    {
      key: 'outbound-event',
      label: 'Outbound Event Integration',
      icon: <ThunderboltOutlined />,
      onClick: () => handleCreateNew('OUTBOUND_EVENT'),
    },
    {
      key: 'outbound-scheduled',
      label: 'Outbound Scheduled Integration',
      icon: <ClockCircleOutlined />,
      onClick: () => handleCreateNew('OUTBOUND_SCHEDULED'),
    },
  ];

  return (
    <div style={{ minHeight: '100vh', background: cssVar.bg.base, paddingBottom: '32px' }}>
      {/* Page Header */}
      <PageHeader
        title="Flow Builder"
        description="Visual integration designer - Create and manage integrations using a drag-and-drop flow builder"
        breadcrumb={[
          { label: 'Configuration' },
          { label: 'Flow Builder' },
        ]}
        actions={
          <Dropdown menu={{ items: createMenuItems }} placement="bottomRight">
            <Button type="primary" size="large" icon={<PlusOutlined />}>
              Create New Integration
            </Button>
          </Dropdown>
        }
      />

      {/* Info Alert */}
      <Card style={{ margin: '24px' }}>
        <Alert
          type="info"
          showIcon
          message="Visual Flow Builder"
          description={
            <div>
              <p style={{ marginBottom: '8px' }}>
                The Flow Builder provides a visual drag-and-drop interface for creating and
                managing integrations. It supports all integration types:
              </p>
              <ul style={{ paddingLeft: '20px', marginBottom: 0 }}>
                <li>
                  <strong>Inbound:</strong> Real-time API proxy integrations
                </li>
                <li>
                  <strong>Outbound Event:</strong> Event-triggered delivery integrations
                </li>
                <li>
                  <strong>Outbound Scheduled:</strong> Scheduled/delayed delivery integrations
                </li>
              </ul>
            </div>
          }
        />
      </Card>

      {/* Filters */}
      <Card style={{ margin: '24px' }}>
        <Space direction="vertical" style={{ width: '100%' }} size="middle">
          <Space style={{ width: '100%', justifyContent: 'space-between' }}>
            <Input
              placeholder="Search integrations..."
              prefix={<SearchOutlined />}
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              style={{ width: '400px' }}
              allowClear
            />
            <Space>
              <Text type="secondary">Filter by mode:</Text>
              <Space.Compact>
                <Button
                  type={selectedMode === 'all' ? 'primary' : 'default'}
                  onClick={() => setSelectedMode('all')}
                >
                  All
                </Button>
                <Button
                  type={selectedMode === 'INBOUND' ? 'primary' : 'default'}
                  onClick={() => setSelectedMode('INBOUND')}
                  icon={<ApiOutlined />}
                >
                  Inbound
                </Button>
                <Button
                  type={selectedMode === 'OUTBOUND_EVENT' ? 'primary' : 'default'}
                  onClick={() => setSelectedMode('OUTBOUND_EVENT')}
                  icon={<ThunderboltOutlined />}
                >
                  Event
                </Button>
                <Button
                  type={selectedMode === 'OUTBOUND_SCHEDULED' ? 'primary' : 'default'}
                  onClick={() => setSelectedMode('OUTBOUND_SCHEDULED')}
                  icon={<ClockCircleOutlined />}
                >
                  Scheduled
                </Button>
              </Space.Compact>
            </Space>
          </Space>
        </Space>
      </Card>

      {/* Table */}
      <Card style={{ margin: '24px' }}>
        <Table
          columns={columns}
          dataSource={filteredIntegrations}
          rowKey="id"
          loading={isLoading}
          pagination={{
            pageSize: 20,
            showSizeChanger: true,
            showTotal: (total) => `Total ${total} integrations`,
          }}
          locale={{
            emptyText: (
              <Empty
                description={
                  searchText || selectedMode !== 'all'
                    ? 'No integrations match your filters'
                    : 'No integrations created yet'
                }
              >
                {!searchText && selectedMode === 'all' && (
                  <Dropdown menu={{ items: createMenuItems }} placement="bottomRight">
                    <Button type="primary" icon={<PlusOutlined />}>
                      Create Your First Integration
                    </Button>
                  </Dropdown>
                )}
              </Empty>
            ),
          }}
        />
      </Card>
    </div>
  );
};

export default FlowBuilderListRoute;
