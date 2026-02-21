import { useMemo } from 'react';
import { Drawer, Space, Tag, Typography } from 'antd';
import type { ReactNode } from 'react';
import { useDesignTokens, withAlpha, cssVar } from '../../../../../design-system/utils';

interface TransformationDrawerProps {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
}

export const TransformationDrawer = ({ open, onClose, children }: TransformationDrawerProps) => {
  const { spacing, borderRadius } = useDesignTokens();
  const colors = cssVar.legacy;
  const tagTone = (base: string) => ({
    borderRadius: borderRadius.full,
    borderColor: withAlpha(base, 0.4),
    background: withAlpha(base, 0.14),
    color: base,
    fontWeight: 700,
    paddingInline: spacing['2.5'],
    paddingBlock: spacing['0.5']
  });

  return (
    <Drawer
      open={open}
      onClose={onClose}
      width={960}
      styles={{
        body: { padding: 0, background: cssVar.bg.surface },
        header: {
          padding: `${spacing[3]} ${spacing[5]}`,
          borderBottom: `1px solid ${cssVar.border.default}`,
          background: `linear-gradient(120deg, ${withAlpha(colors.primary[200], 0.12)}, ${withAlpha(colors.primary[100], 0.08)})`
        }
      }}
      title={(
        <Space>
          <Typography.Title level={4} style={{ margin: 0 }}>
            Transformation designer
          </Typography.Title>
          <Tag style={tagTone(colors.info[600])}>Focused mode</Tag>
        </Space>
      )}
    >
      <div style={{ padding: spacing[4], overflowY: 'auto', maxHeight: 'calc(100vh - 120px)' }}>
        {children}
      </div>
    </Drawer>
  );
};
