import { ReactNode } from 'react';
import { cssVar } from '../../../../../design-system/utils';

interface CompactSectionCardProps {
  children: ReactNode;
  spacing: any;
  token: any;
}

/**
 * CompactSectionCard - Minimal wrapper for form sections
 *
 * Provides a light border and padding without the overhead of
 * SectionCard's icon, title, description headers.
 *
 * Use within Collapse.Panel where the panel header already provides
 * the title and description.
 */
export const CompactSectionCard = ({ children, spacing, token }: CompactSectionCardProps) => {
  return (
    <div
      style={{
        border: `1px solid ${cssVar.border.default}`,
        borderRadius: token.borderRadius,
        padding: spacing[4],
        background: cssVar.bg.surface
      }}
    >
      {children}
    </div>
  );
};
