import { useEffect } from 'react';

interface UseDeliveryModeSyncParams {
  isMultiAction: boolean;
  setDeliveryModeChoice: (value: 'single' | 'multi') => void;
}

export const useDeliveryModeSync = ({
  isMultiAction,
  setDeliveryModeChoice
}: UseDeliveryModeSyncParams) => {
  useEffect(() => {
    setDeliveryModeChoice(isMultiAction ? 'multi' : 'single');
  }, [isMultiAction, setDeliveryModeChoice]);
};
