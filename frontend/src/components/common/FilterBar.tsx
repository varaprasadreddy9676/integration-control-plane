import { Grid, Space } from 'antd';
import type { ReactNode } from 'react';
import { cssVar, useDesignTokens, spacingToNumber } from '../../design-system/utils';

interface Props {
  children: ReactNode;
  rightSlot?: ReactNode;
}

export const FilterBar = ({ children, rightSlot }: Props) => {
  const { token, spacing, shadows, zIndex: zIndexTokens } = useDesignTokens();
  const screens = Grid.useBreakpoint();
  const isNarrow = !screens.md;

  return (
    <div
      className="glass-panel"
      style={{
        display: 'flex',
        justifyContent: isNarrow ? 'flex-start' : 'space-between',
        alignItems: isNarrow ? 'flex-start' : 'center',
        flexDirection: isNarrow ? 'column' : 'row',
        marginBottom: spacing[3],
        gap: spacing[2],
        flexWrap: 'wrap',
        padding: `${spacing[2]} ${spacing[3]}`,
        borderRadius: token.borderRadiusLG,
        background: `linear-gradient(135deg, ${cssVar.bg.surface}, ${cssVar.primary[50]})`,
        border: `1px solid ${cssVar.border.default}`,
        position: 'sticky',
        top: isNarrow ? spacing[14] : spacing[16],
        zIndex: zIndexTokens.filterBar,
        boxShadow: shadows.md ?? 'var(--shadow-md)'
      }}
    >
      <Space wrap style={{ flex: 1, minWidth: 260, width: '100%' }}>{children}</Space>
      {rightSlot && (
        <div style={{ display: 'flex', alignItems: 'center', gap: spacingToNumber(spacing[2]), width: isNarrow ? '100%' : 'auto', justifyContent: isNarrow ? 'flex-start' : 'flex-end' }}>
          {rightSlot}
        </div>
      )}
    </div>
  );
};
