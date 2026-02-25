import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useLocation } from 'react-router-dom';
import { useNavigateWithParams } from '../../../utils/navigation';
import {
  App,
  Form,
  Space,
  Typography,
  Collapse,
  Skeleton
} from 'antd';
import { useQueryClient } from '@tanstack/react-query';
import { createIntegration, updateIntegration, rotateIntegrationSecret, removeIntegrationSecret } from '../../../services/api';
import type { IntegrationConfig } from '../../../mocks/types';
import { IntegrationSigningSection } from '../components/IntegrationSigningSection';
import { useDesignTokens, withAlpha, spacingToNumber, cssVar } from '../../../design-system/utils';
import { useTenant } from '../../../app/tenant-context';
import { useIntegrationForm } from '../hooks';
import { FormAlerts } from '../components/common';
import { defaultScript } from './integrationDetail/utils/constants';
import { formatScriptForDisplay } from './integrationDetail/utils/formatting';
import { useAvailableFields } from './integrationDetail/hooks/useAvailableFields';
import { useIntegrationDraft } from './integrationDetail/hooks/useIntegrationDraft';
import { useIntegrationKeyboardShortcuts } from './integrationDetail/hooks/useIntegrationKeyboardShortcuts';
import { useIntegrationQueries } from './integrationDetail/hooks/useIntegrationQueries';
import { useTransformationActions } from './integrationDetail/hooks/useTransformationActions';
import { useMultiActionValidation } from './integrationDetail/hooks/useMultiActionValidation';
import { useAutoExpandSections } from './integrationDetail/hooks/useAutoExpandSections';
import { useDeliveryModeSync } from './integrationDetail/hooks/useDeliveryModeSync';
import { useSamplePayload } from './integrationDetail/hooks/useSamplePayload';
import { useDeliveryModeSwitch } from './integrationDetail/hooks/useDeliveryModeSwitch';
import { useIntegrationTest } from './integrationDetail/hooks/useIntegrationTest';
import { useIntegrationImportExport } from './integrationDetail/hooks/useIntegrationImportExport';
import { IntegrationPageHeader } from './integrationDetail/components/IntegrationPageHeader';
import { TransformationDrawer } from './integrationDetail/components/TransformationDrawer';
import { ReviewConfirmDrawer } from './integrationDetail/components/ReviewConfirmDrawer';
import { buildIntegrationSectionItems } from './integrationDetail/components/IntegrationSectionsContent';
import { IntegrationFormContainer } from './integrationDetail/components/IntegrationFormContainer';
import { IntegrationFormBody } from './integrationDetail/components/IntegrationFormBody';
import { TransformationDesigner } from './integrationDetail/components/TransformationDesigner';
import { buildPreviewContext } from './integrationDetail/utils/previewContext';
import { registerPreviewRunner } from './integrationDetail/utils/previewRunner';
import { createTagTone } from './integrationDetail/utils/styles';
import { useSchedulingScripts } from './integrationDetail/hooks/useSchedulingScripts';
import { validateScheduling } from './integrationDetail/utils/validateScheduling';
import { getFormInitialValues } from './integrationDetail/utils/formDefaults';
import { getSectionCompletion } from './integrationDetail/utils/sectionCompletion';

