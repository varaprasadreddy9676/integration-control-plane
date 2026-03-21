import { useEffect, useMemo, useState } from 'react';
import { App, Alert, Form, Skeleton, Space } from 'antd';
import type { CancellationPreviewResult, ConditionPreviewResult, SubjectPreviewResult } from '../../../../../services/api';
import { previewConditionRelease, previewLifecycleCancellation, previewSubjectExtraction } from '../../../../../services/api';
import { buildConditionConfigFromForm } from '../utils/condition';
import { buildSubjectExtractionFromForm } from '../utils/lifecycle';
import {
  getLifecycleEventOptions,
  getMatchKeyOptions,
  getPreviewWarnings,
  getSubjectPreviewKeys,
  hasConfiguredExtraction,
  parseSamplePayload,
} from '../utils/lifecyclePreview';
import { ConditionPreviewSection } from './ConditionPreviewSection';
import { ConditionRulesSection } from './ConditionRulesSection';
import { LifecyclePreviewSection } from './LifecyclePreviewSection';
import { LifecycleRulesSection } from './LifecycleRulesSection';
import { LifecycleSubjectSection } from './LifecycleSubjectSection';
import type { LifecyclePanelContentProps } from './LifecyclePanel.types';

export const LifecyclePanelContent = ({
  form,
  eventTypes,
  samplePayload,
  currentEventType,
  integrationId,
  deliveryModeValue,
  spacing,
  token,
  colors,
  isLoading = false,
}: LifecyclePanelContentProps) => {
  const { message } = App.useApp();
  const extractionMode = Form.useWatch('subjectExtractionMode', form) || 'PATHS';
  const pathEntries = Form.useWatch('subjectExtractionPaths', form) || [];
  const lifecycleRules = Form.useWatch('lifecycleRules', form) || [];
  const conditionRules = Form.useWatch('conditionRules', form) || [];
  const extractionScript = Form.useWatch('subjectExtractionScript', form) || '';
  const conditionPayloadStrategy = Form.useWatch('conditionPayloadStrategy', form) || 'ORIGINAL_EVENT';
  const conditionExpiresAfterHours = Form.useWatch('conditionExpiresAfterHours', form);
  const isConditionMode = deliveryModeValue === 'WAIT_FOR_CONDITION' || deliveryModeValue === 'WAIT_FOR_EVENT';

  const [isPreviewingSubject, setIsPreviewingSubject] = useState(false);
  const [isPreviewingCancellation, setIsPreviewingCancellation] = useState(false);
  const [isPreviewingCondition, setIsPreviewingCondition] = useState(false);
  const [previewEventType, setPreviewEventType] = useState<string>();
  const [subjectPreview, setSubjectPreview] = useState<SubjectPreviewResult | null>(null);
  const [cancellationPreview, setCancellationPreview] = useState<CancellationPreviewResult | null>(null);
  const [conditionPreview, setConditionPreview] = useState<ConditionPreviewResult | null>(null);

  const activeRules = isConditionMode ? conditionRules : lifecycleRules;
  const lifecycleEventOptions = useMemo(() => getLifecycleEventOptions(activeRules), [activeRules]);
  const subjectPreviewKeys = useMemo(() => getSubjectPreviewKeys(subjectPreview), [subjectPreview]);
  const hasRescheduleRule = useMemo(
    () => (Array.isArray(lifecycleRules) ? lifecycleRules : []).some((rule: any) => rule?.action === 'RESCHEDULE_PENDING'),
    [lifecycleRules]
  );
  const hasExtractionConfig = useMemo(
    () => hasConfiguredExtraction(extractionMode, extractionScript, pathEntries),
    [extractionMode, extractionScript, pathEntries]
  );
  const matchKeyOptions = useMemo(() => getMatchKeyOptions(pathEntries, subjectPreview), [pathEntries, subjectPreview]);
  const eventTypeOptions = useMemo(
    () =>
      (eventTypes || []).map((eventType) => ({
        label: eventType.eventType,
        value: eventType.eventType,
      })),
    [eventTypes]
  );
  const previewWarnings = useMemo(() => getPreviewWarnings(subjectPreview, cancellationPreview), [subjectPreview, cancellationPreview]);
  const previewConfigSignature = useMemo(
    () =>
      JSON.stringify({
        currentEventType,
        integrationId,
        samplePayload,
        extractionMode,
        extractionScript,
        pathEntries,
        lifecycleRules,
        conditionRules,
        conditionPayloadStrategy,
        conditionExpiresAfterHours,
        isConditionMode,
      }),
    [currentEventType, integrationId, samplePayload, extractionMode, extractionScript, pathEntries, lifecycleRules, conditionRules, conditionPayloadStrategy, conditionExpiresAfterHours, isConditionMode]
  );
  const conditionPreviewWarnings = useMemo(
    () => getPreviewWarnings(subjectPreview, (conditionPreview as any) || null),
    [subjectPreview, conditionPreview]
  );
  const ruleCount = (Array.isArray(lifecycleRules) ? lifecycleRules.length : 0) + (Array.isArray(conditionRules) ? conditionRules.length : 0);

  useEffect(() => {
    if (lifecycleEventOptions.length === 0) {
      if (previewEventType !== undefined) {
        setPreviewEventType(undefined);
      }
      return;
    }

    if (!previewEventType || !lifecycleEventOptions.includes(previewEventType)) {
      setPreviewEventType(lifecycleEventOptions[0]);
    }
  }, [lifecycleEventOptions, previewEventType]);

  useEffect(() => {
    setCancellationPreview(null);
    setConditionPreview(null);
  }, [previewEventType]);

  useEffect(() => {
    setSubjectPreview(null);
    setCancellationPreview(null);
    setConditionPreview(null);
  }, [previewConfigSignature]);

  const getParsedSamplePayload = () => {
    try {
      return parseSamplePayload(samplePayload);
    } catch (_error) {
      message.error('Sample payload is not valid JSON');
      return null;
    }
  };

  const handlePreviewSubject = async () => {
    const parsedPayload = getParsedSamplePayload();
    if (parsedPayload === null) {
      return;
    }

    try {
      setIsPreviewingSubject(true);
      const values = form.getFieldsValue(true);
      const extraction = buildSubjectExtractionFromForm(values);
      const result = await previewSubjectExtraction({
        eventType: currentEventType,
        resourceType: values.resourceType || null,
        subjectExtraction: extraction,
        samplePayload: parsedPayload,
      });
      setSubjectPreview(result);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to preview subject extraction';
      message.error(errorMessage);
    } finally {
      setIsPreviewingSubject(false);
    }
  };

  const handlePreviewCancellation = async () => {
    if (!previewEventType) {
      message.warning(lifecycleEventOptions.length === 0 ? 'Add a lifecycle rule first' : 'Select a lifecycle event to preview');
      return;
    }

    const parsedPayload = getParsedSamplePayload();
    if (parsedPayload === null) {
      return;
    }

    try {
      setIsPreviewingCancellation(true);
      const values = form.getFieldsValue(true);
      const extraction = buildSubjectExtractionFromForm(values);
      const result = await previewLifecycleCancellation({
        integrationId,
        eventType: previewEventType,
        resourceType: values.resourceType || null,
        subjectExtraction: extraction,
        lifecycleRules: values.lifecycleRules || [],
        samplePayload: parsedPayload,
      });
      setCancellationPreview(result);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to preview lifecycle cancellation';
      message.error(errorMessage);
    } finally {
      setIsPreviewingCancellation(false);
    }
  };

  const handlePreviewCondition = async () => {
    if (!previewEventType) {
      message.warning(lifecycleEventOptions.length === 0 ? 'Add a condition rule first' : 'Select a follow-up event to preview');
      return;
    }

    const parsedPayload = getParsedSamplePayload();
    if (parsedPayload === null) {
      return;
    }

    try {
      setIsPreviewingCondition(true);
      const values = form.getFieldsValue(true);
      const extraction = buildSubjectExtractionFromForm(values);
      const conditionConfig = buildConditionConfigFromForm(values);
      const result = await previewConditionRelease({
        integrationId,
        eventType: previewEventType,
        resourceType: values.resourceType || null,
        subjectExtraction: extraction,
        conditionConfig,
        samplePayload: parsedPayload,
      });
      setConditionPreview(result);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to preview held delivery impact';
      message.error(errorMessage);
    } finally {
      setIsPreviewingCondition(false);
    }
  };

  if (isLoading) {
    return <Skeleton active paragraph={{ rows: 8 }} />;
  }

  return (
    <Space direction="vertical" size={Number.parseInt(spacing[4], 10) || 16} style={{ width: '100%' }}>
      {deliveryModeValue === 'IMMEDIATE' && (
        <Alert
          type="info"
          showIcon
          message="This integration delivers immediately and will not create scheduled rows. Lifecycle rules have no effect here. Configure them on DELAYED or RECURRING integrations."
        />
      )}

      <LifecycleSubjectSection
        form={form}
        extractionMode={extractionMode}
        hasExtractionConfig={hasExtractionConfig}
        ruleCount={ruleCount}
        pathEntries={pathEntries}
        token={token}
        colors={colors}
      />

      {isConditionMode ? (
        <>
          <ConditionRulesSection
            eventTypeOptions={eventTypeOptions}
            extractionMode={extractionMode}
            matchKeyOptions={matchKeyOptions}
            subjectPreviewKeys={subjectPreviewKeys}
            token={token}
            colors={colors}
          />

          <ConditionPreviewSection
            integrationId={integrationId}
            conditionEventOptions={lifecycleEventOptions}
            previewEventType={previewEventType}
            setPreviewEventType={setPreviewEventType}
            handlePreviewSubject={handlePreviewSubject}
            handlePreviewCondition={handlePreviewCondition}
            isPreviewingSubject={isPreviewingSubject}
            isPreviewingCondition={isPreviewingCondition}
            subjectPreview={subjectPreview}
            conditionPreview={conditionPreview}
            previewWarnings={conditionPreviewWarnings}
            token={token}
          />
        </>
      ) : (
        <>
          <LifecycleRulesSection
            eventTypeOptions={eventTypeOptions}
            extractionMode={extractionMode}
            matchKeyOptions={matchKeyOptions}
            subjectPreviewKeys={subjectPreviewKeys}
            hasRescheduleRule={hasRescheduleRule}
            token={token}
            colors={colors}
          />

          <LifecyclePreviewSection
            integrationId={integrationId}
            lifecycleEventOptions={lifecycleEventOptions}
            previewEventType={previewEventType}
            setPreviewEventType={setPreviewEventType}
            handlePreviewSubject={handlePreviewSubject}
            handlePreviewCancellation={handlePreviewCancellation}
            isPreviewingSubject={isPreviewingSubject}
            isPreviewingCancellation={isPreviewingCancellation}
            subjectPreview={subjectPreview}
            cancellationPreview={cancellationPreview}
            previewWarnings={previewWarnings}
            token={token}
          />
        </>
      )}
    </Space>
  );
};
