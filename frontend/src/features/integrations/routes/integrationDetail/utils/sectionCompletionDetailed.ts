import type { SectionCompletionStatus } from '../components/EnhancedSectionHeader';

interface SectionCompletionParams {
  nameValue?: string;
  eventTypeValue?: string;
  targetUrlValue?: string;
  httpMethodValue?: string;
  scopeValue?: string;
  authTypeValue?: string;
  timeoutValue?: number;
  retryValue?: number;
  isMultiAction: boolean;
  hasActions: boolean;
  actionsCount: number;
  multiActionValidationErrors: string[];
  transformationHasContent: boolean;
  deliveryModeValue?: string;
}

export interface DetailedSectionCompletion {
  configuration: SectionCompletionStatus;
  multiAction?: SectionCompletionStatus;
  authentication: SectionCompletionStatus;
  delivery: SectionCompletionStatus;
  transformation?: SectionCompletionStatus;
}

/**
 * Calculate detailed completion status for each section
 * Returns completion information including missing field counts and errors
 */
export const getSectionCompletionDetailed = ({
  nameValue,
  eventTypeValue,
  targetUrlValue,
  httpMethodValue,
  scopeValue,
  authTypeValue,
  timeoutValue,
  retryValue,
  isMultiAction,
  hasActions,
  actionsCount,
  multiActionValidationErrors,
  transformationHasContent,
  deliveryModeValue
}: SectionCompletionParams): DetailedSectionCompletion => {
  // Configuration Section
  const configurationFields = {
    name: !!nameValue,
    eventType: !!eventTypeValue,
    targetUrl: isMultiAction || !!targetUrlValue,
    httpMethod: !!httpMethodValue,
    scope: !!scopeValue
  };
  const configMissingCount = Object.values(configurationFields).filter(v => !v).length;
  const configurationCompletion: SectionCompletionStatus = {
    isComplete: configMissingCount === 0,
    requiredFieldsCount: 5,
    missingRequiredCount: configMissingCount,
    errors: []
  };

  // Multi-Action Section (only for multi-action mode)
  let multiActionCompletion: SectionCompletionStatus | undefined;
  if (isMultiAction) {
    multiActionCompletion = {
      isComplete: hasActions && multiActionValidationErrors.length === 0,
      requiredFieldsCount: 1, // At least one action required
      missingRequiredCount: hasActions ? 0 : 1,
      errors: multiActionValidationErrors
    };
  }

  // Authentication Section
  const authenticationCompletion: SectionCompletionStatus = {
    isComplete: !!authTypeValue,
    requiredFieldsCount: 1,
    missingRequiredCount: authTypeValue ? 0 : 1,
    errors: []
  };

  // Delivery Section
  const deliveryFields = {
    timeout: timeoutValue !== undefined && timeoutValue !== null,
    retry: retryValue !== undefined && retryValue !== null
  };
  const deliveryMissingCount = Object.values(deliveryFields).filter(v => !v).length;
  const deliveryCompletion: SectionCompletionStatus = {
    isComplete: deliveryMissingCount === 0,
    requiredFieldsCount: 2,
    missingRequiredCount: deliveryMissingCount,
    errors: []
  };

  // Transformation Section (only for single-action mode)
  let transformationCompletion: SectionCompletionStatus | undefined;
  if (!isMultiAction) {
    transformationCompletion = {
      isComplete: transformationHasContent,
      requiredFieldsCount: 1,
      missingRequiredCount: transformationHasContent ? 0 : 1,
      errors: []
    };
  }

  return {
    configuration: configurationCompletion,
    multiAction: multiActionCompletion,
    authentication: authenticationCompletion,
    delivery: deliveryCompletion,
    transformation: transformationCompletion
  };
};

/**
 * Convert detailed completion to simple boolean map (for backward compatibility)
 */
export const toSimpleCompletion = (detailed: DetailedSectionCompletion): Record<string, boolean> => {
  const simple: Record<string, boolean> = {
    configuration: detailed.configuration.isComplete,
    authentication: detailed.authentication.isComplete,
    delivery: detailed.delivery.isComplete
  };

  if (detailed.multiAction) {
    simple.multiAction = detailed.multiAction.isComplete;
  }

  if (detailed.transformation) {
    simple.transformation = detailed.transformation.isComplete;
  }

  return simple;
};
