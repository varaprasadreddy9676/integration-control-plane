import type { CancellationPreviewResult, SubjectPreviewResult } from '../../../../../services/api';
import type { SubjectExtractionPathEntry } from './lifecycle';

export const parseSamplePayload = (samplePayload: string): unknown => {
  if (!samplePayload?.trim()) {
    return {};
  }

  return JSON.parse(samplePayload);
};

export const hasConfiguredExtraction = (
  extractionMode: 'PATHS' | 'SCRIPT',
  extractionScript: string,
  pathEntries: SubjectExtractionPathEntry[]
): boolean => {
  if (extractionMode === 'SCRIPT') {
    return extractionScript.trim().length > 0;
  }

  return (Array.isArray(pathEntries) ? pathEntries : []).some((entry) => {
    const key = entry?.key?.trim();
    const paths = entry?.paths?.trim();
    return Boolean(key || paths);
  });
};

export const getLifecycleEventOptions = (lifecycleRules: any[]): string[] =>
  Array.from(
    new Set(
      (Array.isArray(lifecycleRules) ? lifecycleRules : []).flatMap((rule: any) =>
        Array.isArray(rule?.eventTypes) ? rule.eventTypes.filter(Boolean) : []
      )
    )
  );

export const getMatchKeyOptions = (
  pathEntries: SubjectExtractionPathEntry[],
  subjectPreview: SubjectPreviewResult | null
): Array<{ label: string; value: string }> => {
  const keys = [
    ...(Array.isArray(pathEntries) ? pathEntries : [])
      .map((entry) => entry?.key?.trim())
      .filter((value): value is string => Boolean(value)),
    ...Object.keys(subjectPreview?.subject?.data || {}),
  ];

  return Array.from(new Set(keys)).map((value) => ({ label: value, value }));
};

export const getPreviewWarnings = (
  subjectPreview: SubjectPreviewResult | null,
  cancellationPreview: CancellationPreviewResult | null
): string[] => Array.from(new Set([...(subjectPreview?.warnings || []), ...(cancellationPreview?.warnings || [])]));

export const getSubjectPreviewKeys = (subjectPreview: SubjectPreviewResult | null): string[] =>
  Object.keys(subjectPreview?.subject?.data || {});

export const getMatchedOnKeys = (cancellationPreview: CancellationPreviewResult | null): string[] =>
  Array.isArray(cancellationPreview?.matchedOn) ? cancellationPreview.matchedOn : [];
