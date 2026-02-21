import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  getIntegrationById,
  getIntegrations,
  getAllEventTypes,
  getEventType,
  getUIConfig
} from '../../../../../services/api';

export const useIntegrationQueries = (id: string | undefined, selectedEventType?: string) => {
  const { data: existingIntegration, isLoading: integrationLoading } = useQuery({
    queryKey: ['integration', id],
    queryFn: () => (id ? getIntegrationById(id) : Promise.resolve(undefined)),
    enabled: Boolean(id && id !== 'new')
  });

  const { data: allIntegrations = [] } = useQuery({ queryKey: ['integrations'], queryFn: getIntegrations });

  const { data: eventTypes = [], isLoading: eventTypesLoading } = useQuery({
    queryKey: ['eventTypes'],
    queryFn: getAllEventTypes
  });

  const { data: uiConfig } = useQuery({
    queryKey: ['uiConfig'],
    queryFn: getUIConfig,
    staleTime: 5 * 60 * 1000
  });

  const eventOptions = useMemo(() => {
    return ['*', ...eventTypes.map((et) => et.eventType)];
  }, [eventTypes]);

  const { data: selectedEventTypeData } = useQuery({
    queryKey: ['eventType', selectedEventType],
    queryFn: () => getEventType(selectedEventType!),
    enabled: Boolean(selectedEventType) && selectedEventType !== '*'
  });

  return {
    existingIntegration,
    integrationLoading,
    allIntegrations,
    eventTypes,
    eventTypesLoading,
    uiConfig,
    eventOptions,
    selectedEventTypeData
  };
};
