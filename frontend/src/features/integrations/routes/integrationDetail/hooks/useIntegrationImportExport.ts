import { duplicateIntegration } from '../../../../../services/api';

interface UseIntegrationImportExportParams {
  existingIntegration?: any;
  form: any;
  messageApi: {
    success: (msg: string) => void;
    error: (msg: string) => void;
    warning?: (msg: string) => void;
  };
  isCreate: boolean;
  navigate: (path: string) => void;
  allIntegrations?: any[];
  modal?: any;
  queryClient?: any;
}

export const useIntegrationImportExport = ({
  existingIntegration,
  form,
  messageApi,
  isCreate,
  navigate,
  allIntegrations = [],
  modal,
  queryClient
}: UseIntegrationImportExportParams) => {
  const handleDuplicate = async () => {
    if (!existingIntegration) return;

    const proceedWithDuplicate = async () => {
      try {
        const newIntegration = await duplicateIntegration(existingIntegration.id);
        messageApi.success('Event rule duplicated successfully');
        if (queryClient) {
          queryClient.invalidateQueries({ queryKey: ['integrations'] });
        }
        navigate(`/integrations/${newIntegration.id}`);
      } catch (error) {
        messageApi.error('Failed to duplicate event rule');
        console.error('Duplicate error:', error);
      }
    };

    // Check if there's already a integration with the same event type
    const sameEventTypeIntegrations = allIntegrations.filter(
      (w: any) => w.eventType === existingIntegration.eventType && w.id !== existingIntegration.id
    );

    // Warn if duplicating for the same event type and modal is available
    if (sameEventTypeIntegrations.length > 0 && modal) {
      modal.confirm({
        title: 'Duplicate event rule for same event type?',
        content: `You already have ${sameEventTypeIntegrations.length} integration(s) configured for "${existingIntegration.eventType}". Are you sure you want to create another one for the same event type?`,
        okText: 'Yes, Duplicate',
        cancelText: 'Cancel',
        onOk: proceedWithDuplicate
      });
    } else {
      await proceedWithDuplicate();
    }
  };

  const handleExport = () => {
    try {
      const exportData = isCreate ? form.getFieldsValue() : existingIntegration;

      if (!exportData) {
        messageApi.warning?.('No data to export');
        return;
      }

      const { id, tenantId, entityName, createdAt, updatedAt, ...cleanData } = exportData as any;
      const dataStr = JSON.stringify(cleanData, null, 2);
      const blob = new Blob([dataStr], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `integration-${exportData.name || 'config'}-${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      messageApi.success('Event rule configuration exported');
    } catch (error) {
      messageApi.error('Failed to export event rule configuration');
      console.error('Export error:', error);
    }
  };

  const handleImport = () => {
    try {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'application/json,.json';

      input.onchange = async (e: Event) => {
        const file = (e.target as HTMLInputElement).files?.[0];
        if (!file) return;

        try {
          const text = await file.text();
          const importedData = JSON.parse(text);

          if (!importedData.name || !importedData.eventType) {
            messageApi.error('Invalid event rule configuration file - missing required fields');
            return;
          }

          form.setFieldsValue(importedData);
          messageApi.success('Event rule configuration imported');
        } catch (error) {
          messageApi.error('Failed to parse JSON file - please check the file format');
          console.error('Import parse error:', error);
        }
      };

      input.click();
    } catch (error) {
      messageApi.error('Failed to import event rule configuration');
      console.error('Import error:', error);
    }
  };

  return { handleDuplicate, handleExport, handleImport };
};
