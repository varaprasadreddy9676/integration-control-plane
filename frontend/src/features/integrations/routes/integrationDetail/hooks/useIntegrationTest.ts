import { testIntegration } from '../../../../../services/api';

interface UseIntegrationTestParams {
  existingIntegration?: { id?: string };
  missingRequiredMappings: number;
  missingFieldList: string[];
  messageApi: {
    warning: (msg: string) => void;
    loading: (msg: string, duration?: number) => () => void;
    success: (msg: string) => void;
    error: (msg: string) => void;
  };
  requiredRef: React.MutableRefObject<HTMLDivElement | null>;
}

export const useIntegrationTest = ({
  existingIntegration,
  missingRequiredMappings,
  missingFieldList,
  messageApi,
  requiredRef
}: UseIntegrationTestParams) => {
  const handleTest = async () => {
    if (!existingIntegration) return;
    if (missingRequiredMappings > 0) {
      const details = missingFieldList.length ? ` Missing: ${missingFieldList.join(', ')}` : '';
      messageApi.warning(`Please map all required fields (${missingRequiredMappings} remaining) before testing.${details}`);
      requiredRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    const hide = messageApi.loading('Running script test...', 0);
    try {
      await testIntegration(existingIntegration.id as string);
      hide();
      messageApi.success('Test event queued');
    } catch (error) {
      hide();
      const errorMessage = error instanceof Error ? error.message : 'Failed to send test event';
      messageApi.error(errorMessage);
    }
  };

  return { handleTest };
};
