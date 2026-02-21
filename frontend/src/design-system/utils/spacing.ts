export const spacingToNumber = (value: string) => {
  if (value.endsWith('rem')) {
    return parseFloat(value) * 16;
  }
  if (value.endsWith('px')) {
    return parseFloat(value);
  }
  return Number(value);
};