// Helper component for action transformation preview
export const IntegrationDetailRoute = () => {
  const { spacing, token } = useDesignTokens();
  const colors = cssVar.legacy;
  const { tenant } = useTenant();
  const { id } = useParams();
  const location = useLocation();
  const navigate = useNavigateWithParams();
  const queryClient = useQueryClient();
  const isCreate = !id || id === 'new';
  const [form] = Form.useForm();
  const [transformationTab, setTransformationTab] = useState<'SIMPLE' | 'SCRIPT'>('SIMPLE');
  const [scriptValue, setScriptValue] = useState(defaultScript);
  const { message: messageApi, modal } = App.useApp();
  const [mappingState, setMappingState] = useState<{ mappings: any[]; staticFields: any[] }>({ mappings: [], staticFields: [] });

  // Watch form fields to trigger re-render and unlock tabs dynamically
  const formName = Form.useWatch('name', form);
  const formEventType = Form.useWatch('eventType', form);
  const formTargetUrl = Form.useWatch('targetUrl', form);

  // Use custom integration form hook for all form state and watches
  const formState = useIntegrationForm(form);

  const [schedulingScriptValidation, setSchedulingScriptValidation] = useState<{ status: 'idle' | 'success' | 'error'; message?: string }>({ status: 'idle' });
  const [isValidatingScript, setIsValidatingScript] = useState(false);
  const [missingRequiredMappings, setMissingRequiredMappings] = useState(0);
  const [multiActionValidationErrors, setMultiActionValidationErrors] = useState<string[]>([]);

  // Track saving state (prevent double-submission)
  const [isSaving, setIsSaving] = useState(false);

  // View/Edit mode state (professional enterprise pattern)
  const [isEditMode, setIsEditMode] = useState(isCreate); // Create mode = always editable, Edit mode = start in view

  // Collapsible sections state
  const [activePanels, setActivePanels] = useState<string[]>(['configuration']);

  // Reset component state when navigating between different integrations or create/edit modes
  useEffect(() => {
    // Reset all state when id changes (e.g., from /integrations/123 to /integrations/new)
    const currentIsCreate = !id || id === 'new';
    setIsEditMode(currentIsCreate);

    // Reset form and state
    form.resetFields();
    setTransformationTab('SIMPLE');
    setScriptValue(defaultScript);
    setMappingState({ mappings: [], staticFields: [] });
    setActivePanels(currentIsCreate ? ['configuration'] : []);
    setMultiActionMode(false);
    setSchedulingScriptValidation({ status: 'idle' });
    setIsValidatingScript(false);
    setMissingRequiredMappings(0);
    setMultiActionValidationErrors([]);
    setSampleInput('');
    setSampleOutput('Awaiting preview…');
    setLastPreviewMeta(undefined);
    setDeliveryModeChoice('single');
  }, [id]);

  const [sampleInput, setSampleInput] = useState<string>('');
  const [sampleOutput, setSampleOutput] = useState<string>('Awaiting preview…');
  const [isTransformOpen, setIsTransformOpen] = useState(false);
  const [isSigningModalOpen, setIsSigningModalOpen] = useState(false);
  const [isReviewDrawerOpen, setIsReviewDrawerOpen] = useState(false);
  const [lastPreviewMeta, setLastPreviewMeta] = useState<{ durationMs?: number; status?: number } | undefined>(undefined);
  const runPreviewRef = useRef<() => void>();
  const requiredRef = useRef<HTMLDivElement | null>(null);
  const prevSingleConfigRef = useRef<{ targetUrl?: string; httpMethod?: string } | null>(null);
  const prevSingleTransformRef = useRef<{ mode: 'SIMPLE' | 'SCRIPT'; script?: string; mappings?: any[]; staticFields?: any[] } | null>(null);
  const [deliveryModeChoice, setDeliveryModeChoice] = useState<'single' | 'multi'>('single');
  const [multiActionMode, setMultiActionMode] = useState(false);

  // CleverTap template helper
  const loadCleverTapTemplate = () => {
    const cleverTapActions = [
      {
        name: 'Profile Upload',
        targetUrl: 'https://api.clevertap.com/1/upload',
        httpMethod: 'POST',
        condition: 'eventType === "PATIENT_REGISTRATION"',
        transformationMode: 'SCRIPT',
        transformation: {
          script: `function transform(payload, context) {
  // Resolve identity: MRN → Phone → Email fallback
  const identity = payload.patientMRN || payload.patientPhone || payload.patientEmail || 'unknown';

  // Format phone with +91 prefix
  let phone = payload.patientPhone || '';
  if (phone && !phone.startsWith('+91')) {
    phone = phone.startsWith('91') ? '+' + phone : '+91' + phone;
  }

  return {
    d: [{
      identity: identity,
      type: 'profile',
      profileData: {
        Name: payload.patientName,
        MRN: payload.patientMRN,
        Phone: phone,
        Email: payload.patientEmail,
        Address: payload.patientAddress,
        Age: payload.patientAge,
        Gender: payload.patientGender,
        RegistrationDate: new Date().toISOString()
      }
    }]
  };
}`
        }
      },
      {
        name: 'Event Upload',
        targetUrl: 'https://api.clevertap.com/1/upload',
        httpMethod: 'POST',
        transformationMode: 'SCRIPT',
        transformation: {
          script: `function transform(payload, context) {
  const identity = payload.patientMRN || payload.patientPhone || payload.patientEmail || 'unknown';

  return {
    d: [{
      identity: identity,
      type: 'event',
      evtName: 'Patient Registered',
      evtData: {
        patientMRN: payload.patientMRN,
        registrationDate: new Date().toISOString(),
        orgName: context.entityName || 'Organization',
        source: 'source-system'
      }
    }]
  };
}`
        }
      }
    ];

    form.setFieldsValue({
      actions: cleverTapActions,
      outgoingAuthType: 'CUSTOM_HEADERS',
      outgoingAuthConfig: {
        headers: [
          { key: 'X-CleverTap-Account-Id', value: 'YOUR_ACCOUNT_ID' },
          { key: 'X-CleverTap-Passcode', value: 'YOUR_PASSCODE' }
        ]
      },
      httpMethod: 'POST',
      timeoutMs: 30000,
      retryCount: 3
    });

    messageApi.success('CleverTap template loaded! Update credentials and event type as needed.');
  };

  const {
    existingIntegration,
    integrationLoading,
    allIntegrations,
    eventTypes,
    eventTypesLoading,
    uiConfig,
    eventOptions,
    selectedEventTypeData
  } = useIntegrationQueries(id, formState.selectedEventType);

  // Compute isActive value with fallback (form value takes precedence, then DB value, then default to true)
  const isActiveValue = formState.isActiveWatchValue !== undefined ? formState.isActiveWatchValue : (existingIntegration?.isActive ?? true);
  const isDetailLoading = !isCreate && integrationLoading && !existingIntegration;
  const missingFieldList = useMemo(
    () =>
      (mappingState.mappings as any[])
        .filter((m: any) => ['patient_id', 'bill_id', 'event_type', 'source'].includes(m.targetField) && !m.sourceField)
        .map((m: any) => m.targetField),
    [mappingState.mappings]
  );
  const transformationHasContent = useMemo(() => {
    if (transformationTab === 'SCRIPT') {
      return Boolean(scriptValue && scriptValue.trim().length > 0);
    }
    const mappingsCount = mappingState.mappings?.length ?? 0;
    const staticFieldsCount = mappingState.staticFields?.length ?? 0;
    return mappingsCount > 0 || staticFieldsCount > 0;
  }, [mappingState.mappings, mappingState.staticFields, scriptValue, transformationTab]);

  // Determine if this is a multi-action integration
  const hasActions = Array.isArray(formState.actions) && formState.actions.length > 0;
  const isMultiAction = multiActionMode;

  useDeliveryModeSync({ isMultiAction, setDeliveryModeChoice });

  // Available fields for transformation (dynamic based on selected event type)
  // Transform backend schema to UI format
  const { availableFields, availableFieldTree } = useAvailableFields(selectedEventTypeData);

  useSamplePayload({
    selectedEventType: formState.selectedEventType,
    selectedEventTypeData,
    setSampleInput
  });

  // Dynamic form initial values based on server config
  const formInitialValues = useMemo(() => getFormInitialValues(uiConfig), [uiConfig]);

  const tagTone = createTagTone(spacing);


  useEffect(() => {
    if (existingIntegration) {
      setMultiActionMode(Boolean(existingIntegration.actions && existingIntegration.actions.length > 0));
      // Transform CUSTOM_HEADERS object format to array format for Form.List
      let outgoingAuthConfig = existingIntegration.outgoingAuthConfig;
      if (existingIntegration.outgoingAuthType === 'CUSTOM_HEADERS' && existingIntegration.outgoingAuthConfig?.headers) {
        const headersObject = existingIntegration.outgoingAuthConfig.headers;
        if (typeof headersObject === 'object' && !Array.isArray(headersObject)) {
          const headersArray = Object.entries(headersObject).map(([key, value]) => ({
            key,
            value
          }));
          outgoingAuthConfig = { headers: headersArray };
        }
      }

      const normalizedTransformation = existingIntegration.transformation
        ? {
            ...existingIntegration.transformation,
            script: formatScriptForDisplay((existingIntegration.transformation as any).script)
          }
        : existingIntegration.transformation;

      const normalizedActions = existingIntegration.actions?.map((action) => ({
        ...action,
        transformation: action?.transformation
          ? {
              ...action.transformation,
              script: formatScriptForDisplay((action.transformation as any).script)
            }
          : action.transformation
      }));

      form.setFieldsValue({
        ...existingIntegration,
        outgoingAuthConfig,
        auth: {},
        transformationMode: existingIntegration.transformationMode,
        transformation: normalizedTransformation,
        actions: normalizedActions
      });
      setTransformationTab(existingIntegration.transformationMode);
      if (existingIntegration.transformation) {
        setMappingState({
          mappings: (existingIntegration.transformation as any).mappings ?? [],
          staticFields: (existingIntegration.transformation as any).staticFields ?? []
        });
        if ((existingIntegration.transformation as any).script) {
          setScriptValue(formatScriptForDisplay((existingIntegration.transformation as any).script));
        }
      }
    }
  }, [existingIntegration, form]);

  useEffect(() => {
    if (hasActions) {
      setMultiActionMode(true);
    }
  }, [hasActions]);

  // Pre-fill eventType from URL query parameter when creating new integration
  useEffect(() => {
    if (isCreate && location.search) {
      const params = new URLSearchParams(location.search);
      const eventTypeParam = params.get('eventType');

      if (eventTypeParam) {
        form.setFieldsValue({
          eventType: eventTypeParam
        });
      }
    }
  }, [isCreate, location.search, form]);

  // Auto-fill valid scheduling scripts when delivery mode changes
  useEffect(() => {
    const currentScript = form.getFieldValue(['schedulingConfig', 'script']);

    // Only set default if script is empty or undefined
    if (formState.deliveryModeValue && formState.deliveryModeValue !== 'IMMEDIATE' && !currentScript) {
      const defaultScript = formState.deliveryModeValue === 'DELAYED'
        ? `// Example: Send 24 hours before appointment
const appointmentTime = parseDate(event.appointmentDateTime);
const scheduledTime = subtractHours(appointmentTime, 24);
toTimestamp(scheduledTime);`
        : `// Example: Send every 6 hours, 3 times starting 1 hour from now
const firstTime = addHours(now(), 1);
({
  firstOccurrence: toTimestamp(firstTime),
  intervalMs: 6 * 60 * 60 * 1000,
  maxOccurrences: 3
});`;

      form.setFieldsValue({
        schedulingConfig: {
          ...form.getFieldValue('schedulingConfig'),
          script: defaultScript
        }
      });
    }
  }, [formState.deliveryModeValue, form]);

  useMultiActionValidation({
    form,
    actions: formState.actions,
    setErrors: setMultiActionValidationErrors
  });

  const { handleCopyExampleScript } = useSchedulingScripts(messageApi);

  const handleValidateSchedulingScript = async () => {
    await validateScheduling({
      script: form.getFieldValue(['schedulingConfig', 'script']),
      deliveryMode: form.getFieldValue('deliveryMode'),
      timezone: form.getFieldValue(['schedulingConfig', 'timezone']) || 'UTC',
      eventType: form.getFieldValue('eventType'),
      setSchedulingScriptValidation,
      setIsValidatingScript,
      messageApi
    });
  };


  const { handlePreviewTransformation, handleOpenTransformDesigner } = useTransformationActions({
    selectedEventType: formState.selectedEventType,
    setIsTransformOpen,
    runPreview: () => runPreviewRef.current?.(),
    messageApi
  });

  const handleSubmit = async (values: any) => {
    setIsSaving(true);
    try {
      const urlPattern = /^https?:\/\/.+/i;
    const isMultiActionSubmit = isMultiAction;
    const formActions = form.getFieldValue('actions');
    const resolvedActions = (Array.isArray(values.actions) && values.actions.length > 0)
      ? values.actions
      : (Array.isArray(formActions) ? formActions : []);

    // Validate single-action integration
    if (!isMultiActionSubmit) {
      if (!values.targetUrl || !urlPattern.test(values.targetUrl)) {
        messageApi.error('Enter a valid HTTP/HTTPS target URL.');
        return;
      }
    }

    // Validate multi-action integration
    if (isMultiActionSubmit) {
      if (!resolvedActions || !Array.isArray(resolvedActions) || resolvedActions.length === 0) {
        messageApi.error('Multi-action event rule must have at least one action. Either add an action or use single-action mode.');
        return;
      }
      // Check if all actions have required fields
      for (let i = 0; i < resolvedActions.length; i++) {
        const action = resolvedActions[i];

        // Validate action name
        if (!action.name || !action.name.trim()) {
          messageApi.error(`Action ${i + 1}: Name is required`);
          return;
        }

        // Validate target URL
        if (!action.targetUrl || !urlPattern.test(action.targetUrl)) {
          messageApi.error(`Action ${i + 1} (${action.name}): Valid target URL is required`);
          return;
        }

        // Validate transformation mode
        const actionMode = action.transformationMode || 'SCRIPT';

        if (actionMode === 'SCRIPT') {
          // Validate SCRIPT mode has script
          if (!action.transformation || !action.transformation.script || !action.transformation.script.trim()) {
            messageApi.error(`Action ${i + 1} (${action.name}): Transformation script is required`);
            return;
          }
        } else if (actionMode === 'SIMPLE') {
          // Validate SIMPLE mode has at least one mapping or static field
          const hasMappings = action.transformation?.mappings && action.transformation.mappings.length > 0;
          const hasStaticFields = action.transformation?.staticFields && action.transformation.staticFields.length > 0;

          if (!hasMappings && !hasStaticFields) {
            messageApi.error(`Action ${i + 1} (${action.name}): Add at least one field mapping or static field`);
            return;
          }

          // Validate that mappings have both target and source fields
          if (hasMappings) {
            for (let j = 0; j < action.transformation.mappings.length; j++) {
              const mapping = action.transformation.mappings[j];
              if (!mapping.targetField || !mapping.sourceField) {
                messageApi.error(`Action ${i + 1} (${action.name}): Field mapping ${j + 1} must have both target and source fields`);
                return;
              }
            }
          }
        }
      }

    }

    if (values.timeoutMs < 500 || values.timeoutMs > 60000) {
      messageApi.error('Timeout must be between 500 and 60000 ms.');
      return;
    }
    if (values.retryCount < 0 || values.retryCount > 10) {
      messageApi.error('Retry count must be between 0 and 10.');
      return;
    }
    // Only validate required mappings for SIMPLE mode (not SCRIPT or multi-action)
    if (!isMultiActionSubmit && transformationTab === 'SIMPLE' && missingRequiredMappings > 0) {
      const details = missingFieldList.length ? ` Missing: ${missingFieldList.join(', ')}` : '';
      messageApi.warning(`Please map all required fields (${missingRequiredMappings} remaining).${details}`);
      requiredRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    try {
      // Transform CUSTOM_HEADERS array format to object format
      let outgoingAuthConfig = values.outgoingAuthConfig;
      if (values.outgoingAuthType === 'CUSTOM_HEADERS' && Array.isArray(values.outgoingAuthConfig?.headers)) {
        const headersObject: Record<string, string> = {};
        values.outgoingAuthConfig.headers.forEach((header: any) => {
          if (header.key && header.value) {
            headersObject[header.key] = header.value;
          }
        });
        outgoingAuthConfig = { headers: headersObject };
      }

      // Build the payload based on single-action or multi-action mode
      const payload: IntegrationConfig = {
        id: existingIntegration?.id ?? `wh_${Date.now()}`,
        name: values.name,
        eventType: values.eventType,
        tenantId: existingIntegration?.tenantId ?? 100,
        entityName: existingIntegration?.entityName ?? 'Current Entity',
        scope: values.scope,
        httpMethod: values.httpMethod,
        outgoingAuthType: values.outgoingAuthType,
        outgoingAuthConfig,
        isActive: values.isActive,
        timeoutMs: values.timeoutMs,
        retryCount: values.retryCount,
        transformationMode: transformationTab,
        updatedAt: new Date().toISOString()
      } as IntegrationConfig;

      // Add fields based on mode
      if (isMultiActionSubmit) {
        // Multi-action integration: include actions array
        payload.actions = resolvedActions ?? [];
        // targetUrl is optional for multi-action but backend might still expect it
        payload.targetUrl = (resolvedActions ?? [])[0]?.targetUrl || 'https://placeholder.com';
      } else {
        // Single-action integration: include targetUrl and transformation
        payload.targetUrl = values.targetUrl;
        payload.transformation = {
          mode: transformationTab,
          mappings: (mappingState.mappings as any[]),
          staticFields: (mappingState.staticFields as any[]),
          script: scriptValue
        };
      }

      if (isCreate) {
        await createIntegration(payload);
        clearDraft(); // Clear auto-saved draft after successful creation
        messageApi.success('Event rule created');
        queryClient.invalidateQueries({ queryKey: ['integrations'] });
        navigate('/integrations');
      } else if (existingIntegration) {
        await updateIntegration(existingIntegration.id, payload);
        messageApi.success('Event rule updated');
        // Exit edit mode and return to view mode (professional enterprise pattern)
        setIsEditMode(false);
        setActivePanels([]);
        queryClient.invalidateQueries({ queryKey: ['integrations'] });
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to save event rule';
      messageApi.error(errorMessage);
    }
    } catch (validationError) {
      // Validation errors (early returns) will hit this catch
      // Error message already shown by validation logic
    } finally {
      setIsSaving(false);
    }
  };

  const { handleTest } = useIntegrationTest({
    existingIntegration,
    missingRequiredMappings,
    missingFieldList,
    messageApi,
    requiredRef
  });

  // View/Edit mode handlers
  const handleEnterEditMode = () => {
    setIsEditMode(true);
    // Expand all panels in edit mode for easier editing
    const panels = ['configuration', 'authentication', 'delivery'];
    if (isMultiAction) {
      panels.splice(1, 0, 'multiAction');
    } else {
      panels.push('transformation');
    }
    setActivePanels(panels);
  };

  const handleCancelEdit = () => {
    if (form.isFieldsTouched()) {
      modal.confirm({
        title: 'Discard unsaved changes?',
        content: 'You have unsaved changes. Discarding will reset all fields to their last saved values.',
        okText: 'Discard changes',
        okButtonProps: { danger: true },
        cancelText: 'Keep editing',
        onOk: () => {
          form.resetFields();
          setIsEditMode(false);
          setActivePanels([]);
        }
      });
    } else {
      form.resetFields();
      setIsEditMode(false);
      setActivePanels([]);
    }
  };

  // Collapse/Expand all handlers
  const handleExpandAll = () => {
    const allPanels = ['configuration', 'authentication', 'delivery'];
    if (isMultiAction) {
      allPanels.splice(1, 0, 'multiAction');
    } else {
      allPanels.push('transformation');
    }
    setActivePanels(allPanels);
  };

  const handleCollapseAll = () => {
    setActivePanels([]);
  };

  // Review & Confirm handlers
  const handleOpenReview = () => {
    setIsReviewDrawerOpen(true);
  };

  const handleConfirmReview = async (action: 'activate' | 'draft') => {
    // Set the isActive field based on the action choice
    form.setFieldsValue({ isActive: action === 'activate' });

    // Submit the form
    await form.submit();

    // Close the drawer after successful submission
    if (!isSaving) {
      setIsReviewDrawerOpen(false);
    }
  };

  const { handleDuplicate, handleExport, handleImport } = useIntegrationImportExport({
    existingIntegration,
    form,
    messageApi,
    isCreate,
    navigate,
    allIntegrations,
    modal,
    queryClient
  });

  // Calculate section completion for collapsible panels
  const sectionCompletion = useMemo(
    () =>
      getSectionCompletion({
        nameValue: formState.nameValue,
        eventTypeValue: formState.eventTypeValue,
        targetUrlValue: formState.targetUrlValue,
        httpMethodValue: formState.httpMethodValue,
        scopeValue: formState.scopeValue,
        authTypeValue: formState.authTypeValue,
        timeoutValue: formState.timeoutValue,
        retryValue: formState.retryValue,
        isMultiAction,
        hasActions,
        multiActionValidationErrors,
        transformationHasContent
      }),
    [
      formState.nameValue,
      formState.eventTypeValue,
      formState.targetUrlValue,
      formState.httpMethodValue,
      formState.scopeValue,
      formState.authTypeValue,
      formState.timeoutValue,
      formState.retryValue,
      isMultiAction,
      hasActions,
      multiActionValidationErrors,
      transformationHasContent
    ]
  );

  const { handleSwitchMode } = useDeliveryModeSwitch({
    form,
    deliveryModeChoice,
    isMultiAction,
    transformationTab,
    scriptValue,
    mappingState,
    setDeliveryModeChoice,
    setMultiActionMode,
    setActivePanels,
    prevSingleConfigRef,
    prevSingleTransformRef,
    modal
  });

  useAutoExpandSections({
    isCreate,
    activePanels,
    isMultiAction,
    sectionCompletion,
    setActivePanels
  });

  useIntegrationKeyboardShortcuts({
    isCreate,
    isEditMode,
    form,
    onCancelEdit: handleCancelEdit
  });

  const { clearDraft, discardDraft } = useIntegrationDraft({
    isCreate,
    existingIntegration,
    form,
    messageApi
  });

  // Auto-save draft to localStorage - DISABLED (not useful without alert banner)
  // useEffect(() => {
  //   if (!isCreate) return; // Only auto-save in create mode

  //   const timeoutId = setTimeout(() => {
  //     if (isDirty) {
  //       try {
  //         const formValues = form.getFieldsValue();

  //         // Include additional state that's not in the form
  //         const draftData = {
  //           ...formValues,
  //           _meta: {
  //             transformationTab,
  //             mappingState,
  //             scriptValue,
  //             savedAt: new Date().toISOString()
  //           }
  //         };

  //         const serialized = JSON.stringify(draftData);

  //         // Check if data is too large (localStorage limit is ~5-10MB depending on browser)
  //         if (serialized.length > 5000000) { // 5MB limit
  //           console.warn('Draft data too large, skipping auto-save');
  //           return;
  //         }

  //         localStorage.setItem(DRAFT_KEY, serialized);
  //       } catch (error) {
  //         // Handle quota exceeded error gracefully
  //         if (error instanceof Error && error.name === 'QuotaExceededError') {
  //           console.warn('localStorage quota exceeded, clearing old drafts');
  //           try {
  //             localStorage.removeItem(DRAFT_KEY);
  //           } catch (e) {
  //             // If we can't even clear, localStorage might be disabled
  //             console.error('localStorage appears to be disabled');
  //           }
  //         } else {
  //           console.error('Failed to save draft:', error);
  //         }
  //       }
  //     }
  //   }, 2000); // Debounce for 2 seconds

  //   return () => clearTimeout(timeoutId);
  // }, [isCreate, isDirty, form, DRAFT_KEY, transformationTab, mappingState, scriptValue]);

  return (
    <div style={{ paddingBottom: spacing[12] }}>
      <div style={{ maxWidth: 1400, margin: '0 auto' }}>
        <IntegrationFormContainer
          form={form}
          initialValues={formInitialValues}
          onFinish={handleSubmit}
        >
          {isDetailLoading ? (
            <div style={{ padding: `${spacing[6]} 0 ${spacing[4]}` }}>
              <Skeleton.Input active size="large" style={{ width: 320, height: 32, marginBottom: spacing[2] }} />
              <Skeleton.Input active size="small" style={{ width: 420, height: 18, marginBottom: spacing[3] }} />
              <div style={{ display: 'flex', gap: spacing[2] }}>
                <Skeleton.Button active size="small" />
                <Skeleton.Button active size="small" />
                <Skeleton.Button active size="small" />
              </div>
            </div>
          ) : (
            <IntegrationPageHeader
              isCreate={isCreate}
              isEditMode={isEditMode}
              existingIntegration={existingIntegration}
              isMultiAction={isMultiAction}
              deliveryModeValue={formState.deliveryModeValue}
              transformationTab={transformationTab}
              isActiveValue={isActiveValue}
              isSaving={isSaving}
              spacing={spacing}
              colors={colors}
              onSave={() => form.submit()}
              onTest={handleTest}
              onCancelEdit={handleCancelEdit}
              onEnterEditMode={handleEnterEditMode}
              onDuplicate={handleDuplicate}
              onExport={handleExport}
              onImport={handleImport}
            />
          )}
          {isDetailLoading ? (
            <div style={{ padding: `${spacing[4]} 0` }}>
              <Skeleton active paragraph={{ rows: 10 }} />
            </div>
          ) : (
            <IntegrationFormBody
              isCreate={isCreate}
              isEditMode={isEditMode}
              isMultiAction={isMultiAction}
              isSaving={isSaving}
              isActiveValue={isActiveValue}
              canTest={!isCreate}
              canSave={
                isMultiAction
                  ? (multiActionValidationErrors.length === 0 && hasActions)
                  : (missingRequiredMappings === 0)
              }
              spacing={spacing}
              token={token}
              colors={colors}
              deliveryModeChoice={deliveryModeChoice}
              onChangeDeliveryMode={handleSwitchMode}
              onExpandAll={handleExpandAll}
              onCollapseAll={handleCollapseAll}
              activePanels={activePanels}
              onPanelsChange={(keys) => setActivePanels(keys)}
              onSave={() => form.submit()}
              onTest={handleTest}
              onCancel={() => {
                if (form.isFieldsTouched()) {
                  modal.confirm({
                    title: isCreate ? 'Discard draft?' : 'Discard unsaved changes?',
                    content: isCreate
                      ? 'Your draft will be lost. Are you sure you want to leave?'
                      : 'You have unsaved changes. Discarding will reset all fields to their last saved values.',
                    okText: isCreate ? 'Discard draft' : 'Discard changes',
                    okButtonProps: { danger: true },
                    cancelText: 'Keep editing',
                    onOk: () => {
                      if (isEditMode) {
                        form.resetFields();
                        setIsEditMode(false);
                        setActivePanels([]);
                      } else {
                        navigate('/integrations');
                      }
                    }
                  });
                } else {
                  if (isEditMode) {
                    form.resetFields();
                    setIsEditMode(false);
                    setActivePanels([]);
                  } else {
                    navigate('/integrations');
                  }
                }
              }}
              saveText={isCreate ? 'Create Event Rule' : 'Save Changes'}
              testText="Test Event Rule"
              formAlerts={
                <FormAlerts
                  isDisabled={isActiveValue === false}
                  disabledReason="This integration is paused. Enable it to process events."
                  spacing={spacing}
                />
              }
              missingRequiredCount={isMultiAction ? 0 : missingRequiredMappings}
              validationErrors={multiActionValidationErrors}
              onActivate={() => {
                form.setFieldsValue({ isActive: true });
                form.submit();
              }}
              sectionItems={buildIntegrationSectionItems({
                form,
                tenant,
                eventTypes,
                uiConfig,
                isMultiAction,
                isCreate,
                isEditMode,
                eventTypesLoading,
                scopeValue: formState.scopeValue,
                excludedEntityRids: formState.excludedEntityRids,
                actionsCount: formState.actions?.length ?? 0,
                existingActionsCount: existingIntegration?.actions?.length ?? 0,
                selectedEventTypeData,
                availableFields,
                spacing,
                token,
                colors,
                loadCleverTapTemplate,
                multiActionValidationErrors,
                formatScriptForDisplay,
                selectedAuthType: formState.selectedAuthType,
                deliveryModeValue: formState.deliveryModeValue,
                schedulingScriptValidation,
                isValidatingScript,
                onValidateScript: handleValidateSchedulingScript,
                onCopyExampleScript: handleCopyExampleScript,
                onValidationClose: () => setSchedulingScriptValidation({ status: 'idle' }),
                transformationTab,
                selectedEventType: formState.selectedEventType || existingIntegration?.eventType,
                mappingState,
                scriptValue,
                lastPreviewMeta,
                tagTone,
                onPreview: handlePreviewTransformation,
                onOpenDesigner: handleOpenTransformDesigner,
                isReadOnly: !isCreate && !isEditMode,
                isLoading: isDetailLoading,
                integrationId: existingIntegration?.id,
                onSave: () => form.submit(),
                onCancel: isCreate ? () => navigate('/integrations') : handleCancelEdit,
                isSaving,
                isActiveValue
              })}
            />
          )}
        </IntegrationFormContainer>
        <TransformationDrawer open={isTransformOpen} onClose={() => setIsTransformOpen(false)}>
          <TransformationDesigner
            transformationTab={transformationTab}
            onChangeTab={setTransformationTab}
            scriptValue={scriptValue}
            onScriptChange={setScriptValue}
            mappings={mappingState.mappings as any[]}
            onMappingsChange={(mappings) => setMappingState(s => ({ ...s, mappings }))}
            staticFields={mappingState.staticFields as any[]}
            onStaticFieldsChange={(staticFields) => setMappingState(s => ({ ...s, staticFields }))}
            sampleInput={sampleInput}
            onSampleInputChange={setSampleInput}
            sampleOutput={sampleOutput}
            onSampleOutputChange={setSampleOutput}
            requiredAnchorRef={requiredRef}
            onMissingRequiredChange={setMissingRequiredMappings}
            availableFields={availableFields as any[]}
            availableFieldTree={availableFieldTree as any[]}
            eventPayload={selectedEventTypeData?.samplePayload}
            onUseEventPayload={(payloadText) => setSampleInput(payloadText)}
            getPreviewContext={() => buildPreviewContext(form)}
            onValidateScript={() => messageApi.success('Script validated')}
            onPreviewMeta={setLastPreviewMeta}
            onRegisterRunPreview={registerPreviewRunner(runPreviewRef)}
            eventTypes={eventTypes.map(et => et.eventType)}
            currentEventType={form.getFieldValue('eventType')}
          />
        </TransformationDrawer>

        {/* Review & Confirm Drawer */}
        <ReviewConfirmDrawer
          open={isReviewDrawerOpen}
          onClose={() => setIsReviewDrawerOpen(false)}
          onConfirm={handleConfirmReview}
          isCreating={isCreate}
          ruleName={formState.nameValue || 'Untitled Rule'}
          eventType={formState.eventTypeValue || 'Not configured'}
          targetUrl={formState.targetUrlValue || 'Not configured'}
          httpMethod={formState.httpMethodValue || 'POST'}
          scope={formState.scopeValue || 'ALL'}
          deliveryMode={formState.deliveryModeValue || 'IMMEDIATE'}
          retryPolicy={`${formState.retryValue ?? 3} retries, ${formState.timeoutValue ?? 30000}ms timeout`}
          authMethod={formState.authTypeValue || 'NONE'}
          transformationType={transformationTab === 'SCRIPT' ? 'JavaScript Transform' : 'Simple Mapping'}
          readinessChecks={[
            {
              label: 'Rule name and event type configured',
              isComplete: !!(formState.nameValue && formState.eventTypeValue),
              warning: !formState.nameValue || !formState.eventTypeValue ? 'Required field missing' : undefined
            },
            {
              label: 'Target endpoint configured',
              isComplete: !!(formState.targetUrlValue && formState.httpMethodValue),
              warning: !formState.targetUrlValue || !formState.httpMethodValue ? 'Required field missing' : undefined
            },
            {
              label: 'Authentication configured',
              isComplete: !!formState.authTypeValue,
              warning: !formState.authTypeValue ? 'Authentication method not selected' : undefined
            },
            {
              label: 'Transformation configured',
              isComplete: transformationHasContent || isMultiAction,
              warning: !transformationHasContent && !isMultiAction ? 'No transformation mappings or script' : undefined
            },
            {
              label: 'No validation errors',
              isComplete: multiActionValidationErrors.length === 0 && (isMultiAction || missingRequiredMappings === 0),
              warning: multiActionValidationErrors.length > 0 ? `${multiActionValidationErrors.length} errors to fix` : missingRequiredMappings > 0 ? `${missingRequiredMappings} required mappings missing` : undefined
            }
          ]}
          isSaving={isSaving}
        />

        {/* Integration Signing Modal - TEMPORARILY HIDDEN */}
        {/*
        <Modal
          title={
            <Space>
              <LockOutlined />
              <span>Manage Signing Secrets & Configuration</span>
              {!isCreate && !isEditMode && (
                <Tag color="orange">View Only</Tag>
              )}
            </Space>
          }
          open={isSigningModalOpen}
          onCancel={() => setIsSigningModalOpen(false)}
          footer={
            !isCreate && !isEditMode ? (
              <Button onClick={() => setIsSigningModalOpen(false)}>Close</Button>
            ) : null
          }
          width={900}
          style={{ top: 20 }}
        >
          {!isCreate && !isEditMode && (
            <Alert
              type="info"
              message="View Only Mode"
              description="Click the Edit button in the top right to modify integration signing configuration."
              showIcon
              style={{ marginBottom: spacing[4] }}
            />
          )}
          <fieldset disabled={!isCreate && !isEditMode} style={{ border: 'none', padding: 0, margin: 0 }}>
            <IntegrationSigningSection
              integration={existingIntegration}
              form={form}
              isCreate={isCreate}
              spacing={spacing}
              colors={colors}
              token={token}
              hideToggle={true}
              showConfigAlways={true}
              onRotateSecret={async () => {
                if (!existingIntegration?.id) return;
                try {
                  const result = await rotateIntegrationSecret(existingIntegration.id);
                  form.setFieldsValue({
                    signingSecret: result.newSecret,
                    signingSecrets: result.signingSecrets
                  });
                  messageApi.success('New signing secret generated successfully!');
                  queryClient.invalidateQueries({ queryKey: ['integration', id] });
                } catch (error: any) {
                  messageApi.error(error.message || 'Failed to rotate secret');
                }
              }}
              onRemoveSecret={async (secret) => {
                if (!existingIntegration?.id) return;
                try {
                  const result = await removeIntegrationSecret(existingIntegration.id, secret);
                  form.setFieldsValue({
                    signingSecrets: result.signingSecrets
                  });
                  messageApi.success('Secret removed successfully!');
                  queryClient.invalidateQueries({ queryKey: ['integration', id] });
                } catch (error: any) {
                  messageApi.error(error.message || 'Failed to remove secret');
                }
              }}
            />
          </fieldset>
        </Modal>
        */}
      </div>
    </div>
  );
};
