import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App } from 'antd';

vi.mock('@monaco-editor/react', () => ({
  default: () => <div data-testid="monaco-editor" />,
}));

vi.mock('../components/common/PageHeader', () => ({
  PageHeader: ({ title }: { title: string }) => <div>{title}</div>,
}));

vi.mock('../utils/navigation', () => ({
  useNavigateWithParams: () => vi.fn(),
}));

vi.mock('../app/tenant-context', () => ({
  useTenant: () => ({
    orgId: 84,
    tenant: { orgId: 84, name: 'Test Org' },
    isLoading: false,
    error: null,
    setManualOrgId: vi.fn(),
    clearOrgId: vi.fn(),
  }),
}));

vi.mock('../design-system/utils', () => ({
  spacingToNumber: (value: string | number) => {
    if (typeof value === 'number') return value;
    const parsed = parseInt(String(value), 10);
    return Number.isNaN(parsed) ? 0 : parsed;
  },
  useDesignTokens: () => ({
    spacing: {
      1: '4px',
      2: '8px',
      3: '12px',
      4: '16px',
      5: '20px',
      6: '24px',
      8: '32px',
    },
  }),
  cssVar: {
    legacy: {
      primary: { 600: '#1677ff' },
      success: { 600: '#52c41a' },
      warning: { 600: '#faad14' },
      info: { 50: '#f0f5ff', 200: '#adc6ff', 600: '#1677ff', 700: '#0958d9' },
    },
    bg: { base: '#fff', surface: '#fff' },
    border: { default: '#eee' },
    text: { secondary: '#666' },
  },
}));

const mockApi = {
  getInboundIntegration: vi.fn(),
  createInboundIntegration: vi.fn(),
  updateInboundIntegration: vi.fn(),
  getUIConfig: vi.fn(),
  testInboundRuntime: vi.fn(),
  listSenderProfiles: vi.fn(),
};

vi.mock('../services/api', () => mockApi);

describe('Inbound Integration Rate Limits Form', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApi.getUIConfig.mockResolvedValue({});
    mockApi.updateInboundIntegration.mockResolvedValue({ success: true });
    mockApi.listSenderProfiles.mockResolvedValue([]);
  });

  it('persists and round-trips rateLimits from edit form to update payload', async () => {
    mockApi.getInboundIntegration.mockResolvedValue({
      _id: '507f1f77bcf86cd799439011',
      name: 'Lab Inbound',
      type: 'lab-results',
      orgId: 84,
      inboundAuthType: 'NONE',
      inboundAuthConfig: {},
      targetUrl: 'https://hims.example.com/labs',
      httpMethod: 'POST',
      timeout: 10000,
      retryCount: 3,
      contentType: 'application/json',
      streamResponse: false,
      requestTransformation: { mode: 'SCRIPT', script: '' },
      responseTransformation: { mode: 'SCRIPT', script: '' },
      rateLimits: {
        enabled: true,
        maxRequests: 77,
        windowSeconds: 90,
      },
    });

    const { InboundIntegrationDetailRoute } = await import('../features/inbound-integrations/routes/InboundIntegrationDetailRoute');

    const qc = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    });

    render(
      <QueryClientProvider client={qc}>
        <App>
          <MemoryRouter initialEntries={["/inbound-integrations/507f1f77bcf86cd799439011"]}>
            <Routes>
              <Route path="/inbound-integrations/:id" element={<InboundIntegrationDetailRoute />} />
            </Routes>
          </MemoryRouter>
        </App>
      </QueryClientProvider>
    );

    await waitFor(() => {
      expect(screen.getByText('Save Changes')).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(screen.getByDisplayValue('Lab Inbound')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Save Changes'));

    await waitFor(() => {
      expect(mockApi.updateInboundIntegration).toHaveBeenCalledTimes(1);
    });

    const updatePayload = mockApi.updateInboundIntegration.mock.calls[0][1];
    expect(updatePayload.rateLimits).toEqual({
      enabled: true,
      maxRequests: 77,
      windowSeconds: 90,
    });
  });
});
