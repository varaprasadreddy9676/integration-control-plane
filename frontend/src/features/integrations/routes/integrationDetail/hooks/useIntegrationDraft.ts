import { useState } from 'react';
import type { FormInstance } from 'antd';

interface IntegrationDraftOptions {
  isCreate: boolean;
  existingIntegration?: any;
  form: FormInstance;
  messageApi: { info: (content: string) => void };
}

export const useIntegrationDraft = ({
  isCreate,
  existingIntegration,
  form,
  messageApi
}: IntegrationDraftOptions) => {
  const [draftLoaded, setDraftLoaded] = useState(false);
  const DRAFT_KEY = 'integration_draft';

  // Note: Duplicate functionality now handled by backend endpoint
  // No longer using localStorage for duplicates

  const clearDraft = () => {
    try {
      localStorage.removeItem(DRAFT_KEY);
      setDraftLoaded(false);
    } catch (error) {
      console.error('Failed to clear draft:', error);
    }
  };

  const discardDraft = () => {
    clearDraft();
    form.resetFields();
  };

  return { draftLoaded, clearDraft, discardDraft };
};
