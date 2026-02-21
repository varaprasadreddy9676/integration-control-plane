import { Tag, Tooltip } from 'antd';
import { LockOutlined, EyeInvisibleOutlined, SafetyOutlined } from '@ant-design/icons';
import { cssVar } from '../../../../../design-system/utils';

interface SecureBadgeProps {
  type?: 'encrypted' | 'masked' | 'secure';
  tooltip?: string;
  size?: 'small' | 'default';
}

export const SecureBadge = ({
  type = 'secure',
  tooltip,
  size = 'small'
}: SecureBadgeProps) => {
  const colors = cssVar.legacy;

  const getBadgeConfig = () => {
    switch (type) {
      case 'encrypted':
        return {
          icon: <LockOutlined />,
          text: 'Encrypted',
          tooltip: tooltip || 'This value is encrypted before storage',
          color: colors.success[500]
        };
      case 'masked':
        return {
          icon: <EyeInvisibleOutlined />,
          text: 'Last 4 shown',
          tooltip: tooltip || 'Only the last 4 characters are shown for security',
          color: cssVar.text.secondary
        };
      case 'secure':
      default:
        return {
          icon: <SafetyOutlined />,
          text: 'Stored securely',
          tooltip: tooltip || 'This sensitive value is encrypted and stored securely',
          color: colors.success[500]
        };
    }
  };

  const config = getBadgeConfig();

  return (
    <Tooltip title={config.tooltip} placement="right">
      <Tag
        icon={config.icon}
        color="default"
        style={{
          fontSize: size === 'small' ? 11 : 12,
          border: `1px solid ${colors.success[200]}`,
          background: colors.success[50],
          color: config.color,
          cursor: 'help',
          marginLeft: 8
        }}
      >
        {config.text}
      </Tag>
    </Tooltip>
  );
};

/**
 * Wrapper component to add secure badge to Form.Item labels
 */
interface SecureLabelProps {
  label: string;
  badgeType?: 'encrypted' | 'masked' | 'secure';
  badgeTooltip?: string;
}

export const SecureLabel = ({ label, badgeType, badgeTooltip }: SecureLabelProps) => (
  <span>
    {label}
    <SecureBadge type={badgeType} tooltip={badgeTooltip} />
  </span>
);
