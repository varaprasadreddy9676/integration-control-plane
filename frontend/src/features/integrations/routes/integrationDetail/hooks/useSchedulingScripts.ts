import { useCallback } from 'react';
import { getSchedulingExampleScript } from '../utils/schedulingScripts';

interface MessageApi {
  success: (msg: string) => void;
  error: (msg: string) => void;
}

export const useSchedulingScripts = (messageApi: MessageApi) => {
  const handleCopyExampleScript = useCallback((scriptType: 'DELAYED' | 'RECURRING') => {
    const scriptToCopy = getSchedulingExampleScript(scriptType);

    navigator.clipboard.writeText(scriptToCopy).then(() => {
      messageApi.success('Script copied to clipboard');
    }).catch(() => {
      messageApi.error('Failed to copy script to clipboard');
    });
  }, [messageApi]);

  return { handleCopyExampleScript };
};
