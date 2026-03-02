import { Tag, Tooltip } from 'antd';
import { EyeOutlined } from '@ant-design/icons';
import { useAuth } from '../../app/auth-context';

interface StoredUser {
  isPortalSession?: boolean;
  allowedIntegrationIds?: string[];
  allowedTags?: string[];
  allowedViews?: string[];
  profileId?: string;
}

/**
 * PortalScopeBadge
 *
 * Renders a visible "Scoped View" badge when the current session is a portal
 * session with integration restrictions. Helps users understand they are seeing
 * a limited subset of integrations.
 */
export const PortalScopeBadge = () => {
  const { user } = useAuth();

  const storedUser = (() => {
    try {
      const raw = localStorage.getItem('integration_gateway_user');
      return raw ? (JSON.parse(raw) as StoredUser) : null;
    } catch {
      return null;
    }
  })();

  if (!user?.isPortalSession && !storedUser?.isPortalSession) return null;

  const allowedIds = storedUser?.allowedIntegrationIds ?? [];
  const allowedTags = storedUser?.allowedTags ?? [];
  const allowedViews = storedUser?.allowedViews ?? [];

  const hasIdScope = allowedIds.length > 0;
  const hasTagScope = allowedTags.length > 0;
  const isScoped = hasIdScope || hasTagScope;

  const tooltipParts: string[] = [];
  if (hasIdScope) tooltipParts.push(`${allowedIds.length} integration(s)`);
  if (hasTagScope) tooltipParts.push(`tags: ${allowedTags.join(', ')}`);
  if (allowedViews.length > 0) tooltipParts.push(`views: ${allowedViews.join(', ')}`);

  const tooltipContent = isScoped
    ? `Scoped portal view — ${tooltipParts.join(' · ')}`
    : `Portal session — all org integrations visible · ${tooltipParts[tooltipParts.length - 1] || ''}`;

  return (
    <Tooltip title={tooltipContent}>
      <Tag
        icon={<EyeOutlined />}
        color={isScoped ? 'blue' : 'default'}
        style={{ cursor: 'default', userSelect: 'none' }}
      >
        {isScoped ? 'Scoped View' : 'Portal Session'}
      </Tag>
    </Tooltip>
  );
};
