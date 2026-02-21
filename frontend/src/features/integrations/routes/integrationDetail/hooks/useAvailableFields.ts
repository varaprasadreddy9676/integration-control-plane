import { useMemo } from 'react';
import { buildFieldTree, flattenFields } from '../utils/fieldMapping';

export const useAvailableFields = (selectedEventTypeData: any) => {
  const availableFields = useMemo(() => {
    if (!selectedEventTypeData?.fields) return [];
    return flattenFields(selectedEventTypeData.fields);
  }, [selectedEventTypeData]);

  const availableFieldTree = useMemo(() => {
    if (!selectedEventTypeData?.fields) return [];
    return buildFieldTree(selectedEventTypeData.fields);
  }, [selectedEventTypeData]);

  return { availableFields, availableFieldTree };
};
