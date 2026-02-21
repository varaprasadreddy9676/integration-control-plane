const hexToRgb = (hex: string) => {
  const normalized = hex.replace('#', '');
  const bigint = Number.parseInt(normalized.length === 3 ? normalized.repeat(2) : normalized, 16);
  const r = (bigint >> 16) & 255;
  const g = (bigint >> 8) & 255;
  const b = bigint & 255;
  return { r, g, b };
};

export const withAlpha = (hex: string, alpha: number) => {
  if (hex.startsWith('var(')) {
    const percent = Math.max(0, Math.min(1, alpha)) * 100;
    return `color-mix(in srgb, ${hex} ${percent}%, transparent)`;
  }
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};
