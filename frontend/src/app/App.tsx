import { useEffect, useMemo, useState } from 'react';
import { Button, Layout, Menu, Typography, Space, Badge, Grid, Drawer, Select, Modal, Dropdown, Avatar, Tooltip } from 'antd';
import {
  RadarChartOutlined,
  ApiOutlined,
  HistoryOutlined,
  SettingOutlined,
  DeploymentUnitOutlined,
  ThunderboltOutlined,
  MoonOutlined,
  SunOutlined,
  AppstoreOutlined,
  FileTextOutlined,
  ClockCircleOutlined,
  BellOutlined,
  DatabaseOutlined,
  BookOutlined,
  MenuOutlined,
  TeamOutlined,
  ApartmentOutlined,
  LineChartOutlined,
  WarningOutlined,
  BlockOutlined,
  CalendarOutlined,
  LogoutOutlined,
  ExperimentOutlined,
  SafetyOutlined,
  RobotOutlined,
  CodeOutlined,
  CloudServerOutlined,
  AuditOutlined,
  BarChartOutlined,
  IdcardOutlined
} from '@ant-design/icons';
import { useLocation, Routes, Route, Navigate } from 'react-router-dom';
import { useNavigateWithParams } from '../utils/navigation';
import { useTenant } from './tenant-context';
import { useThemeMode } from './theme-provider';
import { useAuth } from './auth-context';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { usePageViewTracking } from '../hooks/useActivityTracker';
import { DashboardRoute } from '../features/dashboard/DashboardRoute';
import { UnifiedIntegrationsRoute } from '../features/integrations/routes/UnifiedIntegrationsRoute';
import { IntegrationDetailRoute } from '../features/integrations/routes/IntegrationDetailRoute';
import { InboundIntegrationDetailRoute } from '../features/inbound-integrations';
import { LogsRoute } from '../features/logs/routes/LogsRoute';
import { LogDetailRoute } from '../features/logs/routes/LogDetailRoute';
import SystemLogsRoute from '../features/system-logs/routes/SystemLogsRoute';
import { ScheduledIntegrationsRoute } from '../features/scheduled/routes/ScheduledIntegrationsRoute';
import { ScheduledJobsRoute } from '../features/scheduled-jobs/routes/ScheduledJobsRoute';
import { ScheduledJobDetailRoute } from '../features/scheduled-jobs/routes/ScheduledJobDetailRoute';
import { SettingsRoute } from '../features/settings/SettingsRoute';
import { UserManagementRoute } from '../features/settings/UserManagementRoute';
import { AdminRateLimitsRoute } from '../features/settings/AdminRateLimitsRoute';
import { AuditLogsRoute } from '../features/admin/AuditLogsRoute';
import { UserActivityRoute } from '../features/admin/UserActivityRoute';
import { OrgDirectoryRoute } from '../features/admin/OrgDirectoryRoute';
import { AISettingsRoute } from '../features/ai-settings/AISettingsRoute';
import { EventSourceSettingsRoute } from '../features/settings/EventSourceSettingsRoute';
import { AIAssistantRoute } from '../features/ai/AIAssistantRoute';
import { AIChatDrawer } from '../components/ai/AIChatDrawer';
import { PermissionsDemoRoute } from '../features/admin/PermissionsDemoRoute';
import { RoleManagementRoute } from '../features/admin/RoleManagementRoute';
import { TemplatesRoute } from '../features/templates/routes/TemplatesRoute';
import { TemplateDetailRoute } from '../features/templates/routes/TemplateDetailRoute';
import { BulkOperationsRoute } from '../features/bulk/routes/BulkOperationsRoute';
import { VersionsRoute } from '../features/versions/routes/VersionsRoute';
import { EventCatalogRoute } from '../features/events/routes/EventCatalogRoute';
import { EventAuditRoute } from '../features/events/routes/EventAuditRoute';
import { AlertCenterRoute } from '../features/alert-center/routes/AlertCenterRoute';
import { LookupsRoute } from '../features/lookups/routes/LookupsRoute';
import { LookupDetailRoute } from '../features/lookups/routes/LookupDetailRoute';
import { LookupStatsRoute } from '../features/lookups/routes/LookupStatsRoute';
import { HelpRoute } from '../features/help/routes/HelpRoute';
import { LookupGuideRoute } from '../features/help/routes/LookupGuideRoute';
import { DLQRoute } from '../features/integrations/routes/DLQRoute';
import { FlowBuilderRoute } from '../features/flowBuilder/routes/FlowBuilderRoute';
import { FlowBuilderListRoute } from '../features/flowBuilder/routes/FlowBuilderListRoute';
import { LoginRoute } from '../features/auth/LoginRoute';
import { TenantLoadingState } from '../components/common/TenantLoadingState';
import { ToastHost } from '../components/common/ToastHost';
import { EntityParamGuard } from '../components/EntityParamGuard';
import { cssVar, useDesignTokens, spacingToNumber } from '../design-system/utils';
import { listAdminOrgSummaries, getLogStatsSummary } from '../services/api';
import { isFeatureEnabled } from '../utils/featureFlags';
import { LandingPage } from '../features/landing/LandingPage';
import { DocsPage } from '../features/landing/DocsPage';
import '../design-system/theme/responsive-dashboard.css';

