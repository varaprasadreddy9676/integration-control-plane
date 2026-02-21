import { Form } from 'antd';
import type { FormInstance } from 'antd/lib/form';

/**
 * Custom hook to manage all form-related state and watches for integration configuration forms.
 * Centralizes watched values and dirty state management to reduce component complexity.
 *
 * @param form - The Ant Design Form instance from Form.useForm()
 * @returns Object containing all watched field values and state management handlers
 */
export const useIntegrationForm = (form: FormInstance) => {
  // Watch isActive field to disable form when integration is paused
  const isActiveWatchValue = Form.useWatch('isActive', form);

  // Watch scope field to show/hide excluded entities field
  const scopeValue = Form.useWatch('scope', form);

  // Watch excluded entities for real-time UI updates
  const excludedEntityRids = Form.useWatch('excludedEntityRids', form);

  // Watch fields used for completion calculation to avoid accessing form before mount
  const nameValue = Form.useWatch('name', form);
  const eventTypeValue = Form.useWatch('eventType', form);
  const targetUrlValue = Form.useWatch('targetUrl', form);
  const httpMethodValue = Form.useWatch('httpMethod', form);
  const authTypeValue = Form.useWatch('outgoingAuthType', form);
  const timeoutValue = Form.useWatch('timeoutMs', form);
  const retryValue = Form.useWatch('retryCount', form);
  const transformationValue = Form.useWatch('transformation', form);
  const deliveryModeValue = Form.useWatch('deliveryMode', form);

  // Additional watches for complex logic
  const selectedEventType = Form.useWatch('eventType', form);
  const selectedAuthType = Form.useWatch('outgoingAuthType', form);
  const actions = Form.useWatch('actions', form);

  /**
   * Handler to mark form as dirty when values change.
   * Respects create/edit mode conditions.
   *
   * @param isCreate - Whether the form is in create mode
   * @param isEditMode - Whether the form is in edit mode (edit mode view -> edit state)
   */
  return {
    // Watched values - Basic
    isActiveWatchValue,
    scopeValue,
    excludedEntityRids,

    // Watched values - Configuration
    nameValue,
    eventTypeValue,
    targetUrlValue,
    httpMethodValue,
    authTypeValue,
    timeoutValue,
    retryValue,
    transformationValue,
    deliveryModeValue,

    // Watched values - Advanced
    selectedEventType,
    selectedAuthType,
    actions,

    // State management
  };
};
