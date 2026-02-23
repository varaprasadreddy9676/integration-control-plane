import { useMemo, useState } from 'react';
import { App, Button, Dropdown, Modal, Select, Space, Tag, Typography, Card, Grid, Input, Switch, Checkbox, Upload, Alert } from 'antd';
import { FilterOutlined, PlusOutlined, MoreOutlined, ReloadOutlined, SearchOutlined, CloseCircleOutlined, DownloadOutlined, UploadOutlined, DeleteOutlined, CheckOutlined, StopOutlined, DatabaseOutlined, BookOutlined } from '@ant-design/icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigateWithParams } from '../../../utils/navigation';
import { StatusBadge } from '../../../components/common/StatusBadge';
import { ModernTable } from '../../../components/common/ModernTable';
import {
  getLookups,
  deleteLookup,
  bulkDeleteLookups,
  exportLookups,
  importLookups,
  downloadLookupTemplate,
  getLookupTypes,
  updateLookup
} from '../../../services/api';
import type { Lookup } from '../../../mocks/types';
import { formatDateTime } from '../../../utils/format';
import { useDesignTokens, withAlpha, spacingToNumber, cssVar } from '../../../design-system/utils';

export const LookupsRoute = () => {
  const navigate = useNavigateWithParams();
  const { spacing, token, shadows } = useDesignTokens();
  const colors = cssVar.legacy;
  const queryClient = useQueryClient();

  const { data: lookupsData, refetch, isLoading } = useQuery({
    queryKey: ['lookups'],
    queryFn: () => getLookups()
  });

  const { data: typesData } = useQuery({
    queryKey: ['lookup-types'],
    queryFn: getLookupTypes
  });

  const [typeFilter, setTypeFilter] = useState<string | undefined>();
  const [statusFilter, setStatusFilter] = useState<'active' | 'inactive' | undefined>();
  const [hierarchyFilter, setHierarchyFilter] = useState<'parent' | 'entity' | undefined>();
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);
  const { message: msgApi, modal } = App.useApp();
  const screens = Grid.useBreakpoint();
  const isNarrow = !screens.md;

  const lookups = lookupsData?.lookups || [];
  const types = typesData?.types || [];

  const filtered = useMemo(() => {
    return lookups.filter((item) => {
      // Filter by type
      if (typeFilter && item.type !== typeFilter) return false;

      // Filter by status
      if (statusFilter === 'active' && !item.isActive) return false;
      if (statusFilter === 'inactive' && item.isActive) return false;

      // Filter by hierarchy level
      if (hierarchyFilter === 'parent' && item.orgUnitRid !== null) return false;
      if (hierarchyFilter === 'entity' && item.orgUnitRid === null) return false;

      // Search across source, target, type
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        const matchesSource = item.source.id.toLowerCase().includes(query);
        const matchesTarget = item.target.id.toLowerCase().includes(query);
        const matchesType = item.type.toLowerCase().includes(query);
        const matchesSourceLabel = item.source.label?.toLowerCase().includes(query);
        const matchesTargetLabel = item.target.label?.toLowerCase().includes(query);

        if (!matchesSource && !matchesTarget && !matchesType && !matchesSourceLabel && !matchesTargetLabel) return false;
      }

      return true;
    });
  }, [lookups, typeFilter, statusFilter, hierarchyFilter, searchQuery]);

  const onDelete = async (record: Lookup) => {
    modal.confirm({
      title: `Delete this mapping?`,
      content: `This will remove the mapping from ${record.source.id} to ${record.target.id}. This action cannot be undone.`,
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await deleteLookup(record.id);
          msgApi.success('Mapping deleted');
          refetch();
          queryClient.invalidateQueries({ queryKey: ['lookup-types'] });
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Failed to delete mapping';
          msgApi.error(errorMessage);
        }
      }
    });
  };

  // Quick toggle active/inactive
  const onQuickToggle = async (record: Lookup, checked: boolean) => {
    try {
      await updateLookup(record.id, { ...record, isActive: checked });
      msgApi.success(checked ? 'Mapping activated' : 'Mapping deactivated');
      refetch();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to update mapping';
      msgApi.error(errorMessage);
    }
  };

  // Bulk delete
  const handleBulkDelete = async () => {
    if (selectedRowKeys.length === 0) {
      msgApi.warning('Please select at least one mapping');
      return;
    }

    modal.confirm({
      title: `Delete ${selectedRowKeys.length} mapping(s)?`,
      content: 'This action cannot be undone.',
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          const result = await bulkDeleteLookups(selectedRowKeys as string[]);
          msgApi.success(`Deleted ${result.deletedCount} mapping(s)`);
          setSelectedRowKeys([]);
          refetch();
          queryClient.invalidateQueries({ queryKey: ['lookup-types'] });
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Bulk delete failed';
          msgApi.error(errorMessage);
        }
      }
    });
  };

  // Export
  const handleExport = async () => {
    try {
      msgApi.loading('Exporting lookups...', 0);
      await exportLookups({
        type: typeFilter,
        isActive: statusFilter === 'active' ? true : statusFilter === 'inactive' ? false : undefined
      });
      msgApi.destroy();
      msgApi.success('Export completed');
    } catch (error) {
      msgApi.destroy();
      const errorMessage = error instanceof Error ? error.message : 'Export failed';
      msgApi.error(errorMessage);
    }
  };

  // Import
  const handleImport = async (file: File, type: string) => {
    try {
      const hide = msgApi.loading('Importing lookups...', 0);
      const result = await importLookups(file, { type });
      hide();

      modal.success({
        title: 'Import Complete',
        content: (
          <div>
            <p>Imported: {result.imported}</p>
            {result.updated > 0 && <p>Updated: {result.updated}</p>}
            {result.skipped > 0 && <p>Skipped: {result.skipped}</p>}
            {result.errors.length > 0 && (
              <div>
                <p style={{ color: colors.error[600], marginTop: 8 }}>Errors: {result.errors.length}</p>
                <div style={{ maxHeight: 200, overflow: 'auto', marginTop: 8 }}>
                  {result.errors.slice(0, 10).map((err, idx) => (
                    <div key={idx} style={{ fontSize: 12 }}>
                      Row {err.row}: {err.error}
                    </div>
                  ))}
                  {result.errors.length > 10 && <div style={{ fontSize: 12, marginTop: 4 }}>...and {result.errors.length - 10} more</div>}
                </div>
              </div>
            )}
          </div>
        )
      });

      refetch();
      queryClient.invalidateQueries({ queryKey: ['lookup-types'] });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Import failed';
      msgApi.error(errorMessage);
    }
  };

  const handleImportClick = () => {
    let selectedType = typeFilter || types[0] || '';

    modal.confirm({
      title: 'Import Lookups',
      content: (
        <div>
          <Typography.Paragraph>
            Select or type a lookup type and upload an Excel or CSV file with your mappings.
          </Typography.Paragraph>
          <Space direction="vertical" style={{ width: '100%' }}>
            <div>
              <Typography.Text strong>Lookup Type:</Typography.Text>
              <Select
                style={{ width: '100%', marginTop: 8 }}
                placeholder="Select existing or type new (e.g., SERVICE_CODE, DIAGNOSIS_CODE)"
                value={selectedType ? [selectedType] : undefined}
                onChange={(value) => {
                  selectedType = Array.isArray(value) ? value[0] : value;
                }}
                mode="tags"
                maxCount={1}
                tokenSeparators={[',']}
                options={types.map(t => ({ label: t, value: t }))}
                notFoundContent={
                  <Typography.Text type="secondary" style={{ padding: '8px', display: 'block', fontSize: 12 }}>
                    No existing types. Type to create a new one (e.g., SERVICE_CODE)
                  </Typography.Text>
                }
              />
            </div>
            <Upload
              accept=".xlsx,.xls,.csv"
              beforeUpload={(file) => {
                const typeValue = Array.isArray(selectedType) ? selectedType[0] : selectedType;
                if (!typeValue || typeValue.trim() === '') {
                  msgApi.error('Please select or enter a lookup type first');
                  return false;
                }
                handleImport(file, typeValue);
                return false;
              }}
              showUploadList={false}
            >
              <Button icon={<UploadOutlined />} block style={{ marginTop: 8 }}>
                Choose File
              </Button>
            </Upload>
            <Button
              type="link"
              size="small"
              onClick={() => {
                const typeValue = Array.isArray(selectedType) ? selectedType[0] : selectedType;
                if (typeValue && typeValue.trim() !== '') {
                  downloadLookupTemplate(typeValue);
                } else {
                  msgApi.warning('Please select or enter a lookup type first');
                }
              }}
            >
              Download Template
            </Button>
          </Space>
        </div>
      ),
      okText: 'Close',
      cancelButtonProps: { style: { display: 'none' } }
    });
  };

  const clearFilters = () => {
    setTypeFilter(undefined);
    setStatusFilter(undefined);
    setHierarchyFilter(undefined);
    setSearchQuery('');
  };

  const hasFilters = typeFilter || statusFilter || hierarchyFilter || searchQuery;

  const columns = [
    {
      title: 'Type',
      dataIndex: 'type',
      key: 'type',
      width: 150,
      render: (type: string) => (
        <Tag color="blue">{type}</Tag>
      ),
      sorter: (a: Lookup, b: Lookup) => a.type.localeCompare(b.type)
    },
    {
      title: 'Source Code',
      dataIndex: ['source', 'id'],
      key: 'sourceId',
      width: 180,
      render: (id: string, record: Lookup) => (
        <div>
          <Typography.Text strong>{id}</Typography.Text>
          {record.source.label && (
            <div style={{ fontSize: 12, color: cssVar.text.muted }}>
              {record.source.label}
            </div>
          )}
        </div>
      )
    },
    {
      title: 'Target Code',
      dataIndex: ['target', 'id'],
      key: 'targetId',
      width: 180,
      render: (id: string, record: Lookup) => (
        <div>
          <Typography.Text strong>{id}</Typography.Text>
          {record.target.label && (
            <div style={{ fontSize: 12, color: cssVar.text.muted }}>
              {record.target.label}
            </div>
          )}
        </div>
      )
    },
    {
      title: 'Level',
      dataIndex: 'orgUnitRid',
      key: 'level',
      width: 120,
      render: (orgUnitRid: number | null) => (
        <Tag color={orgUnitRid === null ? 'purple' : 'cyan'}>
          {orgUnitRid === null ? 'Parent' : 'Entity'}
        </Tag>
      ),
      sorter: (a: Lookup, b: Lookup) => {
        if (a.orgUnitRid === null && b.orgUnitRid !== null) return -1;
        if (a.orgUnitRid !== null && b.orgUnitRid === null) return 1;
        return 0;
      }
    },
    {
      title: 'Status',
      dataIndex: 'isActive',
      key: 'isActive',
      width: 100,
      render: (isActive: boolean, record: Lookup) => (
        <Switch
          checked={isActive}
          size="small"
          onChange={(checked) => onQuickToggle(record, checked)}
        />
      ),
      sorter: (a: Lookup, b: Lookup) => Number(b.isActive) - Number(a.isActive)
    },
    {
      title: 'Usage',
      dataIndex: 'usageCount',
      key: 'usageCount',
      width: 100,
      render: (count: number) => (
        <Typography.Text>{count.toLocaleString()}</Typography.Text>
      ),
      sorter: (a: Lookup, b: Lookup) => a.usageCount - b.usageCount
    },
    {
      title: 'Last Used',
      dataIndex: 'lastUsedAt',
      key: 'lastUsedAt',
      width: 160,
      render: (date: string | null) => (
        date ? formatDateTime(date) : <Typography.Text type="secondary">Never</Typography.Text>
      ),
      sorter: (a: Lookup, b: Lookup) => {
        if (!a.lastUsedAt) return 1;
        if (!b.lastUsedAt) return -1;
        return new Date(b.lastUsedAt).getTime() - new Date(a.lastUsedAt).getTime();
      }
    },
    {
      title: 'Created',
      dataIndex: 'createdAt',
      key: 'createdAt',
      width: 160,
      render: (date: string) => formatDateTime(date),
      sorter: (a: Lookup, b: Lookup) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    },
    {
      title: 'Actions',
      key: 'actions',
      width: 80,
      fixed: 'right' as const,
      render: (_: any, record: Lookup) => (
        <Dropdown
          menu={{
            items: [
              {
                key: 'edit',
                label: 'Edit',
                onClick: () => navigate(`/lookups/${record.id}`)
              },
              {
                key: 'delete',
                label: 'Delete',
                danger: true,
                onClick: () => onDelete(record)
              }
            ]
          }}
          trigger={['click']}
        >
          <Button type="text" size="small" icon={<MoreOutlined />} />
        </Dropdown>
      )
    }
  ];

  return (
    <div style={{ padding: isNarrow ? spacing[4] : spacing[6] }}>
      <Card
        variant="borderless"
        style={{
          background: cssVar.bg.surface,
          borderRadius: token.borderRadiusLG,
          boxShadow: shadows.sm
        }}
      >
        {/* Header */}
        <div style={{
          marginBottom: spacingToNumber(spacing[6]),
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: spacing[4]
        }}>
          <div style={{ flex: 1 }}>
            <Typography.Title level={3} style={{ margin: 0, display: 'flex', alignItems: 'center', gap: spacing[2] }}>
              <DatabaseOutlined style={{ color: colors.primary[600] }} />
              Lookup Tables
            </Typography.Title>
            <Typography.Text type="secondary">
              Manage code mappings between systems • <a onClick={() => navigate('/help/lookup-guide')} style={{ cursor: 'pointer' }}><BookOutlined /> View Guide</a>
            </Typography.Text>
          </div>
          <Space>
            <Button
              icon={<DownloadOutlined />}
              onClick={handleExport}
              disabled={lookups.length === 0}
            >
              Export
            </Button>
            <Button
              icon={<UploadOutlined />}
              onClick={handleImportClick}
            >
              Import
            </Button>
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => navigate('/lookups/new')}
            >
              New Mapping
            </Button>
          </Space>
        </div>

        {/* Filters */}
        <Space direction={isNarrow ? 'vertical' : 'horizontal'} style={{ width: '100%', marginBottom: spacing[4] }} wrap>
          <Input
            placeholder="Search source, target, or type..."
            prefix={<SearchOutlined />}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{ width: isNarrow ? '100%' : 300 }}
            allowClear
          />
          <Select
            placeholder="Filter by type"
            style={{ width: isNarrow ? '100%' : 200 }}
            value={typeFilter}
            onChange={setTypeFilter}
            allowClear
            options={types.map(t => ({ label: t, value: t }))}
          />
          <Select
            placeholder="Filter by status"
            style={{ width: isNarrow ? '100%' : 150 }}
            value={statusFilter}
            onChange={setStatusFilter}
            allowClear
            options={[
              { label: 'Active', value: 'active' },
              { label: 'Inactive', value: 'inactive' }
            ]}
          />
          <Select
            placeholder="Filter by level"
            style={{ width: isNarrow ? '100%' : 150 }}
            value={hierarchyFilter}
            onChange={setHierarchyFilter}
            allowClear
            options={[
              { label: 'Parent Level', value: 'parent' },
              { label: 'Entity Level', value: 'entity' }
            ]}
          />
          <Button
            icon={<ReloadOutlined />}
            onClick={() => refetch()}
          >
            Refresh
          </Button>
          {hasFilters && (
            <Button
              icon={<CloseCircleOutlined />}
              onClick={clearFilters}
            >
              Clear Filters
            </Button>
          )}
        </Space>

        {/* Bulk Actions */}
        {selectedRowKeys.length > 0 && (
          <div
            style={{
              marginBottom: spacing[4],
              padding: spacing[3],
              background: withAlpha(colors.primary[50], 0.5),
              borderRadius: token.borderRadius,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: spacing[2]
            }}
          >
            <Typography.Text>
              {selectedRowKeys.length} mapping(s) selected
            </Typography.Text>
            <Space>
              <Button
                danger
                icon={<DeleteOutlined />}
                onClick={handleBulkDelete}
              >
                Delete Selected
              </Button>
              <Button onClick={() => setSelectedRowKeys([])}>
                Clear Selection
              </Button>
            </Space>
          </div>
        )}

        {/* Stats */}
        <div style={{
          marginBottom: spacing[4],
          display: 'flex',
          gap: spacing[4],
          flexWrap: 'wrap'
        }}>
          <div>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>Total</Typography.Text>
            <Typography.Title level={4} style={{ margin: 0 }}>{lookups.length}</Typography.Title>
          </div>
          <div>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>Filtered</Typography.Text>
            <Typography.Title level={4} style={{ margin: 0 }}>{filtered.length}</Typography.Title>
          </div>
          <div>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>Active</Typography.Text>
            <Typography.Title level={4} style={{ margin: 0 }}>{lookups.filter(l => l.isActive).length}</Typography.Title>
          </div>
          <div>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>Types</Typography.Text>
            <Typography.Title level={4} style={{ margin: 0 }}>{types.length}</Typography.Title>
          </div>
        </div>

        {/* Table */}
        <ModernTable<Lookup>
          dataSource={filtered}
          columns={columns}
          rowKey="id"
          loading={isLoading}
          rowSelection={{
            selectedRowKeys,
            onChange: setSelectedRowKeys
          }}
          pagination={{
            pageSize: 50,
            showSizeChanger: true,
            showTotal: (total, range) => `${range[0]}-${range[1]} of ${total} mappings`
          }}
        />
      </Card>
    </div>
  );
};
