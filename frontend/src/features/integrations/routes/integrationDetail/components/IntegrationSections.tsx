import { Tabs } from 'antd';
import type { TabsProps } from 'antd';
import { cssVar } from '../../../../../design-system/utils';

interface IntegrationSectionsProps {
  activePanels: string[]; // Still accepts this for compatibility but uses first item as active tab
  onChange: (keys: string[]) => void;
  items: TabsProps['items'];
  spacing?: Record<string, string>;
}

export const IntegrationSections = ({ activePanels, onChange, items, spacing }: IntegrationSectionsProps) => {
  // Use first active panel as the active tab key, default to first tab if empty
  const activeKey = (activePanels && activePanels.length > 0)
    ? activePanels[0]
    : (items && items.length > 0 ? items[0]?.key as string : undefined);

  return (
    <Tabs
      className="integration-sections-tabs"
      activeKey={activeKey}
      onChange={(key) => onChange([key])} // Tabs only supports single active, wrap in array for compatibility
      size="middle"
      tabBarStyle={{ marginBottom: spacing?.[2] ?? 12 }}
      items={items}
      style={{
        background: cssVar.bg.surface,
        borderRadius: '8px',
        padding: 0,
        border: `1px solid ${cssVar.border.default}`,
        boxShadow: 'var(--shadow-sm)'
      }}
    />
  );
};
