function toIso(date) {
  if (!date) return undefined;
  if (date instanceof Date) return date.toISOString();
  return new Date(date).toISOString();
}

module.exports = { toIso };
