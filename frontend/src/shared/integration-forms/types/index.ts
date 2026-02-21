/**
 * Shared types for integration forms
 */
export type AuthType = 'NONE' | 'API_KEY' | 'BASIC' | 'BEARER' | 'OAUTH1' | 'OAUTH2' | 'CUSTOM' | 'CUSTOM_HEADERS';

export type TransformationMode = 'SIMPLE' | 'SCRIPT';

export type IntegrationMode = 'inbound' | 'outbound' | 'scheduled';

export interface AuthenticationFieldsProps {
  /**
   * Ant Design form instance
   */
  form: any;

  /**
   * UI configuration from backend (auth types, etc.)
   */
  uiConfig?: any;

  /**
   * Currently selected authentication type
   */
  selectedAuthType?: AuthType;

  /**
   * Field prefix for nested form paths
   * e.g., ['outgoingAuthConfig'] for outbound, ['inboundAuthConfig'] for inbound
   */
  fieldPrefix: string[];

  /**
   * Integration mode for context-aware labels
   */
  mode: IntegrationMode;

  /**
   * Spacing tokens from design system
   */
  spacing: any;

  /**
   * Form field name for auth type selection
   * Defaults to 'outgoingAuthType' for backward compatibility
   */
  authTypeFieldName?: string;
}

export interface TransformationFormProps {
  /**
   * Ant Design form instance
   */
  form: any;

  /**
   * Current transformation mode (SIMPLE or SCRIPT)
   */
  mode: TransformationMode;

  /**
   * Callback when mode changes
   */
  onModeChange: (mode: TransformationMode) => void;

  /**
   * Script value for SCRIPT mode
   */
  scriptValue: string;

  /**
   * Callback when script changes
   */
  onScriptChange: (value: string) => void;

  /**
   * Mapping state for SIMPLE mode
   */
  mappingState: {
    mappings: any[];
    staticFields: any[];
  };

  /**
   * Callback when mapping state changes
   */
  onMappingChange: (state: { mappings: any[]; staticFields: any[] }) => void;

  /**
   * Available source fields for mapping
   */
  availableFields?: any[];

  /**
   * Sample input payload for preview
   */
  sampleInput?: string;

  /**
   * Sample output from transformation
   */
  sampleOutput?: string;

  /**
   * Preview metadata (duration, status)
   */
  previewMeta?: {
    durationMs?: number;
    status?: number;
  };

  /**
   * Preview runner function reference
   */
  onPreview?: () => void;

  /**
   * Hide the mode selector (force SCRIPT mode only)
   * Useful for inbound integrations where SIMPLE mappings don't make sense
   */
  hideModeSelector?: boolean;

  /**
   * Design system tokens
   */
  spacing: any;
  colors: any;
}

export interface HttpConfigFieldsProps {
  /**
   * Ant Design form instance
   */
  form: any;

  /**
   * UI configuration from backend (HTTP methods, etc.)
   */
  uiConfig?: any;

  /**
   * Integration mode for context-aware labels
   */
  mode: IntegrationMode;

  /**
   * Design system tokens
   */
  spacing: any;
  colors: any;

  /**
   * Whether this is multi-action mode (for outbound integrations)
   */
  isMultiAction?: boolean;
}
