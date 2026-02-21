import { Alert, Space } from 'antd';
import type { CSSProperties } from 'react';

export interface FormAlertsProps {
  /**
   * Show disabled/paused status warning
   */
  isDisabled?: boolean;

  /**
   * Reason why the form is disabled (e.g., "Circuit breaker is open")
   */
  disabledReason?: string;

  /**
   * List of validation errors to display
   */
  validationErrors?: string[];

  /**
   * Show "event type required" warning
   */
  requiresEventType?: boolean;

  /**
   * Event type help text (if requiresEventType is true)
   */
  eventTypeHelpText?: string;

  /**
   * Spacing between alerts (Ant Design spacing object or CSS value)
   */
  spacing?: any;

  /**
   * Additional styles for the container
   */
  style?: CSSProperties;

  /**
   * Callback when disabled alert is closed
   */
  onDismissDisabled?: () => void;

  /**
   * Callback when validation errors alert is closed
   */
  onDismissValidation?: () => void;

  /**
   * Callback when event type alert is closed
   */
  onDismissEventType?: () => void;
}

/**
 * Reusable form alert banners component
 *
 * Displays contextual alerts for form states:
 * - Disabled/paused status
 * - Validation errors
 * - Missing required fields (e.g., event type)
 *
 * @example
 * ```tsx
 * <FormAlerts
 *   isDisabled={!isActive}
 *   disabledReason="This integration is paused. Enable it to make changes."
 *   validationErrors={['Action 1: Missing transformation script', 'Action 2: Invalid URL']}
 *   requiresEventType={!eventType}
 *   spacing={spacing}
 * />
 * ```
 */
export const FormAlerts = ({
  isDisabled,
  disabledReason,
  validationErrors = [],
  requiresEventType,
  eventTypeHelpText = 'Choose an event type above to configure transformations.',
  spacing = { 4: '16px' },
  style,
  onDismissDisabled,
  onDismissValidation,
  onDismissEventType
}: FormAlertsProps) => {
  const alerts = [];
  const spacingValue = typeof spacing === 'object' && spacing[4] ? spacing[4] : spacing || '16px';

  // Circuit breaker / disabled status banner
  if (isDisabled) {
    alerts.push(
      <Alert
        key="disabled-status"
        type="warning"
        showIcon
        message="Integration is paused"
        description={disabledReason || 'This integration is currently inactive. Enable it to process events.'}
        closable={!!onDismissDisabled}
        onClose={onDismissDisabled}
      />
    );
  }

  // Validation errors banner
  if (validationErrors.length > 0) {
    alerts.push(
      <Alert
        key="validation-errors"
        type="error"
        showIcon
        message={`${validationErrors.length} validation error${validationErrors.length > 1 ? 's' : ''} found`}
        description={
          <ul style={{ margin: 0, paddingLeft: 20 }}>
            {validationErrors.map((error, idx) => (
              <li key={idx}>{error}</li>
            ))}
          </ul>
        }
        closable={!!onDismissValidation}
        onClose={onDismissValidation}
      />
    );
  }

  // Event type required banner
  if (requiresEventType) {
    alerts.push(
      <Alert
        key="event-type-required"
        type="info"
        showIcon
        message="Select event type first"
        description={eventTypeHelpText}
        closable={!!onDismissEventType}
        onClose={onDismissEventType}
      />
    );
  }

  if (alerts.length === 0) {
    return null;
  }

  return (
    <Space
      direction="vertical"
      size={spacingValue}
      style={{
        width: '100%',
        ...style
      }}
    >
      {alerts}
    </Space>
  );
};
