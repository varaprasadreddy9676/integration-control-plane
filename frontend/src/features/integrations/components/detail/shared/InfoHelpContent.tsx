import { Typography } from 'antd';

/**
 * Pre-built popover content components for common help topics
 * Used with HelpPopover component for progressive disclosure
 */

/**
 * URL Requirements Help - Production URL security restrictions
 */
export const UrlRequirementsHelp = () => (
  <div>
    <Typography.Paragraph style={{ marginBottom: 8 }}>
      <strong>Blocked for security:</strong>
    </Typography.Paragraph>
    <ul style={{ margin: 0, paddingLeft: 20, marginBottom: 8 }}>
      <li>localhost, 127.0.0.1</li>
      <li>Private IPs (192.168.x.x, 10.x.x.x, 172.16-31.x.x)</li>
    </ul>
    <Typography.Paragraph style={{ marginBottom: 0 }}>
      <strong>Local testing:</strong> Use ngrok or expose.dev
    </Typography.Paragraph>
  </div>
);

/**
 * Data Security & Compliance Help - Multi-entity data security requirements
 */
export const DataSecurityHelp = ({ entityCount }: { entityCount: number }) => (
  <div>
    <Typography.Paragraph>
      Events from <strong>{entityCount} entities</strong> (including PHI/PII) will be sent.
    </Typography.Paragraph>
    <Typography.Paragraph strong style={{ marginBottom: 4 }}>
      Ensure receiving system:
    </Typography.Paragraph>
    <ul style={{ margin: 0, paddingLeft: 20 }}>
      <li>Has authorization for all included entities</li>
      <li>Meets HIPAA compliance (if applicable)</li>
      <li>Maintains audit trails</li>
      <li>Implements data segregation if needed</li>
    </ul>
  </div>
);

/**
 * OAuth2 Requirements Help - OAuth2 token endpoint requirements
 */
export const OAuth2RequirementsHelp = () => (
  <div>
    <Typography.Paragraph strong style={{ marginBottom: 4 }}>
      Token endpoint requirements:
    </Typography.Paragraph>
    <ul style={{ margin: 0, paddingLeft: 20 }}>
      <li><strong>Publicly accessible</strong> (5s timeout)</li>
      <li><strong>No token caching</strong> - fetched before EVERY delivery</li>
      <li><strong>Failures block delivery</strong> - integration will retry</li>
      <li>Test with "Test Integration" button before enabling</li>
    </ul>
  </div>
);

/**
 * Scheduling Script Help - DELAYED vs RECURRING mode requirements
 */
export const SchedulingScriptHelp = ({ mode }: { mode?: 'DELAYED' | 'RECURRING' }) => {
  if (mode === 'DELAYED') {
    return (
      <div>
        <Typography.Paragraph>
          Return a single Unix timestamp (milliseconds) in the future.
        </Typography.Paragraph>
        <Typography.Paragraph strong style={{ marginBottom: 4 }}>
          Example:
        </Typography.Paragraph>
        <Typography.Text code style={{ fontSize: 12 }}>
          addDays(event.appointmentTime, -1)
        </Typography.Text>
      </div>
    );
  }

  if (mode === 'RECURRING') {
    return (
      <div>
        <Typography.Paragraph style={{ marginBottom: 4 }}>
          Return an object with:
        </Typography.Paragraph>
        <ul style={{ margin: 0, paddingLeft: 20, fontSize: 13 }}>
          <li><code>firstOccurrence</code>: timestamp (ms)</li>
          <li><code>intervalMs</code>: minimum 60000 (1 min)</li>
          <li><code>maxOccurrences</code>: 2-365 OR <code>endDate</code>: timestamp</li>
        </ul>
      </div>
    );
  }

  // Default: both modes
  return (
    <div>
      <Typography.Paragraph>
        <strong>DELAYED:</strong> Return a single timestamp
      </Typography.Paragraph>
      <Typography.Paragraph>
        <strong>RECURRING:</strong> Return an object with firstOccurrence, intervalMs, and maxOccurrences/endDate
      </Typography.Paragraph>
    </div>
  );
};

/**
 * Utility Functions Help - Available date/time helper functions
 */
export const UtilityFunctionsHelp = () => (
  <div style={{ fontFamily: 'monospace', fontSize: 12 }}>
    <Typography.Paragraph strong style={{ fontFamily: 'inherit', marginBottom: 8 }}>
      Date/Time Utilities:
    </Typography.Paragraph>
    <div style={{ marginBottom: 12 }}>
      <div><code>parseDate(dateString)</code> - Parse date string to timestamp</div>
      <div><code>now()</code> - Current timestamp</div>
      <div><code>toTimestamp(date)</code> - Convert to timestamp</div>
    </div>

    <Typography.Paragraph strong style={{ fontFamily: 'inherit', marginBottom: 8 }}>
      Time Math:
    </Typography.Paragraph>
    <div style={{ marginBottom: 12 }}>
      <div><code>addDays(timestamp, days)</code> - Add days</div>
      <div><code>addHours(timestamp, hours)</code> - Add hours</div>
      <div><code>addMinutes(timestamp, minutes)</code> - Add minutes</div>
      <div><code>subtractDays(timestamp, days)</code> - Subtract days</div>
      <div><code>subtractHours(timestamp, hours)</code> - Subtract hours</div>
    </div>

    <Typography.Paragraph strong style={{ fontFamily: 'inherit', marginBottom: 8 }}>
      Date Boundaries:
    </Typography.Paragraph>
    <div style={{ marginBottom: 12 }}>
      <div><code>startOfDay(timestamp)</code> - Get midnight (00:00:00)</div>
      <div><code>endOfDay(timestamp)</code> - Get 23:59:59.999</div>
    </div>

    <Typography.Paragraph strong style={{ fontFamily: 'inherit', marginBottom: 8 }}>
      Available Variables:
    </Typography.Paragraph>
    <div>
      <div><code>event</code> - Event payload data</div>
      <div><code>context</code> - Metadata (tenantId, eventType, etc.)</div>
    </div>
  </div>
);

/**
 * Multi-Action Mode Help - Explanation of multi-action integrations
 */
export const MultiActionModeHelp = () => (
  <div>
    <Typography.Paragraph>
      Execute multiple HTTP requests sequentially for a single event.
    </Typography.Paragraph>
    <Typography.Paragraph>
      <strong>Use case:</strong> CleverTap profile upload + event upload in one integration
    </Typography.Paragraph>
    <Typography.Paragraph style={{ marginBottom: 0 }}>
      <strong>Note:</strong> All actions share the same authentication configuration
    </Typography.Paragraph>
  </div>
);

/**
 * Script Syntax Help - Important syntax rules for scheduling scripts
 */
export const ScriptSyntaxHelp = () => (
  <div>
    <Typography.Paragraph>
      <strong>Do NOT use 'return' keyword!</strong>
    </Typography.Paragraph>
    <Typography.Paragraph style={{ marginBottom: 4 }}>
      The last expression is automatically returned:
    </Typography.Paragraph>
    <div style={{ fontFamily: 'monospace', fontSize: 12, marginTop: 8 }}>
      <div style={{ color: '#52c41a' }}>✓ Correct: addDays(event.appointmentTime, -1)</div>
      <div style={{ color: '#ff4d4f' }}>✗ Wrong: return addDays(event.appointmentTime, -1)</div>
    </div>
  </div>
);
