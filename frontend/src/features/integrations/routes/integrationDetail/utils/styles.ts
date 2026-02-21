import { withAlpha } from '../../../../../design-system/utils';
import { borderRadius } from '../../../../../design-system/tokens/spacing';

export const createTagTone = (spacing: Record<string, string>) => (base: string) => ({
  borderRadius: borderRadius.full,
  borderColor: withAlpha(base, 0.4),
  background: withAlpha(base, 0.14),
  color: base,
  fontWeight: 700,
  paddingInline: spacing['2.5'],
  paddingBlock: spacing['0.5']
});
