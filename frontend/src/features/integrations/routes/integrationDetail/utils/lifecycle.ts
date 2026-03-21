import type { SubjectExtraction } from '../../../../../mocks/types';

export interface SubjectExtractionPathEntry {
  key?: string;
  paths?: string;
}

export const parsePathLines = (value?: string): string[] => {
  if (!value) return [];

  return Array.from(
    new Set(
      value
        .split(/\r?\n|,/)
        .map((item) => item.trim())
        .filter(Boolean)
    )
  );
};

export const buildSubjectExtractionFromForm = (values: {
  subjectExtractionMode?: 'PATHS' | 'SCRIPT';
  subjectExtractionScript?: string;
  subjectExtractionPaths?: SubjectExtractionPathEntry[];
}): SubjectExtraction | null => {
  const mode = values.subjectExtractionMode || 'PATHS';

  if (mode === 'SCRIPT') {
    const script = values.subjectExtractionScript?.trim();
    return script ? { mode: 'SCRIPT', script } : null;
  }

  const entries = Array.isArray(values.subjectExtractionPaths) ? values.subjectExtractionPaths : [];
  const paths = entries.reduce<Record<string, string | string[]>>((acc, entry) => {
    const key = entry?.key?.trim();
    if (!key) {
      return acc;
    }

    const normalizedPaths = parsePathLines(entry.paths);
    if (normalizedPaths.length === 0) {
      return acc;
    }

    acc[key] = normalizedPaths.length === 1 ? normalizedPaths[0] : normalizedPaths;
    return acc;
  }, {});

  return Object.keys(paths).length > 0
    ? {
        mode: 'PATHS',
        paths,
      }
    : null;
};

export const subjectExtractionToFormFields = (subjectExtraction?: SubjectExtraction | null) => {
  if (!subjectExtraction) {
    return {
      subjectExtractionMode: 'PATHS' as const,
      subjectExtractionScript: '',
      subjectExtractionPaths: [{ key: '', paths: '' }],
    };
  }

  if (subjectExtraction.mode === 'SCRIPT') {
    return {
      subjectExtractionMode: 'SCRIPT' as const,
      subjectExtractionScript: subjectExtraction.script || '',
      subjectExtractionPaths: [{ key: '', paths: '' }],
    };
  }

  const entries = Object.entries(subjectExtraction.paths || {}).map(([key, value]) => ({
    key,
    paths: Array.isArray(value) ? value.join('\n') : value,
  }));

  return {
    subjectExtractionMode: 'PATHS' as const,
    subjectExtractionScript: '',
    subjectExtractionPaths: entries.length > 0 ? entries : [{ key: '', paths: '' }],
  };
};
