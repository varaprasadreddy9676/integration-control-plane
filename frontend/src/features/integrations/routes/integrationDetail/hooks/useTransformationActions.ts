import { useCallback } from 'react';

interface UseTransformationActionsParams {
  selectedEventType?: string;
  setIsTransformOpen: (value: boolean) => void;
  runPreview: () => void;
  messageApi: { warning: (msg: string) => void };
}

export const useTransformationActions = ({
  selectedEventType,
  setIsTransformOpen,
  runPreview,
  messageApi
}: UseTransformationActionsParams) => {
  const handlePreviewTransformation = useCallback(() => {
    if (!selectedEventType) {
      messageApi.warning('Please select an event type first');
      return;
    }
    runPreview();
  }, [messageApi, runPreview, selectedEventType]);

  const handleOpenTransformDesigner = useCallback(() => {
    if (!selectedEventType) {
      messageApi.warning('Please select an event type before configuring transformations');
      return;
    }
    setIsTransformOpen(true);
  }, [messageApi, selectedEventType, setIsTransformOpen]);

  return { handlePreviewTransformation, handleOpenTransformDesigner };
};
