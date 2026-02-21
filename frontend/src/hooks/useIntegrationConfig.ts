import { useQuery } from '@tanstack/react-query';
import { getInboundIntegration, getIntegrationById } from '../services/api';
import type { IntegrationMode } from '../features/flowBuilder/state/flowTypes';

export const useIntegrationConfig = (id?: string, mode?: IntegrationMode) => {
  return useQuery({
    queryKey: ['flowbuilder-integration', mode, id],
    queryFn: () => {
      if (!id) {
        return Promise.resolve(undefined);
      }
      if (mode === 'INBOUND') {
        return getInboundIntegration(id);
      }
      return getIntegrationById(id);
    },
    enabled: Boolean(id),
  });
};
