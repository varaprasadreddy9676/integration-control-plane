import { useEffect, useMemo, useState } from 'react';
import { Button, Card, Col, Input, InputNumber, Modal, Row, Space, Table, Typography, message, Tag } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { PageHeader } from '../../components/common/PageHeader';
import { useAuth } from '../../app/auth-context';
import { useDesignTokens, spacingToNumber } from '../../design-system/utils';
import {
  AdminOrgSummary,
  AdminOrgUnit,
  createAdminOrg,
  createAdminOrgUnit,
  deleteAdminOrg,
  deleteAdminOrgUnit,
  listAdminOrgSummaries,
  listAdminOrgUnits,
  updateAdminOrg,
  updateAdminOrgUnit,
  createPortalSession
} from '../../services/api';

const OrgUnitsInline = ({
  orgId,
  token,
  onEditUnit,
  onCreateUnit,
  messageApi
}: {
  orgId: number;
  token: any;
  onEditUnit: (unit: AdminOrgUnit) => void;
  onCreateUnit: (orgId: number) => void;
  messageApi: any;
}) => {
  const { data: units = [], isLoading, refetch } = useQuery({
    queryKey: ['adminOrgUnits', orgId],
    queryFn: () => listAdminOrgUnits(orgId),
    staleTime: 10 * 1000
  });

  const columns = [
    {
      title: 'RID',
      dataIndex: 'rid',
      key: 'rid',
      width: 90,
      render: (value: number) => <Typography.Text style={{ fontFamily: token.fontFamilyCode }}>{value}</Typography.Text>
    },
    { title: 'Name', dataIndex: 'name', key: 'name', render: (value: string) => value || '—' },
    { title: 'Code', dataIndex: 'code', key: 'code', render: (value: string) => value || '—' },
    { title: 'Phone', dataIndex: 'phone', key: 'phone', render: (value: string) => value || '—' },
    {
      title: 'Tags',
      dataIndex: 'tags',
      key: 'tags',
      render: (value: string[] | null | undefined) => (
        <Space size={4} wrap>
          {(value || []).length === 0 ? '—' : (value || []).map((tag) => <Tag key={tag}>{tag}</Tag>)}
        </Space>
      )
    },
    {
      title: 'Actions',
      key: 'actions',
      width: 160,
      render: (_: any, record: AdminOrgUnit) => (
        <Space>
          <Button size="small" onClick={() => onEditUnit(record)}>Edit</Button>
          <Button
            size="small"
            danger
            onClick={() => {
              Modal.confirm({
                title: 'Delete org unit?',
                content: `Remove unit ${record.rid} from org ${record.orgId}.`,
                okText: 'Delete',
                okButtonProps: { danger: true },
                cancelText: 'Cancel',
                onOk: async () => {
                  await deleteAdminOrgUnit(record.orgId, record.rid);
                  await refetch();
                  messageApi.success(`Deleted unit ${record.rid}`);
                }
              });
            }}
          >
            Delete
          </Button>
        </Space>
      )
    }
  ];

  return (
    <Card size="small" style={{ margin: 0 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <Typography.Text type="secondary">Units ({units.length})</Typography.Text>
        <Button size="small" type="primary" onClick={() => onCreateUnit(orgId)}>Create Unit</Button>
      </div>
      <Table
        dataSource={units}
        columns={columns}
        rowKey={(row) => `${row.orgId}-${row.rid}`}
        pagination={false}
        loading={isLoading}
        size="small"
      />
    </Card>
  );
};

export const OrgDirectoryRoute = () => {
  const { user } = useAuth();
  const isAdmin = user?.role === 'SUPER_ADMIN' || user?.role === 'ADMIN';
  const { spacing, token } = useDesignTokens();
  const [messageApi, contextHolder] = message.useMessage();

  const [orgForm, setOrgForm] = useState({
    orgId: undefined as number | undefined,
    name: '',
    code: '',
    email: '',
    phone: '',
    address: '',
    tags: '',
    region: '',
    timezone: ''
  });
  const [orgSaving, setOrgSaving] = useState(false);
  const [editingOrg, setEditingOrg] = useState<AdminOrgSummary | null>(null);
  const [orgEditDraft, setOrgEditDraft] = useState({
    name: '',
    code: '',
    email: '',
    phone: '',
    address: '',
    tags: '',
    region: '',
    timezone: ''
  });
  const [orgEditSaving, setOrgEditSaving] = useState(false);

  const [orgUnitsOrg, setOrgUnitsOrg] = useState<AdminOrgSummary | null>(null);
  const [orgUnitsVisible, setOrgUnitsVisible] = useState(false);
  const [unitForm, setUnitForm] = useState({
    rid: undefined as number | undefined,
    name: '',
    code: '',
    email: '',
    phone: '',
    address: '',
    tags: '',
    region: '',
    timezone: ''
  });
  const [unitSaving, setUnitSaving] = useState(false);
  const [editingUnit, setEditingUnit] = useState<AdminOrgUnit | null>(null);
  const [unitEditDraft, setUnitEditDraft] = useState({
    name: '',
    code: '',
    email: '',
    phone: '',
    address: '',
    tags: '',
    region: '',
    timezone: ''
  });
  const [unitEditSaving, setUnitEditSaving] = useState(false);
  const [orgTagFilter, setOrgTagFilter] = useState('');
  const [unitTagFilter, setUnitTagFilter] = useState('');
  const [orgPhoneError, setOrgPhoneError] = useState('');
  const [orgEditPhoneError, setOrgEditPhoneError] = useState('');
  const [unitPhoneError, setUnitPhoneError] = useState('');
  const [unitEditPhoneError, setUnitEditPhoneError] = useState('');
  const [createOrgVisible, setCreateOrgVisible] = useState(false);
  const [createUnitVisible, setCreateUnitVisible] = useState(false);
  const [portalLink, setPortalLink] = useState<{ url: string; orgId: number } | null>(null);
  const [generatingPortal, setGeneratingPortal] = useState(false);

  const parseTags = (value: string) => {
    const tokens = value.split(',').map((tag) => tag.trim()).filter(Boolean);
    const seen = new Set<string>();
    return tokens.filter((tag) => {
      const key = tag.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  };

  const phoneRegex = /^[+]?[\d\s().-]{6,20}$/;
  const validatePhone = (value: string) => {
    const normalized = value.trim();
    if (!normalized) return '';
    return phoneRegex.test(normalized) ? '' : 'Invalid phone format';
  };

  useEffect(() => {
    const saved = localStorage.getItem('orgDirectory.filters');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (typeof parsed.orgTags === 'string') setOrgTagFilter(parsed.orgTags);
        if (typeof parsed.unitTags === 'string') setUnitTagFilter(parsed.unitTags);
      } catch {
        // Ignore malformed storage
      }
    }
  }, []);

  useEffect(() => {
    const payload = JSON.stringify({ orgTags: orgTagFilter, unitTags: unitTagFilter });
    localStorage.setItem('orgDirectory.filters', payload);
  }, [orgTagFilter, unitTagFilter]);

  const { data: adminOrgs = [], refetch: refetchAdminOrgs, isLoading: adminOrgsLoading } = useQuery({
    queryKey: ['adminOrgsSummary'],
    queryFn: listAdminOrgSummaries,
    enabled: isAdmin,
    staleTime: 30 * 1000
  });

  const orgUnitsOrgId = orgUnitsOrg?.orgId;
  const { data: adminOrgUnits = [], isLoading: adminOrgUnitsLoading, refetch: refetchAdminOrgUnits } = useQuery({
    queryKey: ['adminOrgUnits', orgUnitsOrgId],
    queryFn: () => listAdminOrgUnits(orgUnitsOrgId as number),
    enabled: isAdmin && !!orgUnitsOrgId,
    staleTime: 10 * 1000
  });

  const openCreateUnitFor = (orgId: number) => {
    const org = adminOrgs.find((item) => item.orgId === orgId) || null;
    setOrgUnitsOrg(org);
    setCreateUnitVisible(true);
  };

  useEffect(() => {
    if (editingOrg) {
      setOrgEditDraft({
        name: editingOrg.name || '',
        code: editingOrg.code || '',
        email: editingOrg.email || '',
        phone: editingOrg.phone || '',
        address: editingOrg.address || '',
        tags: (editingOrg.tags || []).join(', '),
        region: editingOrg.region || '',
        timezone: editingOrg.timezone || ''
      });
    }
  }, [editingOrg]);

  useEffect(() => {
    if (editingUnit) {
      setUnitEditDraft({
        name: editingUnit.name || '',
        code: editingUnit.code || '',
        email: editingUnit.email || '',
        phone: editingUnit.phone || '',
        address: editingUnit.address || '',
        tags: (editingUnit.tags || []).join(', '),
        region: editingUnit.region || '',
        timezone: editingUnit.timezone || ''
      });
    }
  }, [editingUnit]);

  const adminOrgColumns = [
    {
      title: 'Org ID',
      dataIndex: 'orgId',
      key: 'orgId',
      render: (value: number) => <Typography.Text style={{ fontFamily: token.fontFamilyCode }}>{value}</Typography.Text>
    },
    { title: 'Name', dataIndex: 'name', key: 'name', render: (value: string) => value || '—' },
    { title: 'Code', dataIndex: 'code', key: 'code', render: (value: string) => value || '—' },
    { title: 'Email', dataIndex: 'email', key: 'email', render: (value: string) => value || '—' },
    { title: 'Phone', dataIndex: 'phone', key: 'phone', render: (value: string) => value || '—' },
    {
      title: 'Address',
      dataIndex: 'address',
      key: 'address',
      render: (value: string) => (
        <Typography.Paragraph
          style={{ margin: 0, maxWidth: 280 }}
          ellipsis={{ rows: 2, tooltip: value || undefined }}
        >
          {value || '—'}
        </Typography.Paragraph>
      )
    },
    {
      title: 'Tags',
      dataIndex: 'tags',
      key: 'tags',
      render: (value: string[] | null | undefined) => (
        <Space size={4} wrap>
          {(value || []).length === 0 ? '—' : (value || []).map((tag) => <Tag key={tag}>{tag}</Tag>)}
        </Space>
      )
    },
    {
      title: 'Location',
      key: 'location',
      render: (_: any, record: AdminOrgSummary) => {
        const region = record.region || '';
        const timezone = record.timezone || '';
        if (!region && !timezone) return '—';
        return (
          <div>
            <div>{region || '—'}</div>
            <Typography.Text type="secondary" style={{ fontSize: token.fontSizeSM }}>
              {timezone || '—'}
            </Typography.Text>
          </div>
        );
      }
    },
    {
      title: 'Actions',
      key: 'actions',
      render: (_: any, record: AdminOrgSummary) => (
        <Space>
          <Button size="small" onClick={() => setEditingOrg(record)}>Edit</Button>
          <Button
            size="small"
            onClick={() => {
              setOrgUnitsOrg(record);
              setOrgUnitsVisible(true);
            }}
          >
            Units
          </Button>
          <Button
            size="small"
            onClick={async () => {
              setGeneratingPortal(true);
              try {
                const res = await createPortalSession({ orgId: record.orgId, role: 'INTEGRATION_EDITOR' });
                setPortalLink({ url: res.portalUrl, orgId: record.orgId });
              } catch (err: any) {
                messageApi.error(err?.message || 'Failed to generate portal link');
              } finally {
                setGeneratingPortal(false);
              }
            }}
            loading={generatingPortal && portalLink?.orgId === record.orgId}
          >
            Portal
          </Button>
          <Button
            size="small"
            danger
            onClick={() => {
              Modal.confirm({
                title: 'Delete organization?',
                content: `This will remove org ${record.orgId} and all its units.`,
                okText: 'Delete',
                okButtonProps: { danger: true },
                cancelText: 'Cancel',
                onOk: async () => {
                  await deleteAdminOrg(record.orgId);
                  await refetchAdminOrgs();
                  messageApi.success(`Deleted org ${record.orgId}`);
                }
              });
            }}
          >
            Delete
          </Button>
        </Space >
      )
    }
  ];

  const adminOrgUnitColumns = [
    {
      title: 'RID',
      dataIndex: 'rid',
      key: 'rid',
      render: (value: number) => <Typography.Text style={{ fontFamily: token.fontFamilyCode }}>{value}</Typography.Text>
    },
    { title: 'Name', dataIndex: 'name', key: 'name', render: (value: string) => value || '—' },
    { title: 'Code', dataIndex: 'code', key: 'code', render: (value: string) => value || '—' },
    { title: 'Email', dataIndex: 'email', key: 'email', render: (value: string) => value || '—' },
    { title: 'Phone', dataIndex: 'phone', key: 'phone', render: (value: string) => value || '—' },
    {
      title: 'Address',
      dataIndex: 'address',
      key: 'address',
      render: (value: string) => (
        <Typography.Paragraph
          style={{ margin: 0, maxWidth: 280 }}
          ellipsis={{ rows: 2, tooltip: value || undefined }}
        >
          {value || '—'}
        </Typography.Paragraph>
      )
    },
    {
      title: 'Tags',
      dataIndex: 'tags',
      key: 'tags',
      render: (value: string[] | null | undefined) => (
        <Space size={4} wrap>
          {(value || []).length === 0 ? '—' : (value || []).map((tag) => <Tag key={tag}>{tag}</Tag>)}
        </Space>
      )
    },
    {
      title: 'Location',
      key: 'location',
      render: (_: any, record: AdminOrgUnit) => {
        const region = record.region || '';
        const timezone = record.timezone || '';
        if (!region && !timezone) return '—';
        return (
          <div>
            <div>{region || '—'}</div>
            <Typography.Text type="secondary" style={{ fontSize: token.fontSizeSM }}>
              {timezone || '—'}
            </Typography.Text>
          </div>
        );
      }
    },
    {
      title: 'Actions',
      key: 'actions',
      render: (_: any, record: AdminOrgUnit) => (
        <Space>
          <Button size="small" onClick={() => setEditingUnit(record)}>Edit</Button>
          <Button
            size="small"
            danger
            onClick={() => {
              Modal.confirm({
                title: 'Delete org unit?',
                content: `Remove unit ${record.rid} from org ${record.orgId}.`,
                okText: 'Delete',
                okButtonProps: { danger: true },
                cancelText: 'Cancel',
                onOk: async () => {
                  await deleteAdminOrgUnit(record.orgId, record.rid);
                  await refetchAdminOrgUnits();
                  messageApi.success(`Deleted unit ${record.rid}`);
                }
              });
            }}
          >
            Delete
          </Button>
        </Space>
      )
    }
  ];

  const orgTagTokens = useMemo(() => parseTags(orgTagFilter), [orgTagFilter]);
  const filteredOrgs = orgTagTokens.length === 0
    ? adminOrgs
    : adminOrgs.filter((org) => {
      const orgTags = (org.tags || []).map((tag) => String(tag).toLowerCase());
      return orgTagTokens.every((tag) => orgTags.includes(tag.toLowerCase()));
    });

  const unitTagTokens = useMemo(() => parseTags(unitTagFilter), [unitTagFilter]);
  const filteredUnits = unitTagTokens.length === 0
    ? adminOrgUnits
    : adminOrgUnits.filter((unit) => {
      const unitTags = (unit.tags || []).map((tag) => String(tag).toLowerCase());
      return unitTagTokens.every((tag) => unitTags.includes(tag.toLowerCase()));
    });

  return (
    <div>
      {contextHolder}
      <Modal
        title="Portal Magic Link"
        open={!!portalLink}
        onCancel={() => setPortalLink(null)}
        footer={[
          <Button key="close" onClick={() => setPortalLink(null)}>Close</Button>,
          <Button
            key="copy"
            type="primary"
            onClick={() => {
              if (portalLink) {
                navigator.clipboard.writeText(portalLink.url);
                messageApi.success('Link copied to clipboard');
              }
            }}
          >
            Copy Link
          </Button>
        ]}
      >
        <Typography.Paragraph>
          Use this link to access the integration portal for <strong>Org {portalLink?.orgId}</strong> without logging in.
        </Typography.Paragraph>
        <Input.TextArea
          rows={4}
          readOnly
          value={portalLink?.url}
          style={{ fontFamily: token.fontFamilyCode, fontSize: token.fontSizeSM }}
        />
        <Typography.Text type="secondary" style={{ display: 'block', marginTop: 12 }}>
          Note: This link is short-lived (2 hours) and gives <strong>Integration Editor</strong> permissions.
        </Typography.Text>
      </Modal>
      <PageHeader
        title="Org Directory"
        description="Create organizations and manage their units."
      />

      <Row gutter={spacingToNumber(spacing[6])}>
        <Col xs={24}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacingToNumber(spacing[3]) }}>
            <Typography.Title level={4} style={{ margin: 0 }}>Organizations</Typography.Title>
            <Button type="primary" onClick={() => setCreateOrgVisible(true)}>Create Org</Button>
          </div>
          <Card style={{ borderRadius: token.borderRadiusLG }}>
            <Space direction="vertical" size={spacingToNumber(spacing[3])} style={{ width: '100%' }}>
              <Row gutter={spacingToNumber(spacing[3])}>
                <Col xs={24} md={12}>
                  <Input
                    placeholder="Filter by tags (comma separated)"
                    value={orgTagFilter}
                    onChange={(event) => setOrgTagFilter(event.target.value)}
                  />
                </Col>
                <Col xs={24} md={12} style={{ textAlign: 'right' }}>
                  <Button onClick={() => setOrgTagFilter('')}>Clear Filters</Button>
                </Col>
              </Row>
              {orgTagTokens.length > 0 && (
                <Space size={6} wrap>
                  {orgTagTokens.map((tag) => (
                    <Tag
                      key={tag}
                      closable
                      onClose={(event) => {
                        event.preventDefault();
                        const next = orgTagTokens.filter((t) => t.toLowerCase() !== tag.toLowerCase());
                        setOrgTagFilter(next.join(', '));
                      }}
                    >
                      {tag}
                    </Tag>
                  ))}
                </Space>
              )}

              <Table
                dataSource={filteredOrgs}
                columns={adminOrgColumns}
                rowKey={(row) => row.orgId}
                pagination={{ pageSize: 8 }}
                loading={adminOrgsLoading}
                size="small"
                expandable={{
                  expandedRowRender: (record) => (
                    <OrgUnitsInline
                      orgId={record.orgId}
                      token={token}
                      onEditUnit={(unit) => setEditingUnit(unit)}
                      onCreateUnit={(orgId) => openCreateUnitFor(orgId)}
                      messageApi={messageApi}
                    />
                  ),
                  rowExpandable: () => true
                }}
              />
            </Space>
          </Card>
        </Col>
      </Row>

      <Modal
        title={editingOrg ? `Edit Org ${editingOrg.orgId}` : 'Edit Org'}
        open={!!editingOrg}
        confirmLoading={orgEditSaving}
        onCancel={() => setEditingOrg(null)}
        onOk={async () => {
          if (!editingOrg) return;
          if (!orgEditDraft.name.trim()) {
            messageApi.error('Name is required');
            return;
          }
          if (!orgEditDraft.code.trim()) {
            messageApi.error('Code is required');
            return;
          }
          const phoneError = validatePhone(orgEditDraft.phone);
          if (phoneError) {
            setOrgEditPhoneError(phoneError);
            messageApi.error(phoneError);
            return;
          }
          setOrgEditSaving(true);
          try {
            await updateAdminOrg(editingOrg.orgId, {
              name: orgEditDraft.name.trim(),
              code: orgEditDraft.code.trim(),
              email: orgEditDraft.email || undefined,
              phone: orgEditDraft.phone || undefined,
              address: orgEditDraft.address || undefined,
              tags: orgEditDraft.tags ? parseTags(orgEditDraft.tags) : undefined,
              region: orgEditDraft.region || undefined,
              timezone: orgEditDraft.timezone || undefined
            });
            await refetchAdminOrgs();
            messageApi.success(`Updated org ${editingOrg.orgId}`);
            setEditingOrg(null);
          } catch (err: any) {
            messageApi.error(err?.message || 'Failed to update org');
          } finally {
            setOrgEditSaving(false);
          }
        }}
        width={620}
      >
        <Space direction="vertical" size={spacingToNumber(spacing[3])} style={{ width: '100%' }}>
          <Input
            placeholder="Name (required)"
            value={orgEditDraft.name}
            onChange={(event) => setOrgEditDraft((prev) => ({ ...prev, name: event.target.value }))}
          />
          <Input
            placeholder="Code (required)"
            value={orgEditDraft.code}
            onChange={(event) => setOrgEditDraft((prev) => ({ ...prev, code: event.target.value }))}
          />
          <Input
            placeholder="Email"
            value={orgEditDraft.email}
            onChange={(event) => setOrgEditDraft((prev) => ({ ...prev, email: event.target.value }))}
          />
          <Input
            placeholder="Phone"
            value={orgEditDraft.phone}
            onChange={(event) => {
              const value = event.target.value;
              setOrgEditDraft((prev) => ({ ...prev, phone: value }));
              setOrgEditPhoneError(validatePhone(value));
            }}
            status={orgEditPhoneError ? 'error' : undefined}
          />
          {orgEditPhoneError && (
            <Typography.Text type="danger" style={{ fontSize: token.fontSizeSM }}>
              {orgEditPhoneError}
            </Typography.Text>
          )}
          <Input
            placeholder="Address"
            value={orgEditDraft.address}
            onChange={(event) => setOrgEditDraft((prev) => ({ ...prev, address: event.target.value }))}
          />
          <Input
            placeholder="Tags (comma separated)"
            value={orgEditDraft.tags}
            onChange={(event) => setOrgEditDraft((prev) => ({ ...prev, tags: event.target.value }))}
          />
          <Input
            placeholder="Region"
            value={orgEditDraft.region}
            onChange={(event) => setOrgEditDraft((prev) => ({ ...prev, region: event.target.value }))}
          />
          <Input
            placeholder="Timezone"
            value={orgEditDraft.timezone}
            onChange={(event) => setOrgEditDraft((prev) => ({ ...prev, timezone: event.target.value }))}
          />
        </Space>
      </Modal>

      <Modal
        title="Create Organization"
        open={createOrgVisible}
        confirmLoading={orgSaving}
        onCancel={() => {
          setCreateOrgVisible(false);
          setOrgPhoneError('');
        }}
        onOk={async () => {
          if (!orgForm.orgId) {
            messageApi.error('Org ID is required');
            return;
          }
          if (!orgForm.name.trim()) {
            messageApi.error('Name is required');
            return;
          }
          if (!orgForm.code.trim()) {
            messageApi.error('Code is required');
            return;
          }
          const phoneError = validatePhone(orgForm.phone);
          if (phoneError) {
            setOrgPhoneError(phoneError);
            messageApi.error(phoneError);
            return;
          }
          const createdId = orgForm.orgId;
          setOrgSaving(true);
          try {
            await createAdminOrg({
              orgId: orgForm.orgId,
              name: orgForm.name.trim(),
              code: orgForm.code.trim(),
              email: orgForm.email || undefined,
              phone: orgForm.phone || undefined,
              address: orgForm.address || undefined,
              tags: orgForm.tags ? parseTags(orgForm.tags) : undefined,
              region: orgForm.region || undefined,
              timezone: orgForm.timezone || undefined
            });
            await refetchAdminOrgs();
            setOrgForm({
              orgId: undefined,
              name: '',
              code: '',
              email: '',
              phone: '',
              address: '',
              tags: '',
              region: '',
              timezone: ''
            });
            setOrgPhoneError('');
            messageApi.success(`Created org ${createdId}`);
            setCreateOrgVisible(false);
          } catch (err: any) {
            messageApi.error(err?.message || 'Failed to create org');
          } finally {
            setOrgSaving(false);
          }
        }}
        width={700}
      >
        <Space direction="vertical" size={spacingToNumber(spacing[3])} style={{ width: '100%' }}>
          <Row gutter={spacingToNumber(spacing[3])}>
            <Col xs={24} md={8}>
              <InputNumber
                placeholder="Org ID"
                value={orgForm.orgId}
                onChange={(value) => setOrgForm((prev) => ({ ...prev, orgId: value ?? undefined }))}
                style={{ width: '100%' }}
              />
            </Col>
            <Col xs={24} md={8}>
              <Input
                placeholder="Name (required)"
                value={orgForm.name}
                onChange={(event) => setOrgForm((prev) => ({ ...prev, name: event.target.value }))}
              />
            </Col>
            <Col xs={24} md={8}>
              <Input
                placeholder="Code (required)"
                value={orgForm.code}
                onChange={(event) => setOrgForm((prev) => ({ ...prev, code: event.target.value }))}
              />
            </Col>
          </Row>
          <Row gutter={spacingToNumber(spacing[3])}>
            <Col xs={24} md={8}>
              <Input
                placeholder="Email"
                value={orgForm.email}
                onChange={(event) => setOrgForm((prev) => ({ ...prev, email: event.target.value }))}
              />
            </Col>
            <Col xs={24} md={8}>
              <Input
                placeholder="Phone"
                value={orgForm.phone}
                onChange={(event) => {
                  const value = event.target.value;
                  setOrgForm((prev) => ({ ...prev, phone: value }));
                  setOrgPhoneError(validatePhone(value));
                }}
                status={orgPhoneError ? 'error' : undefined}
              />
              {orgPhoneError && (
                <Typography.Text type="danger" style={{ fontSize: token.fontSizeSM }}>
                  {orgPhoneError}
                </Typography.Text>
              )}
            </Col>
            <Col xs={24} md={8}>
              <Input
                placeholder="Address"
                value={orgForm.address}
                onChange={(event) => setOrgForm((prev) => ({ ...prev, address: event.target.value }))}
              />
            </Col>
          </Row>
          <Row gutter={spacingToNumber(spacing[3])}>
            <Col xs={24} md={8}>
              <Input
                placeholder="Tags (comma separated)"
                value={orgForm.tags}
                onChange={(event) => setOrgForm((prev) => ({ ...prev, tags: event.target.value }))}
              />
            </Col>
            <Col xs={24} md={8}>
              <Input
                placeholder="Region"
                value={orgForm.region}
                onChange={(event) => setOrgForm((prev) => ({ ...prev, region: event.target.value }))}
              />
            </Col>
            <Col xs={24} md={8}>
              <Input
                placeholder="Timezone"
                value={orgForm.timezone}
                onChange={(event) => setOrgForm((prev) => ({ ...prev, timezone: event.target.value }))}
              />
            </Col>
          </Row>
        </Space>
      </Modal>

      <Modal
        title={orgUnitsOrg ? `Org Units for ${orgUnitsOrg.orgId}` : 'Org Units'}
        open={orgUnitsVisible}
        onCancel={() => {
          setOrgUnitsVisible(false);
          setOrgUnitsOrg(null);
          setEditingUnit(null);
          setCreateUnitVisible(false);
        }}
        footer={null}
        width={920}
      >
        <Space direction="vertical" size={spacingToNumber(spacing[3])} style={{ width: '100%' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Typography.Text type="secondary">
              Units for org {orgUnitsOrg?.orgId ?? '—'}
            </Typography.Text>
            <Button type="primary" onClick={() => setCreateUnitVisible(true)}>Create Unit</Button>
          </div>
          <Row gutter={spacingToNumber(spacing[3])}>
            <Col xs={24} md={12}>
              <Input
                placeholder="Filter units by tags (comma separated)"
                value={unitTagFilter}
                onChange={(event) => setUnitTagFilter(event.target.value)}
              />
            </Col>
            <Col xs={24} md={12} style={{ textAlign: 'right' }}>
              <Button
                onClick={() => {
                  setUnitTagFilter('');
                }}
              >
                Clear Filters
              </Button>
            </Col>
          </Row>
          {unitTagTokens.length > 0 && (
            <Space size={6} wrap>
              {unitTagTokens.map((tag) => (
                <Tag
                  key={tag}
                  closable
                  onClose={(event) => {
                    event.preventDefault();
                    const next = unitTagTokens.filter((t) => t.toLowerCase() !== tag.toLowerCase());
                    setUnitTagFilter(next.join(', '));
                  }}
                >
                  {tag}
                </Tag>
              ))}
            </Space>
          )}
          <Table
            dataSource={filteredUnits}
            columns={adminOrgUnitColumns}
            rowKey={(row) => `${row.orgId}-${row.rid}`}
            loading={adminOrgUnitsLoading}
            pagination={{ pageSize: 8 }}
            size="small"
          />
        </Space>
      </Modal>

      <Modal
        title={orgUnitsOrg ? `Create Unit for ${orgUnitsOrg.orgId}` : 'Create Unit'}
        open={createUnitVisible}
        confirmLoading={unitSaving}
        onCancel={() => {
          setCreateUnitVisible(false);
          setUnitPhoneError('');
        }}
        onOk={async () => {
          if (!orgUnitsOrgId) {
            messageApi.error('Select an org first');
            return;
          }
          if (!unitForm.rid) {
            messageApi.error('RID is required');
            return;
          }
          if (!unitForm.name.trim()) {
            messageApi.error('Name is required');
            return;
          }
          if (!unitForm.code.trim()) {
            messageApi.error('Code is required');
            return;
          }
          const phoneError = validatePhone(unitForm.phone);
          if (phoneError) {
            setUnitPhoneError(phoneError);
            messageApi.error(phoneError);
            return;
          }
          const createdRid = unitForm.rid;
          setUnitSaving(true);
          try {
            await createAdminOrgUnit(orgUnitsOrgId, {
              orgId: orgUnitsOrgId,
              rid: unitForm.rid,
              name: unitForm.name.trim(),
              code: unitForm.code.trim(),
              email: unitForm.email || undefined,
              phone: unitForm.phone || undefined,
              address: unitForm.address || undefined,
              tags: unitForm.tags ? parseTags(unitForm.tags) : undefined,
              region: unitForm.region || undefined,
              timezone: unitForm.timezone || undefined
            });
            await refetchAdminOrgUnits();
            setUnitForm({
              rid: undefined,
              name: '',
              code: '',
              email: '',
              phone: '',
              address: '',
              tags: '',
              region: '',
              timezone: ''
            });
            setUnitPhoneError('');
            messageApi.success(`Added unit ${createdRid}`);
            setCreateUnitVisible(false);
          } catch (err: any) {
            messageApi.error(err?.message || 'Failed to add unit');
          } finally {
            setUnitSaving(false);
          }
        }}
        width={720}
      >
        <Space direction="vertical" size={spacingToNumber(spacing[3])} style={{ width: '100%' }}>
          <Row gutter={spacingToNumber(spacing[3])}>
            <Col xs={24} md={6}>
              <InputNumber
                placeholder="RID"
                value={unitForm.rid}
                onChange={(value) => setUnitForm((prev) => ({ ...prev, rid: value ?? undefined }))}
                style={{ width: '100%' }}
              />
            </Col>
            <Col xs={24} md={6}>
              <Input
                placeholder="Name (required)"
                value={unitForm.name}
                onChange={(event) => setUnitForm((prev) => ({ ...prev, name: event.target.value }))}
              />
            </Col>
            <Col xs={24} md={6}>
              <Input
                placeholder="Code (required)"
                value={unitForm.code}
                onChange={(event) => setUnitForm((prev) => ({ ...prev, code: event.target.value }))}
              />
            </Col>
            <Col xs={24} md={6}>
              <Input
                placeholder="Email"
                value={unitForm.email}
                onChange={(event) => setUnitForm((prev) => ({ ...prev, email: event.target.value }))}
              />
            </Col>
          </Row>
          <Row gutter={spacingToNumber(spacing[3])}>
            <Col xs={24} md={6}>
              <Input
                placeholder="Phone"
                value={unitForm.phone}
                onChange={(event) => {
                  const value = event.target.value;
                  setUnitForm((prev) => ({ ...prev, phone: value }));
                  setUnitPhoneError(validatePhone(value));
                }}
                status={unitPhoneError ? 'error' : undefined}
              />
              {unitPhoneError && (
                <Typography.Text type="danger" style={{ fontSize: token.fontSizeSM }}>
                  {unitPhoneError}
                </Typography.Text>
              )}
            </Col>
            <Col xs={24} md={6}>
              <Input
                placeholder="Address"
                value={unitForm.address}
                onChange={(event) => setUnitForm((prev) => ({ ...prev, address: event.target.value }))}
              />
            </Col>
            <Col xs={24} md={6}>
              <Input
                placeholder="Tags (comma separated)"
                value={unitForm.tags}
                onChange={(event) => setUnitForm((prev) => ({ ...prev, tags: event.target.value }))}
              />
            </Col>
            <Col xs={24} md={6}>
              <Input
                placeholder="Region"
                value={unitForm.region}
                onChange={(event) => setUnitForm((prev) => ({ ...prev, region: event.target.value }))}
              />
            </Col>
          </Row>
          <Row gutter={spacingToNumber(spacing[3])}>
            <Col xs={24} md={6}>
              <Input
                placeholder="Timezone"
                value={unitForm.timezone}
                onChange={(event) => setUnitForm((prev) => ({ ...prev, timezone: event.target.value }))}
              />
            </Col>
          </Row>
        </Space>
      </Modal>

      <Modal
        title={editingUnit ? `Edit Unit ${editingUnit.rid}` : 'Edit Unit'}
        open={!!editingUnit}
        confirmLoading={unitEditSaving}
        onCancel={() => setEditingUnit(null)}
        onOk={async () => {
          if (!editingUnit) return;
          if (!unitEditDraft.name.trim()) {
            messageApi.error('Name is required');
            return;
          }
          if (!unitEditDraft.code.trim()) {
            messageApi.error('Code is required');
            return;
          }
          const phoneError = validatePhone(unitEditDraft.phone);
          if (phoneError) {
            setUnitEditPhoneError(phoneError);
            messageApi.error(phoneError);
            return;
          }
          setUnitEditSaving(true);
          try {
            await updateAdminOrgUnit(editingUnit.orgId, editingUnit.rid, {
              name: unitEditDraft.name.trim(),
              code: unitEditDraft.code.trim(),
              email: unitEditDraft.email || undefined,
              phone: unitEditDraft.phone || undefined,
              address: unitEditDraft.address || undefined,
              tags: unitEditDraft.tags ? parseTags(unitEditDraft.tags) : undefined,
              region: unitEditDraft.region || undefined,
              timezone: unitEditDraft.timezone || undefined
            });
            await refetchAdminOrgUnits();
            messageApi.success(`Updated unit ${editingUnit.rid}`);
            setEditingUnit(null);
          } catch (err: any) {
            messageApi.error(err?.message || 'Failed to update unit');
          } finally {
            setUnitEditSaving(false);
          }
        }}
        width={620}
      >
        <Space direction="vertical" size={spacingToNumber(spacing[3])} style={{ width: '100%' }}>
          <Input
            placeholder="Name (required)"
            value={unitEditDraft.name}
            onChange={(event) => setUnitEditDraft((prev) => ({ ...prev, name: event.target.value }))}
          />
          <Input
            placeholder="Code (required)"
            value={unitEditDraft.code}
            onChange={(event) => setUnitEditDraft((prev) => ({ ...prev, code: event.target.value }))}
          />
          <Input
            placeholder="Email"
            value={unitEditDraft.email}
            onChange={(event) => setUnitEditDraft((prev) => ({ ...prev, email: event.target.value }))}
          />
          <Input
            placeholder="Phone"
            value={unitEditDraft.phone}
            onChange={(event) => {
              const value = event.target.value;
              setUnitEditDraft((prev) => ({ ...prev, phone: value }));
              setUnitEditPhoneError(validatePhone(value));
            }}
            status={unitEditPhoneError ? 'error' : undefined}
          />
          {unitEditPhoneError && (
            <Typography.Text type="danger" style={{ fontSize: token.fontSizeSM }}>
              {unitEditPhoneError}
            </Typography.Text>
          )}
          <Input
            placeholder="Address"
            value={unitEditDraft.address}
            onChange={(event) => setUnitEditDraft((prev) => ({ ...prev, address: event.target.value }))}
          />
          <Input
            placeholder="Tags (comma separated)"
            value={unitEditDraft.tags}
            onChange={(event) => setUnitEditDraft((prev) => ({ ...prev, tags: event.target.value }))}
          />
          <Input
            placeholder="Region"
            value={unitEditDraft.region}
            onChange={(event) => setUnitEditDraft((prev) => ({ ...prev, region: event.target.value }))}
          />
          <Input
            placeholder="Timezone"
            value={unitEditDraft.timezone}
            onChange={(event) => setUnitEditDraft((prev) => ({ ...prev, timezone: event.target.value }))}
          />
        </Space>
      </Modal>
    </div>
  );
};
