type SemanticType = 'success' | 'warning' | 'error' | 'info';
type ColorPart = 'bg' | 'border' | 'text';

export const semanticVar = (type: SemanticType, part: ColorPart): string => {
  return `var(--color-${type}-${part})`;
};
