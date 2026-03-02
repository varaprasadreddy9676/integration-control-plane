import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Spin, Typography, Alert } from 'antd';
import { exchangePortalLaunchCredential } from '../../services/api';

/**
 * PortalLaunchRoute
 *
 * Public route: /portal/launch?pid=<profileId>&secret=<linkSecret>
 *
 * This page:
 *   1. Reads pid + secret from query params.
 *   2. Calls POST /auth/portal/launch to exchange them for a short-lived access
 *      token + refresh token (server-side validation, not client-side JWT parsing).
 *   3. Stores the tokens in localStorage and fires auth-storage event.
 *   4. Redirects to the configured embedded view (dashboard or logs).
 *   5. Cleans the pid/secret from the URL so they are not preserved in history.
 *
 * The tokens replace the old "magic JWT in URL" pattern — the launch URL contains
 * only an opaque credential; the actual session token is issued by the server.
 */
export const PortalLaunchRoute = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const pid = params.get('pid');
    const secret = params.get('secret');

    if (!pid || !secret) {
      setError('Invalid portal launch link. Missing required parameters.');
      return;
    }

    // Clean the credentials from the URL immediately before any async work
    // so they are not stored in browser history.
    try {
      const clean = new URL(window.location.href);
      clean.searchParams.delete('pid');
      clean.searchParams.delete('secret');
      window.history.replaceState({}, '', clean.toString());
    } catch {
      // ignore
    }

    let cancelled = false;

    (async () => {
      try {
        const result = await exchangePortalLaunchCredential(pid, secret);

        if (cancelled) return;

        // Store access token + refresh token
        localStorage.setItem('integration_gateway_token', result.accessToken);
        localStorage.setItem('portal_refresh_token', result.refreshToken);
        localStorage.setItem(
          'integration_gateway_user',
          JSON.stringify({
            id: `portal_${result.profile.id}`,
            email: `portal@profile-${result.profile.id}.local`,
            role: result.profile.role,
            orgId: result.profile.orgId,
            isPortalSession: true,
            profileId: result.profile.id,
            allowedIntegrationIds: result.profile.allowedIntegrationIds,
            allowedTags: result.profile.allowedTags,
            allowedViews: result.profile.allowedViews,
          })
        );
        localStorage.setItem('integration_gateway_org_id', String(result.profile.orgId));

        window.dispatchEvent(new Event('auth-storage'));

        // Redirect to the first allowed view
        const allowedViews = result.profile.allowedViews ?? ['dashboard'];
        const firstView = allowedViews.includes('dashboard') ? '/dashboard' : '/logs';
        navigate(`${firstView}?embedded=true`, { replace: true });
      } catch (err: any) {
        if (!cancelled) {
          setError(err?.message || 'Failed to launch portal. The link may be expired or revoked.');
        }
      }
    })();

    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (error) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', padding: 24 }}>
        <div style={{ maxWidth: 480, width: '100%' }}>
          <Alert
            type="error"
            message="Portal access failed"
            description={error}
            showIcon
          />
          <Typography.Paragraph type="secondary" style={{ marginTop: 16, textAlign: 'center' }}>
            Contact your administrator to get a new portal link.
          </Typography.Paragraph>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
      <Spin size="large" tip="Launching portal..." />
    </div>
  );
};
