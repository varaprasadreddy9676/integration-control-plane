import { TransformationSection } from '../../../components/TransformationSection';

interface TransformationDesignerProps {
  transformationTab: 'SIMPLE' | 'SCRIPT';
  onChangeTab: (tab: 'SIMPLE' | 'SCRIPT') => void;
  scriptValue: string;
  onScriptChange: (value: string) => void;
  mappings: any[];
  onMappingsChange: (mappings: any[]) => void;
  staticFields: any[];
  onStaticFieldsChange: (staticFields: any[]) => void;
  sampleInput: string;
  onSampleInputChange: (value: string) => void;
  sampleOutput: string;
  onSampleOutputChange: (value: string) => void;
  requiredAnchorRef: any;
  onMissingRequiredChange: (count: number) => void;
  availableFields: any[];
  availableFieldTree: any[];
  eventPayload: any;
  onUseEventPayload: (payloadText: string) => void;
  getPreviewContext: () => { eventType: string; entityCode: string; entityName: string };
  onValidateScript: () => void;
  onPreviewMeta: (meta: { durationMs?: number; status?: number }) => void;
  onRegisterRunPreview: (fn: () => void) => void;
  eventTypes: string[];
  currentEventType?: string;
}

export const TransformationDesigner = (props: TransformationDesignerProps) => (
  <TransformationSection {...props} />
);
