import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { PortalLaunchRoute } from '../features/auth/PortalLaunchRoute';

const { navigateMock, exchangePortalLaunchCredentialMock } = vi.hoisted(() => ({
  navigateMock: vi.fn(),
  exchangePortalLaunchCredentialMock: vi.fn(),
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => navigateMock,
  };
});

vi.mock('../services/api', () => ({
  exchangePortalLaunchCredential: exchangePortalLaunchCredentialMock,
}));

describe('PortalLaunchRoute', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('redirects to standalone system status when it is the only allowed view', async () => {
    exchangePortalLaunchCredentialMock.mockResolvedValue({
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      expiresIn: '1h',
      profile: {
        id: 'profile-1',
        orgId: 812,
        role: 'VIEWER',
        allowedIntegrationIds: [],
        allowedTags: [],
        allowedViews: ['system_status'],
      },
    });

    render(
      <MemoryRouter initialEntries={['/portal/launch?pid=profile-1&secret=top-secret']}>
        <Routes>
          <Route path="/portal/launch" element={<PortalLaunchRoute />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(exchangePortalLaunchCredentialMock).toHaveBeenCalledWith('profile-1', 'top-secret');
    });

    await waitFor(() => {
      expect(navigateMock).toHaveBeenCalledWith('/status/system?embedded=true', { replace: true });
    });
  });
});
