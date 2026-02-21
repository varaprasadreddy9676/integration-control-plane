/**
 * Z-Index Scale
 * Consistent layering system for the application
 */

export const zIndex = {
  base: 1,
  dropdown: 1000,
  sticky: 100,
  stickyHeader: 110,
  filterBar: 105,
  drawer: 1100,
  modal: 1200,
  popover: 1300,
  tooltip: 1400,
  notification: 1500
} as const;

export type ZIndexToken = typeof zIndex;
