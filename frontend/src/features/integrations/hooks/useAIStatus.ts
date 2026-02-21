/**
 * Hook to check AI Assistant availability for current entity
 */

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTenant } from '../../../app/tenant-context';
import { getUIConfig } from '../../../services/api';
import { checkAIStatus } from '../../../services/ai-api';

export const useAIStatus = () => {
  const { orgId } = useTenant();

  const { data: uiConfig, isLoading: uiConfigLoading } = useQuery({
    queryKey: ['uiConfig'],
    queryFn: getUIConfig,
    staleTime: 5 * 60 * 1000
  });

  const aiFeatureEnabled = uiConfig?.features?.aiAssistant === true;

  const { data: aiStatus, isLoading: aiStatusLoading, error } = useQuery({
    queryKey: ['ai-status', orgId],
    queryFn: () => checkAIStatus(orgId as number),
    enabled: !!orgId,
    staleTime: 30_000
  });

  const isAvailable = useMemo(() => {
    if (!orgId) return false;
    return !!aiStatus?.available;
  }, [orgId, aiStatus]);

  return {
    isAvailable,
    provider: aiStatus?.provider || '',
    isLoading: uiConfigLoading || aiStatusLoading,
    error: error ?? null
  };
};
