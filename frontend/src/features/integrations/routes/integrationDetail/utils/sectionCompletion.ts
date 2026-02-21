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
  multiActionValidationErrors: string[];
  transformationHasContent: boolean;
}

export const getSectionCompletion = ({
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
  multiActionValidationErrors,
  transformationHasContent
}: SectionCompletionParams) => ({
  configuration: !!(nameValue && eventTypeValue && (targetUrlValue || isMultiAction) && httpMethodValue && scopeValue),
  multiAction: isMultiAction ? (hasActions && multiActionValidationErrors.length === 0) : true,
  authentication: !!authTypeValue,
  delivery: !!(timeoutValue && retryValue !== undefined),
  transformation: isMultiAction ? true : transformationHasContent
});
