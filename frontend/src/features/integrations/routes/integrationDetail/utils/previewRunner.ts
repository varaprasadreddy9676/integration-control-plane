export const registerPreviewRunner = (ref: { current?: () => void }) => (fn: () => void) => {
  ref.current = fn;
};
