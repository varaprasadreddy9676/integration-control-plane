import { Card, Typography, Alert, Divider, Tabs, Space, Tag } from 'antd';
import { BookOutlined, CodeOutlined, ThunderboltOutlined, BulbOutlined, DatabaseOutlined, CheckCircleOutlined } from '@ant-design/icons';
import { cssVar, useDesignTokens, spacingToNumber } from '../../../design-system/utils';
import { Grid } from 'antd';
import { useMemo } from 'react';

const { Title, Paragraph, Text } = Typography;

export const LookupGuideRoute = () => {
  const { spacing, token, shadows } = useDesignTokens();
  const colors = cssVar.legacy;
  const screens = Grid.useBreakpoint();
  const isNarrow = !screens.md;

  const codeBlockStyle = {
    background: colors.neutral[900],
    color: colors.neutral[100],
    padding: spacing[4],
    borderRadius: token.borderRadius,
    fontSize: 13,
    fontFamily: 'Monaco, Menlo, "Courier New", monospace',
    overflow: 'auto',
    whiteSpace: 'pre' as const,
    lineHeight: 1.6
  };

  const sectionStyle = {
    marginBottom: spacingToNumber(spacing[6])
  };

  return (
    <div style={{ padding: isNarrow ? spacing[4] : spacing[6] }}>
      <Card
        variant="borderless"
        style={{
          background: cssVar.bg.surface,
          borderRadius: token.borderRadiusLG,
          boxShadow: shadows.sm,
          maxWidth: 1200,
          margin: '0 auto'
        }}
      >
        {/* Header */}
        <div style={sectionStyle}>
          <div style={{ display: 'flex', alignItems: 'center', gap: spacing[3], marginBottom: spacing[4] }}>
            <BookOutlined style={{ fontSize: 32, color: colors.primary[600] }} />
            <div>
              <Title level={2} style={{ margin: 0 }}>Lookup Tables Guide</Title>
              <Text type="secondary">Complete guide to using code mappings in the Event Gateway</Text>
            </div>
          </div>

          <Alert
            type="info"
            showIcon
            message="What are Lookup Tables?"
            description="Lookup tables provide a way to translate codes and identifiers between your source system and external systems (CRM, ERP, etc.). They run AFTER your transformations to ensure consistent code mapping across all integrations."
            style={{ marginBottom: spacing[5] }}
          />
        </div>

        <Tabs
          defaultActiveKey="overview"
          items={[
            {
              key: 'overview',
              label: (
                <span>
                  <DatabaseOutlined /> Overview
                </span>
              ),
              children: (
                <div>
                  {/* How It Works */}
                  <div style={sectionStyle}>
                    <Title level={4}>
                      <ThunderboltOutlined style={{ color: colors.primary[600], marginRight: 8 }} />
                      How It Works
                    </Title>
                    <Paragraph>
                      Lookup tables follow a simple three-step execution process:
                    </Paragraph>
                    <div style={{
                      background: colors.primary[50],
                      padding: spacing[4],
                      borderRadius: token.borderRadius,
                      borderLeft: `4px solid ${colors.primary[600]}`
                    }}>
                      <Space direction="vertical" style={{ width: '100%' }} size="middle">
                        <div>
                          <Tag color="blue">Step 1</Tag>
                          <Text strong>Standard Transformation Runs First</Text>
                          <Paragraph style={{ marginTop: 4, marginBottom: 0 }}>
                            Your SIMPLE or SCRIPT transformation executes and generates the output payload
                          </Paragraph>
                        </div>
                        <div>
                          <Tag color="cyan">Step 2</Tag>
                          <Text strong>Lookup Mappings Apply</Text>
                          <Paragraph style={{ marginTop: 4, marginBottom: 0 }}>
                            The system finds fields specified in your lookup configs and translates the codes
                          </Paragraph>
                        </div>
                        <div>
                          <Tag color="green">Step 3</Tag>
                          <Text strong>Final Payload Delivered</Text>
                          <Paragraph style={{ marginTop: 4, marginBottom: 0 }}>
                            The transformed payload with mapped codes is sent to the target endpoint
                          </Paragraph>
                        </div>
                      </Space>
                    </div>
                  </div>

                  {/* Key Concepts */}
                  <div style={sectionStyle}>
                    <Title level={4}>
                      <BulbOutlined style={{ color: colors.warning[600], marginRight: 8 }} />
                      Key Concepts
                    </Title>

                    <Space direction="vertical" size="large" style={{ width: '100%' }}>
                      <div>
                        <Text strong style={{ fontSize: 15 }}>Lookup Type</Text>
                        <Paragraph>
                          A category of code mapping (e.g., <code>SERVICE_CODE</code>, <code>DIAGNOSIS_CODE</code>, <code>PROVIDER_ID</code>).
                          You can create any type names that make sense for your integration.
                        </Paragraph>
                      </div>

                      <div>
                        <Text strong style={{ fontSize: 15 }}>Source & Target Codes</Text>
                        <Paragraph>
                          <strong>Source:</strong> The code from your source system (e.g., <code>SVC001</code>)<br />
                          <strong>Target:</strong> The code expected by the external system (e.g., <code>EXT_SVC_001</code>)
                        </Paragraph>
                      </div>

                      <div>
                        <Text strong style={{ fontSize: 15 }}>Hierarchical Override</Text>
                        <Paragraph>
                          Lookups support a two-level hierarchy:
                        </Paragraph>
                        <ul style={{ marginTop: 4 }}>
                          <li><strong>Parent Level:</strong> Default mappings that apply to all entities</li>
                          <li><strong>Entity-Specific:</strong> Override mappings for specific child entities</li>
                        </ul>
                        <Paragraph type="secondary" style={{ fontSize: 13 }}>
                          When resolving a code, the system checks entity-specific mappings first, then falls back to parent-level mappings.
                        </Paragraph>
                      </div>

                      <div>
                        <Text strong style={{ fontSize: 15 }}>Unmapped Behavior</Text>
                        <Paragraph>Controls what happens when no mapping exists:</Paragraph>
                        <ul style={{ marginTop: 4 }}>
                          <li><Tag color="default">PASSTHROUGH</Tag> Keep the original value unchanged</li>
                          <li><Tag color="error">FAIL</Tag> Block the integration delivery and mark as failed</li>
                          <li><Tag color="warning">DEFAULT</Tag> Use a default value you specify</li>
                        </ul>
                      </div>
                    </Space>
                  </div>

                  {/* Use Cases */}
                  <div style={sectionStyle}>
                    <Title level={4}>
                      <CheckCircleOutlined style={{ color: colors.success[600], marginRight: 8 }} />
                      Common Use Cases
                    </Title>

                    <Space direction="vertical" size="middle" style={{ width: '100%' }}>
                      <Card size="small" style={{ background: colors.neutral[50] }}>
                        <Text strong>Service Code Mapping</Text>
                        <Paragraph style={{ marginBottom: 0, marginTop: 4 }}>
                          Map your internal service codes to external billing codes (e.g., source system <code>CONSULT_001</code> → Insurance <code>99213</code>)
                        </Paragraph>
                      </Card>

                      <Card size="small" style={{ background: colors.neutral[50] }}>
                        <Text strong>Provider ID Translation</Text>
                        <Paragraph style={{ marginBottom: 0, marginTop: 4 }}>
                          Translate doctor IDs between systems (e.g., source system <code>DOC_123</code> → CRM <code>PROV_XYZ</code>)
                        </Paragraph>
                      </Card>

                      <Card size="small" style={{ background: colors.neutral[50] }}>
                        <Text strong>Diagnosis Code Conversion</Text>
                        <Paragraph style={{ marginBottom: 0, marginTop: 4 }}>
                          Convert diagnosis codes to ICD-10 or other standard formats
                        </Paragraph>
                      </Card>

                      <Card size="small" style={{ background: colors.neutral[50] }}>
                        <Text strong>Location/Facility Mapping</Text>
                        <Paragraph style={{ marginBottom: 0, marginTop: 4 }}>
                          Map clinic locations to external facility identifiers
                        </Paragraph>
                      </Card>
                    </Space>
                  </div>
                </div>
              )
            },
            {
              key: 'integration-config',
              label: (
                <span>
                  <CodeOutlined /> Integration Configuration
                </span>
              ),
              children: (
                <div>
                  {/* Configuring in Integrations */}
                  <div style={sectionStyle}>
                    <Title level={4}>Adding Lookups to a Integration</Title>
                    <Paragraph>
                      When creating or editing a integration, scroll to the <strong>"Code Mappings (Lookups)"</strong> section
                      and click "Add Mapping" to configure automatic code translation.
                    </Paragraph>

                    <Alert
                      type="warning"
                      showIcon
                      message="Important: Lookups run AFTER transformations"
                      description="Make sure your transformation produces the fields you want to map. Lookups will look for those fields in the transformed payload."
                      style={{ marginBottom: spacing[4] }}
                    />

                    <Title level={5}>Example Configuration</Title>
                    <Paragraph>
                      Let's say you want to map service codes in an appointment event:
                    </Paragraph>

                    <Card size="small" style={{ background: colors.neutral[50], marginBottom: spacing[4] }}>
                      <Space direction="vertical" size="small" style={{ width: '100%' }}>
                        <div><Text strong>Mapping Type:</Text> <code>SERVICE_CODE</code></div>
                        <div><Text strong>Source Field:</Text> <code>serviceCode</code></div>
                        <div><Text strong>Target Field:</Text> <code>externalServiceCode</code></div>
                        <div><Text strong>Unmapped Behavior:</Text> <Tag color="default">PASSTHROUGH</Tag></div>
                      </Space>
                    </Card>

                    <Text strong>Before Lookup:</Text>
                    <pre style={codeBlockStyle}>{`{
  "patientName": "John Doe",
  "serviceCode": "CONSULT_001",
  "appointmentDate": "2026-02-01"
}`}</pre>

                    <Text strong>After Lookup:</Text>
                    <pre style={codeBlockStyle}>{`{
  "patientName": "John Doe",
  "serviceCode": "CONSULT_001",
  "externalServiceCode": "99213",  // ← Added by lookup
  "appointmentDate": "2026-02-01"
}`}</pre>
                  </div>

                  {/* Array Fields */}
                  <div style={sectionStyle}>
                    <Title level={4}>Mapping Array Fields</Title>
                    <Paragraph>
                      Lookups support array notation using <code>[]</code> to map codes within arrays:
                    </Paragraph>

                    <Card size="small" style={{ background: colors.neutral[50], marginBottom: spacing[4] }}>
                      <Space direction="vertical" size="small" style={{ width: '100%' }}>
                        <div><Text strong>Mapping Type:</Text> <code>ITEM_CODE</code></div>
                        <div><Text strong>Source Field:</Text> <code>items[].code</code></div>
                        <div><Text strong>Target Field:</Text> <code>items[].externalCode</code></div>
                      </Space>
                    </Card>

                    <Text strong>Before Lookup:</Text>
                    <pre style={codeBlockStyle}>{`{
  "billNumber": "BILL-001",
  "items": [
    { "code": "MED_123", "quantity": 2 },
    { "code": "MED_456", "quantity": 1 }
  ]
}`}</pre>

                    <Text strong>After Lookup:</Text>
                    <pre style={codeBlockStyle}>{`{
  "billNumber": "BILL-001",
  "items": [
    { "code": "MED_123", "externalCode": "EXT_MED_123", "quantity": 2 },
    { "code": "MED_456", "externalCode": "EXT_MED_456", "quantity": 1 }
  ]
}`}</pre>
                  </div>
                </div>
              )
            },
            {
              key: 'scripts',
              label: (
                <span>
                  <CodeOutlined /> Using in Scripts
                </span>
              ),
              children: (
                <div>
                  {/* lookup() Function */}
                  <div style={sectionStyle}>
                    <Title level={4}>The <code>lookup()</code> Function</Title>
                    <Paragraph>
                      In SCRIPT transformations, you can use the <code>lookup(code, type)</code> function
                      to perform lookups directly in your JavaScript code.
                    </Paragraph>

                    <Alert
                      type="info"
                      showIcon
                      message="Function Signature"
                      description={
                        <code style={{ fontSize: 13 }}>
                          lookup(sourceCode: string, mappingType: string): string | null
                        </code>
                      }
                      style={{ marginBottom: spacing[4] }}
                    />

                    <Title level={5}>Basic Usage</Title>
                    <pre style={codeBlockStyle}>{`// Simple lookup
const externalServiceCode = lookup(payload.serviceCode, 'SERVICE_CODE');

return {
  ...payload,
  externalServiceCode: externalServiceCode
};`}</pre>

                    <Title level={5}>With Fallback</Title>
                    <pre style={codeBlockStyle}>{`// Provide a default if lookup fails
const externalCode = lookup(payload.diagnosisCode, 'DIAGNOSIS_CODE') || 'UNKNOWN';

return {
  ...payload,
  externalDiagnosisCode: externalCode
};`}</pre>

                    <Title level={5}>Conditional Logic</Title>
                    <pre style={codeBlockStyle}>{`const externalCode = lookup(payload.serviceCode, 'SERVICE_CODE');

if (!externalCode) {
  // Handle unmapped code
  logger.warn(\`No mapping found for service code: \${payload.serviceCode}\`);
  return null; // This will skip the integration
}

return {
  ...payload,
  serviceCode: externalCode
};`}</pre>

                    <Title level={5}>Mapping Arrays</Title>
                    <pre style={codeBlockStyle}>{`// Map codes in an array using .map()
return {
  ...payload,
  items: payload.items.map(item => ({
    ...item,
    externalCode: lookup(item.code, 'ITEM_CODE'),
    externalCategory: lookup(item.category, 'CATEGORY_CODE')
  }))
};`}</pre>

                    <Title level={5}>Complex Transformation</Title>
                    <pre style={codeBlockStyle}>{`// Combine multiple lookups with logic
const providerCode = lookup(payload.doctorId, 'PROVIDER_ID');
const locationCode = lookup(payload.clinicId, 'LOCATION_ID');
const serviceCode = lookup(payload.serviceType, 'SERVICE_CODE');

// Only proceed if all critical mappings exist
if (!providerCode || !serviceCode) {
  logger.error('Missing critical mappings');
  return null;
}

return {
  provider: {
    id: providerCode,
    name: payload.doctorName
  },
  location: locationCode || 'DEFAULT_LOCATION',
  service: {
    code: serviceCode,
    description: payload.serviceDescription
  },
  appointment: {
    date: payload.appointmentDate,
    time: payload.appointmentTime
  }
};`}</pre>
                  </div>

                  {/* Best Practices */}
                  <div style={sectionStyle}>
                    <Title level={4}>
                      <BulbOutlined style={{ color: colors.warning[600], marginRight: 8 }} />
                      Best Practices
                    </Title>

                    <Space direction="vertical" size="middle" style={{ width: '100%' }}>
                      <Card size="small" style={{ borderLeft: `4px solid ${colors.success[600]}` }}>
                        <Text strong style={{ color: colors.success[600] }}>✓ DO</Text>
                        <Paragraph style={{ marginBottom: 0, marginTop: 4 }}>
                          Use meaningful lookup type names like <code>SERVICE_CODE</code>, not generic names like <code>CODE_1</code>
                        </Paragraph>
                      </Card>

                      <Card size="small" style={{ borderLeft: `4px solid ${colors.success[600]}` }}>
                        <Text strong style={{ color: colors.success[600] }}>✓ DO</Text>
                        <Paragraph style={{ marginBottom: 0, marginTop: 4 }}>
                          Always handle null returns from <code>lookup()</code> - not all codes may have mappings
                        </Paragraph>
                      </Card>

                      <Card size="small" style={{ borderLeft: `4px solid ${colors.success[600]}` }}>
                        <Text strong style={{ color: colors.success[600] }}>✓ DO</Text>
                        <Paragraph style={{ marginBottom: 0, marginTop: 4 }}>
                          Use the logger to track unmapped codes for troubleshooting: <code>logger.warn()</code>
                        </Paragraph>
                      </Card>

                      <Card size="small" style={{ borderLeft: `4px solid ${colors.error[600]}` }}>
                        <Text strong style={{ color: colors.error[600] }}>✗ DON'T</Text>
                        <Paragraph style={{ marginBottom: 0, marginTop: 4 }}>
                          Don't use lookups for complex transformations - use them only for simple code mapping
                        </Paragraph>
                      </Card>

                      <Card size="small" style={{ borderLeft: `4px solid ${colors.error[600]}` }}>
                        <Text strong style={{ color: colors.error[600] }}>✗ DON'T</Text>
                        <Paragraph style={{ marginBottom: 0, marginTop: 4 }}>
                          Don't create duplicate lookup types with different names - keep naming consistent
                        </Paragraph>
                      </Card>
                    </Space>
                  </div>
                </div>
              )
            },
            {
              key: 'examples',
              label: (
                <span>
                  <ThunderboltOutlined /> Real-World Examples
                </span>
              ),
              children: (
                <div>
                  {/* CleverTap Integration */}
                  <div style={sectionStyle}>
                    <Title level={4}>Example 1: CleverTap CRM Integration</Title>
                    <Paragraph>
                      Mapping appointment types to CleverTap event categories:
                    </Paragraph>

                    <Text strong>Lookup Table Setup:</Text>
                    <div style={{ marginTop: spacing[3], marginBottom: spacing[3] }}>
                      <Card size="small" style={{ background: colors.neutral[50] }}>
                        <Text>Type: <code>APPOINTMENT_TYPE</code></Text>
                      </Card>
                      <ul style={{ marginTop: 8 }}>
                        <li><code>NEW_PATIENT</code> → <code>first_visit</code></li>
                        <li><code>FOLLOW_UP</code> → <code>follow_up_visit</code></li>
                        <li><code>EMERGENCY</code> → <code>emergency_visit</code></li>
                      </ul>
                    </div>

                    <Text strong>Transformation Script:</Text>
                    <pre style={codeBlockStyle}>{`const eventCategory = lookup(payload.appointmentType, 'APPOINTMENT_TYPE');

return {
  identity: payload.patientEmail,
  ts: Date.now(),
  type: "event",
  evtName: "Appointment Scheduled",
  evtData: {
    category: eventCategory || 'general_visit',
    doctorName: payload.doctorName,
    appointmentDate: payload.scheduledDate,
    clinicLocation: payload.clinicName
  }
};`}</pre>
                  </div>

                  {/* Billing Integration */}
                  <div style={sectionStyle}>
                    <Title level={4}>Example 2: Insurance Billing Integration</Title>
                    <Paragraph>
                      Converting internal service codes to CPT codes for insurance claims:
                    </Paragraph>

                    <Text strong>Lookup Table Setup:</Text>
                    <div style={{ marginTop: spacing[3], marginBottom: spacing[3] }}>
                      <Card size="small" style={{ background: colors.neutral[50] }}>
                        <Text>Type: <code>CPT_CODE</code></Text>
                      </Card>
                      <ul style={{ marginTop: 8 }}>
                        <li><code>GENERAL_CONSULT</code> → <code>99213</code> (Office visit)</li>
                        <li><code>DETAILED_EXAM</code> → <code>99215</code> (Comprehensive)</li>
                        <li><code>LAB_CBC</code> → <code>85025</code> (Complete Blood Count)</li>
                      </ul>
                    </div>

                    <Text strong>Transformation Script:</Text>
                    <pre style={codeBlockStyle}>{`const cptCode = lookup(payload.serviceCode, 'CPT_CODE');

if (!cptCode) {
  logger.error(\`Missing CPT mapping for: \${payload.serviceCode}\`);
  return null; // Block submission if CPT code required
}

return {
  claimId: payload.billNumber,
  patientId: payload.patientId,
  services: [{
    code: cptCode,
    description: payload.serviceDescription,
    quantity: 1,
    charges: payload.amount
  }],
  providerNPI: payload.doctorNPI,
  dateOfService: payload.billDate
};`}</pre>
                  </div>

                  {/* Multi-Location Scenario */}
                  <div style={sectionStyle}>
                    <Title level={4}>Example 3: Multi-Location Provider Network</Title>
                    <Paragraph>
                      Different clinics may use different external system IDs. Use entity-specific overrides:
                    </Paragraph>

                    <Text strong>Setup:</Text>
                    <div style={{ marginTop: spacing[3], marginBottom: spacing[3] }}>
                      <Alert
                        type="info"
                        showIcon
                        message="Parent Level Mapping"
                        description={
                          <div>
                            <Text>Type: <code>PROVIDER_NETWORK_ID</code></Text>
                            <ul style={{ marginTop: 8, marginBottom: 0 }}>
                              <li>Default clinic mapping: <code>CLINIC_MAIN</code> → <code>NETWORK_001</code></li>
                            </ul>
                          </div>
                        }
                      />
                      <div style={{ marginTop: spacing[3] }}>
                        <Alert
                          type="warning"
                          showIcon
                          message="Entity Override for Clinic #2"
                          description={
                            <div>
                              <Text>Override for specific entity (RID: 150)</Text>
                              <ul style={{ marginTop: 8, marginBottom: 0 }}>
                                <li><code>CLINIC_MAIN</code> → <code>NETWORK_BRANCH_05</code></li>
                              </ul>
                            </div>
                          }
                        />
                      </div>
                    </div>

                    <Text strong>Result:</Text>
                    <Paragraph>
                      When events come from Clinic #2 (entity RID 150), the lookup will use <code>NETWORK_BRANCH_05</code> instead
                      of the parent-level <code>NETWORK_001</code>.
                    </Paragraph>
                  </div>
                </div>
              )
            }
          ]}
        />

        <Divider />

        {/* Footer Help */}
        <Alert
          type="success"
          showIcon
          message="Need Help?"
          description={
            <div>
              <Paragraph>
                If you need assistance setting up lookup tables or have questions about code mappings:
              </Paragraph>
              <ul style={{ marginBottom: 0 }}>
                <li>Check the <strong>Lookup Tables</strong> section to view and manage your mappings</li>
                <li>Use the <strong>Stats</strong> page to see which mappings are being used most</li>
                <li>Review the <strong>Delivery Logs</strong> to see if lookups are working correctly</li>
              </ul>
            </div>
          }
        />
      </Card>
    </div>
  );
};