export const App = () => {
  const { token, spacing, zIndex: zIndexTokens } = useDesignTokens();
  const screens = Grid.useBreakpoint();
  const isTabletDown = !screens.lg;
  const isMobile = !screens.md;
  const location = useLocation();
  const navigate = useNavigateWithParams();
  const { tenant, isLoading, error, orgId, setManualEntityRid, clearEntityRid } = useTenant();
  const { isAuthenticated, user, exitImpersonation, logout } = useAuth();
  const isSuperAdmin = user?.role === 'SUPER_ADMIN';
  const isAdmin = user?.role === 'ADMIN';
  const isOrgAdmin = user?.role === 'ORG_ADMIN';
  const isImpersonating = user?.impersonated;
  const { mode, toggleMode } = useThemeMode();
  const queryClient = useQueryClient();

  // -------- PORTAL EMBED LOGIC --------
  const searchParams = new URLSearchParams(location.search);
  const embeddedParam = searchParams.get('embedded') === 'true';
  const tokenParam = searchParams.get('token');
  const [isEmbedded] = useState(() => {
    // Check URL param or if loaded inside an actual iframe
    return embeddedParam || window.self !== window.top;
  });

  // If a magic link token is in the URL, decode it and hydrate the auth context
  // in-place — no page reload, no redirect (which would break Vite's base path).
  useEffect(() => {
    if (!tokenParam) return;
    // Only inject if this token is different from what's already stored
    const existingToken = localStorage.getItem('integration_gateway_token');
    if (existingToken === tokenParam) return;

    try {
      // Decode JWT payload (middle segment) — no signature verification needed here,
      // the backend will validate it on every API call.
      const base64Payload = tokenParam.split('.')[1];
      const payload = JSON.parse(atob(base64Payload)) as {
        sub: string;
        email: string;
        role: string;
        orgId?: number;
        isPortalSession?: boolean;
      };

      // Write token + synthetic user into localStorage so auth-context picks them up
      localStorage.setItem('integration_gateway_token', tokenParam);
      localStorage.setItem(
        'integration_gateway_user',
        JSON.stringify({
          id: payload.sub,
          email: payload.email,
          role: payload.role,
          orgId: payload.orgId ?? null,
          isPortalSession: payload.isPortalSession ?? false
        })
      );

      // Persist orgId so tenant-context resolves the right org
      if (payload.orgId) {
        localStorage.setItem('integration_gateway_org_id', String(payload.orgId));
      }

      // Fire the custom event so auth-context and tenant-context re-read localStorage
      window.dispatchEvent(new Event('auth-storage'));
    } catch (err) {
      console.warn('[Portal] Failed to decode magic link token', err);
    }
  }, [tokenParam, token]);
  // ------------------------------------


  // Automatic page view and navigation tracking
  usePageViewTracking();

  // Initialize collapsed state from localStorage
  const [collapsed, setCollapsed] = useState(() => {
    const saved = localStorage.getItem('sidebar-collapsed');
    return saved ? JSON.parse(saved) : false;
  });

  // Persist collapsed state to localStorage
  useEffect(() => {
    localStorage.setItem('sidebar-collapsed', JSON.stringify(collapsed));
  }, [collapsed]);

  // Auto-collapse sidebar on tablet/mobile (but respect user preference on desktop)
  useEffect(() => {
    if (isTabletDown) {
      setCollapsed(true);
    }
  }, [isTabletDown]);

  // Handle logout with complete cache clearing
  const handleLogout = () => {
    // Clear React Query cache
    queryClient.clear();

    // Clear all localStorage items (except theme preference)
    const themeMode = localStorage.getItem('theme-mode');
    localStorage.clear();
    if (themeMode) {
      localStorage.setItem('theme-mode', themeMode);
    }

    // Clear sessionStorage
    sessionStorage.clear();

    // Call auth logout (clears auth tokens and user state)
    logout();

    // Navigate to login page
    navigate('/login');
  };

  const navGroups = useMemo(() => {
    const groups = [];

    // Only show org-specific menus if user has an orgId selected
    // OR if user is not a super admin (regular users always have orgId)
    const showOrgMenus = orgId > 0 || !isSuperAdmin;

    if (showOrgMenus) {
      groups.push(
        // ── Home ────────────────────────────────────────────────────────────
        {
          label: 'Overview',
          items: [
            { key: '/dashboard', icon: <RadarChartOutlined />, label: 'Dashboard' }
          ]
        },

        // ── What you build ──────────────────────────────────────────────────
        {
          label: 'Integrations',
          items: [
            { key: '/integrations', icon: <ApiOutlined />, label: 'All Integrations' },
            ...(isFeatureEnabled('integrationFlowBuilderEnabled')
              ? [{ key: '/flow-builder', icon: <BlockOutlined />, label: 'Flow Builder' }]
              : []
            ),
            { key: '/scheduled', icon: <CalendarOutlined />, label: 'Schedules' },
            { key: '/scheduled-jobs', icon: <ClockCircleOutlined />, label: 'Job Queue' }
          ]
        },

        // ── Reference data ──────────────────────────────────────────────────
        {
          label: 'Resources',
          items: [
            { key: '/events/catalog', icon: <DeploymentUnitOutlined />, label: 'Event Catalog' },
            { key: '/templates', icon: <AppstoreOutlined />, label: 'Templates' },
            { key: '/lookups', icon: <DatabaseOutlined />, label: 'Lookup Tables' }
          ]
        },

        // ── What you watch ──────────────────────────────────────────────────
        {
          label: 'Monitor',
          items: [
            { key: '/logs', icon: <HistoryOutlined />, label: 'Delivery Logs' },
            { key: '/events', icon: <FileTextOutlined />, label: 'Event Audit' },
            { key: '/alert-center', icon: <BellOutlined />, label: 'Alert Center' },
            { key: '/dlq', icon: <WarningOutlined />, label: 'Dead Letter Queue' },
            { key: '/bulk', icon: <ThunderboltOutlined />, label: 'Bulk Operations' },
            { key: '/system-logs', icon: <CodeOutlined />, label: 'System Logs' }
          ]
        },

        // ── AI ──────────────────────────────────────────────────────────────
        {
          label: 'AI',
          items: [
            { key: '/ai', icon: <RobotOutlined />, label: 'AI Assistant' },
            { key: '/ai-settings', icon: <ExperimentOutlined />, label: 'AI Config' }
          ]
        },

        // ── Org config + account ────────────────────────────────────────────
        {
          label: 'Settings',
          items: [
            { key: '/settings', icon: <SettingOutlined />, label: 'Organization' },
            { key: '/settings/event-source', icon: <CloudServerOutlined />, label: 'Event Source' },
            { key: '/help', icon: <BookOutlined />, label: 'Documentation' }
          ]
        }
      );
    }

    // ── Platform admin ──────────────────────────────────────────────────────
    if (isSuperAdmin || isAdmin) {
      groups.push({
        label: 'Administration',
        items: [
          { key: '/admin/orgs', icon: <ApartmentOutlined />, label: 'Org Directory' },
          { key: '/admin/users', icon: <TeamOutlined />, label: 'User Management' },
          { key: '/admin/roles', icon: <SafetyOutlined />, label: 'Role Management' },
          { key: '/admin/rate-limits', icon: <LineChartOutlined />, label: 'Rate Limits' },
          { key: '/admin/audit-logs', icon: <AuditOutlined />, label: 'Audit Logs' },
          { key: '/admin/user-activity', icon: <BarChartOutlined />, label: 'User Activity' },
          { key: '/admin/permissions', icon: <IdcardOutlined />, label: 'My Permissions' }
        ]
      });
    } else if (isOrgAdmin) {
      // ORG_ADMIN: can see their team's activity and own permissions
      groups.push({
        label: 'Team',
        items: [
          { key: '/admin/user-activity', icon: <BarChartOutlined />, label: 'User Activity' },
          { key: '/admin/permissions', icon: <IdcardOutlined />, label: 'My Permissions' }
        ]
      });
    }

    return groups;
  }, [isSuperAdmin, isAdmin, isOrgAdmin, orgId]);

  const activeKey = useMemo(() => {
    const all = navGroups.flatMap((group) => group.items);
    // Sort by key length (longest first) to match more specific paths first
    // This ensures /scheduled-jobs matches before /scheduled
    const sorted = [...all].sort((a, b) => b.key.length - a.key.length);
    const match = sorted.find((item) => location.pathname.startsWith(item.key));
    return match?.key ?? '/dashboard';
  }, [location.pathname, navGroups]);

  const isLoginRoute = location.pathname.startsWith('/login');
  const isLandingRoute = location.pathname === '/';
  const isDocsRoute = location.pathname.startsWith('/docs');
  const isAdminRoute = location.pathname.startsWith('/admin');
  const canSkipTenant = (isSuperAdmin || isAdmin) && isAdminRoute;

  // On initial login, redirect SUPER_ADMIN to admin dashboard
  useEffect(() => {
    if (isAuthenticated && isSuperAdmin && location.pathname === '/event-gateway/') {
      navigate('/admin/orgs');
    }
  }, [isAuthenticated, isSuperAdmin, location.pathname, navigate]);

  const { data: adminOrgs = [] } = useQuery({
    queryKey: ['adminOrgsSummary'],
    queryFn: listAdminOrgSummaries,
    enabled: isSuperAdmin || isAdmin,
    staleTime: 30 * 1000
  });

  // Poll failed delivery count for the header badge — refreshes every 60s
  const { data: failedStats } = useQuery({
    queryKey: ['headerFailedStats', orgId],
    queryFn: getLogStatsSummary,
    enabled: !!orgId && orgId > 0,
    staleTime: 60_000,
    refetchInterval: 60_000
  });
  const failedCount = failedStats?.failed ?? 0;

  // User profile dropdown items
  const userMenuItems = [
    {
      key: 'user-info',
      label: (
        <div style={{ padding: '4px 0' }}>
          <Typography.Text strong style={{ display: 'block', fontSize: 13 }}>
            {user?.email}
          </Typography.Text>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {user?.role?.replace(/_/g, ' ')}
            {user?.orgId ? ` · Org ${user.orgId}` : ''}
          </Typography.Text>
        </div>
      ),
      disabled: true
    },
    { type: 'divider' as const },
    {
      key: 'settings',
      icon: <SettingOutlined />,
      label: 'Organization Settings',
      onClick: () => navigate('/settings')
    },
    {
      key: 'permissions',
      icon: <IdcardOutlined />,
      label: 'My Permissions',
      onClick: () => navigate('/admin/permissions')
    },
    { type: 'divider' as const },
    {
      key: 'logout',
      icon: <LogoutOutlined />,
      label: 'Sign out',
      danger: true,
      onClick: handleLogout
    }
  ];

  useEffect(() => {
    if (!isAuthenticated && !isLoginRoute && !isLandingRoute && !isDocsRoute) {
      sessionStorage.setItem('auth_redirect', `${location.pathname}${location.search}`);
    }
  }, [isAuthenticated, isLoginRoute, location.pathname, location.search]);

  // Toggle sidebar (for hamburger button)
  const toggleSidebar = () => {
    setCollapsed(!collapsed);
  };

  // Render sidebar content (reused for both Sider and Drawer)
  const renderSidebarContent = () => (
    <>
      {/* Logo/Brand area */}
      <div
        style={{
          padding: collapsed && !isMobile ? `${spacing[4]} ${spacing[2]}` : `${spacing[5]} ${spacing[5]}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: collapsed && !isMobile ? 'center' : 'flex-start',
          gap: spacing[3],
          borderBottom: `1px solid ${cssVar.border.subtle}`,
          marginBottom: spacing[4],
          minHeight: 72
        }}
      >
        <div
          style={{
            width: collapsed && !isMobile ? 36 : 44,
            height: collapsed && !isMobile ? 36 : 44,
            borderRadius: 10,
            display: 'grid',
            placeItems: 'center',
            background: cssVar.primary[500],
            color: cssVar.text.inverse,
            flexShrink: 0
          }}
        >
          <DeploymentUnitOutlined style={{ fontSize: collapsed && !isMobile ? 18 : 22 }} />
        </div>
        {!(collapsed && !isMobile) && (
          <div style={{ lineHeight: 1.3, flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <Typography.Text style={{ color: 'var(--color-sidebar-active-text)', fontWeight: 600, fontSize: 16 }}>
                Integration
              </Typography.Text>
              <span style={{
                fontSize: 9,
                fontWeight: 700,
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
                color: 'var(--color-sidebar-active-text)',
                background: 'rgba(99,102,241,0.35)',
                border: '1px solid rgba(99,102,241,0.5)',
                borderRadius: 4,
                padding: '1px 5px',
                lineHeight: 1.6
              }}>
                BETA
              </span>
            </div>
            <Typography.Text style={{ color: 'var(--color-sidebar-item)', fontSize: 12 }}>
              Gateway
            </Typography.Text>
          </div>
        )}
      </div>

      {/* Navigation Menu */}
      <div className="app-sider-menu">
        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={[activeKey]}
          style={{
            borderInlineEnd: 'none',
            padding: collapsed && !isMobile ? `${spacing[2]} ${spacing[2]}` : `0 ${spacing[4]}`,
            background: 'transparent'
          }}
          items={navGroups.map((group) => ({
            key: group.label,
            type: 'group',
            label: collapsed && !isMobile ? null : (
              <div style={{ padding: `${spacing[3]} ${spacing[2]} ${spacing[2]} ${spacing[2]}` }}>
                <Typography.Text
                  style={{
                    color: 'var(--color-sidebar-item)',
                    fontSize: 11,
                    fontWeight: 600,
                    letterSpacing: '0.05em',
                    textTransform: 'uppercase'
                  }}
                >
                  {group.label}
                </Typography.Text>
              </div>
            ),
            children: group.items.map((item) => ({
              key: item.key,
              icon: item.icon,
              label: <span style={{ fontWeight: 500, fontSize: 14 }}>{item.label}</span>,
              onClick: () => {
                navigate(item.key);
                if (isMobile) {
                  setCollapsed(true); // Close drawer on mobile after navigation
                }
              },
              style: {
                borderRadius: 8,
                marginBlock: 2,
                height: 42,
                display: 'flex',
                alignItems: 'center',
                background: activeKey === item.key
                  ? 'var(--color-sidebar-active-bg)'
                  : 'transparent',
                borderLeft: activeKey === item.key
                  ? `3px solid var(--color-sidebar-accent)`
                  : '3px solid transparent',
                paddingLeft: activeKey === item.key ? spacing[3] : `calc(${spacing[3]} + 3px)`
              }
            }))
          }))}
        />
      </div>
    </>
  );

  const renderShell = () => (
    <div className="app-shell">
      <Layout style={{ minHeight: '100vh', background: 'transparent', position: 'relative', zIndex: 1 }}>
        <ToastHost />
        <AIChatDrawer />

        <AIChatDrawer />

        {/* Desktop Sidebar - Hidden in embedded mode */}
        {!isMobile && !isEmbedded && (
          <Layout.Sider
            collapsed={collapsed}
            collapsedWidth={68}
            width={240}
            className="app-sider"
            style={{
              background: 'var(--color-sidebar-bg)',
              position: 'sticky',
              top: 0,
              height: '100vh',
              overflow: 'auto',
              borderRight: `1px solid ${cssVar.border.subtle}`,
              boxShadow: 'var(--shadow-sm)'
            }}
          >
            {renderSidebarContent()}
          </Layout.Sider>
        )}

        {/* Mobile Drawer - Hidden in embedded mode */}
        {isMobile && !isEmbedded && (
          <Drawer
            placement="left"
            open={!collapsed}
            onClose={() => setCollapsed(true)}
            width={280}
            closable={false}
            bodyStyle={{
              padding: 0,
              background: 'var(--color-sidebar-bg)'
            }}
            styles={{
              body: {
                padding: 0
              }
            }}
          >
            {renderSidebarContent()}
          </Drawer>
        )}
        <Layout style={{ background: 'transparent', minHeight: '100vh' }}>
          {!isEmbedded && <Layout.Header
            style={{
              background: mode === 'dark'
                ? 'rgba(11, 18, 32, 0.98)'
                : 'rgba(255, 255, 255, 0.98)',
              paddingInline: spacing[4],
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: spacing[4],
              borderBottom: `1px solid ${cssVar.border.subtle}`,
              position: 'sticky',
              top: 0,
              zIndex: zIndexTokens.stickyHeader,
              height: 64,
              backdropFilter: 'blur(12px)',
              boxShadow: 'var(--shadow-sm)'
            }}
          >
            {/* Left: Hamburger + Tenant Info */}
            <div style={{ display: 'flex', alignItems: 'center', gap: spacing[3], flex: 1, minWidth: 0 }}>
              {/* Hamburger Button */}
              <Button
                type="text"
                onClick={toggleSidebar}
                icon={<MenuOutlined />}
                aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
                style={{
                  color: token.colorText,
                  height: 40,
                  width: 40,
                  flexShrink: 0
                }}
              />

              {/* Tenant Info */}
              <div style={{ display: 'flex', alignItems: 'center', gap: spacing[2], minWidth: 0 }}>
                <Badge status={tenant ? "success" : "default"} style={{ flexShrink: 0 }} />
                <div style={{ minWidth: 0 }}>
                  <Typography.Text
                    strong
                    style={{
                      fontSize: 14,
                      color: token.colorText,
                      display: 'block',
                      lineHeight: 1.4,
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis'
                    }}
                  >
                    {tenant?.tenantName ?? ((isSuperAdmin || isAdmin) ? 'Global Admin View' : 'Tenant')}
                  </Typography.Text>
                  <div style={{ display: 'flex', gap: spacing[2], alignItems: 'center' }}>
                    <Typography.Text
                      type="secondary"
                      style={{
                        fontSize: 12,
                        lineHeight: 1.2
                      }}
                    >
                      {tenant?.tenantCode ?? ((isSuperAdmin || isAdmin) ? 'Select org from dropdown' : '')}
                    </Typography.Text>
                    {tenant && (
                      <Typography.Text
                        type="secondary"
                        style={{
                          fontSize: 12,
                          lineHeight: 1.2
                        }}
                      >
                        • {tenant.region ?? 'Global'}
                      </Typography.Text>
                    )}
                  </div>
                </div>
              </div>

              {(isSuperAdmin || isAdmin) && !isImpersonating && (
                <Select
                  size="small"
                  placeholder="Switch org"
                  value={orgId && orgId > 0 ? orgId : undefined}
                  style={{ minWidth: 160 }}
                  allowClear
                  options={adminOrgs.map((org) => ({
                    label: org.name ? `${org.name} (Org ${org.orgId})` : `Org ${org.orgId}`,
                    value: org.orgId
                  }))}
                  onChange={(value) => {
                    if (!value) {
                      Modal.confirm({
                        title: 'Clear org context?',
                        content: 'You will return to the global admin view.',
                        okText: 'Clear',
                        okButtonProps: { danger: true },
                        cancelText: 'Cancel',
                        onOk: () => clearEntityRid()
                      });
                      return;
                    }

                    if (Number(value) === orgId) {
                      return;
                    }

                    Modal.confirm({
                      title: 'Switch organization?',
                      content: `Switch context to Org ${value}? Unsaved changes may be lost.`,
                      okText: 'Switch',
                      cancelText: 'Cancel',
                      onOk: () => setManualEntityRid(Number(value))
                    });
                  }}
                />
              )}
            </div>

            {/* Right: Actions */}
            <Space size={spacingToNumber(spacing[2])}>
              <Button
                type="primary"
                onClick={() => navigate('/integrations/new')}
                icon={<ThunderboltOutlined />}
                style={{ fontWeight: 600, height: 40, borderRadius: 8 }}
              >
                {!isMobile && 'New Integration'}
              </Button>

              {/* Failed deliveries badge — only when there are failures */}
              {failedCount > 0 && (
                <Tooltip title={`${failedCount} failed deliveries — click to view`}>
                  <Badge count={failedCount} size="small" offset={[-4, 4]}>
                    <Button
                      type="text"
                      icon={<WarningOutlined />}
                      onClick={() => navigate('/dlq')}
                      aria-label={`${failedCount} failed deliveries`}
                      style={{ color: token.colorError, height: 40, width: 40 }}
                    />
                  </Badge>
                </Tooltip>
              )}

              {/* Theme toggle */}
              <Button
                type="text"
                onClick={toggleMode}
                icon={mode === 'dark' ? <SunOutlined /> : <MoonOutlined />}
                aria-label={mode === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
                style={{ color: token.colorTextSecondary, height: 40, width: 40 }}
              />

              {/* User profile dropdown */}
              <Dropdown
                menu={{ items: userMenuItems }}
                placement="bottomRight"
                trigger={['click']}
              >
                <Button
                  type="text"
                  style={{
                    height: 40,
                    padding: `0 ${spacing[2]}`,
                    display: 'flex',
                    alignItems: 'center',
                    gap: spacing[2]
                  }}
                  aria-label="User menu"
                >
                  <Avatar
                    size={28}
                    style={{
                      background: token.colorPrimary,
                      fontSize: 12,
                      fontWeight: 600,
                      flexShrink: 0
                    }}
                  >
                    {(user?.email?.[0] ?? 'U').toUpperCase()}
                  </Avatar>
                  {!isMobile && (
                    <Typography.Text
                      style={{
                        fontSize: 13,
                        color: token.colorText,
                        maxWidth: 120,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap'
                      }}
                    >
                      {user?.email?.split('@')[0]}
                    </Typography.Text>
                  )}
                </Button>
              </Dropdown>
            </Space>
          </Layout.Header>}
          <Layout.Content
            style={{
              padding: isEmbedded ? 0 : (isMobile ? spacing[4] : spacing[5]),
              minHeight: isEmbedded ? '100vh' : 'calc(100vh - 64px)',
              background: isEmbedded ? 'transparent' : cssVar.bg.base
            }}
          >
            <div className="content-shell">
              {isImpersonating && (
                <div style={{ marginBottom: spacing[4] }}>
                  <div
                    style={{
                      padding: `${spacing[3]} ${spacing[4]}`,
                      borderRadius: 10,
                      border: `1px solid ${cssVar.warning.border}`,
                      background: cssVar.warning.bg,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: spacing[4]
                    }}
                  >
                    <div>
                      <Typography.Text strong>Impersonation active</Typography.Text>
                      <Typography.Paragraph style={{ margin: 0 }}>
                        You are acting as org {user?.orgId ?? 'unknown'} ({user?.role}).
                      </Typography.Paragraph>
                    </div>
                    <Button onClick={exitImpersonation}>Exit impersonation</Button>
                  </div>
                </div>
              )}
              <div className="content-stack">
                <Routes>
                  <Route path="/" element={<Navigate to="/dashboard" replace />} />
                  <Route path="/dashboard" element={<DashboardRoute />} />
                  <Route path="/integrations" element={<UnifiedIntegrationsRoute />} />
                  <Route path="/integrations/:id" element={<IntegrationDetailRoute />} />
                  <Route path="/inbound-integrations" element={<Navigate to="/integrations?tab=inbound" replace />} />
                  <Route path="/inbound-integrations/:id" element={<InboundIntegrationDetailRoute />} />
                  {isFeatureEnabled('integrationFlowBuilderEnabled') && (
                    <>
                      <Route path="/flow-builder" element={<FlowBuilderListRoute />} />
                      <Route path="/flow-builder/new" element={<FlowBuilderRoute />} />
                      <Route path="/flow-builder/:integrationId" element={<FlowBuilderRoute />} />
                    </>
                  )}
                  <Route path="/events" element={<EventAuditRoute />} />
                  <Route path="/events/catalog" element={<EventCatalogRoute />} />
                  <Route path="/lookups" element={<LookupsRoute />} />
                  <Route path="/lookups/stats" element={<LookupStatsRoute />} />
                  <Route path="/lookups/:id" element={<LookupDetailRoute />} />
                  <Route path="/logs" element={<LogsRoute />} />
                  <Route path="/logs/:id" element={<LogDetailRoute />} />
                  <Route path="/dlq" element={<DLQRoute />} />
                  <Route path="/scheduled" element={<ScheduledIntegrationsRoute />} />
                  <Route path="/scheduled-jobs" element={<ScheduledJobsRoute />} />
                  <Route path="/scheduled-jobs/:id" element={<ScheduledJobDetailRoute />} />
                  <Route path="/alert-center" element={<AlertCenterRoute />} />
                  <Route path="/system-logs" element={<SystemLogsRoute />} />
                  <Route path="/templates" element={<TemplatesRoute />} />
                  <Route path="/templates/new" element={<TemplateDetailRoute />} />
                  <Route path="/templates/:id" element={<TemplateDetailRoute />} />
                  <Route path="/bulk" element={<BulkOperationsRoute />} />
                  <Route path="/versions/:__KEEP_integrationName__" element={<VersionsRoute />} />
                  <Route path="/ai" element={<AIAssistantRoute />} />
                  <Route path="/ai-settings" element={<AISettingsRoute />} />
                  <Route path="/settings" element={<SettingsRoute />} />
                  <Route path="/settings/event-source" element={<EventSourceSettingsRoute />} />
                  <Route path="/admin/users" element={<UserManagementRoute />} />
                  <Route path="/admin/orgs" element={<OrgDirectoryRoute />} />
                  <Route path="/admin/roles" element={<RoleManagementRoute />} />
                  <Route path="/admin/permissions" element={<PermissionsDemoRoute />} />
                  <Route path="/admin/rate-limits" element={<AdminRateLimitsRoute />} />
                  <Route path="/admin/audit-logs" element={<AuditLogsRoute />} />
                  <Route path="/admin/user-activity" element={<UserActivityRoute />} />
                  <Route path="/help" element={<HelpRoute />} />
                  <Route path="/help/lookup-guide" element={<LookupGuideRoute />} />
                  <Route path="*" element={<Navigate to="/dashboard" replace />} />
                </Routes>
              </div>
            </div>
          </Layout.Content>
        </Layout>
      </Layout>
    </div>
  );

  // Public landing page — show before any auth checks
  if (isLandingRoute && !isAuthenticated) {
    return <LandingPage />;
  }

  // Public docs — no auth required
  if (isDocsRoute) {
    return (
      <Routes>
        <Route path="/docs" element={<DocsPage />} />
        <Route path="/docs/:slug" element={<DocsPage />} />
      </Routes>
    );
  }

  if (isLoginRoute) {
    return <Navigate to="/" replace />;
  }

  if (!isAuthenticated) {
    return <Navigate to="/" replace />;
  }

  // Use EntityParamGuard to handle missing orgId with friendly UI
  return (
    <EntityParamGuard>
      {canSkipTenant ? (
        renderShell()
      ) : isLoading || !tenant ? (
        <TenantLoadingState variant="loading" title="Preparing tenant" description="Loading tenant context" />
      ) : (
        renderShell()
      )}
    </EntityParamGuard>
  );
};
