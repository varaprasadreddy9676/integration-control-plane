import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useNavigateWithParams } from '../../../utils/navigation';
import {
  Form,
  Card,
  Space,
  Button,
  Input,
  Typography,
  Divider,
  Alert,
  Switch,
  Modal,
  App,
  Collapse,
  Tabs,
  Badge,
  Tooltip,
  Tag,
  Select,
  Radio
} from 'antd';
import {
  SaveOutlined,
  ArrowLeftOutlined,
  ApiOutlined,
  LockOutlined,
  CodeOutlined,
  SendOutlined,
  CopyOutlined,
  ThunderboltOutlined,
  CheckCircleOutlined,
  EyeOutlined,
  InfoCircleOutlined,
  CaretRightOutlined,
  MailOutlined,
  MessageOutlined,
  WhatsAppOutlined
} from '@ant-design/icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Editor from '@monaco-editor/react';
import { cssVar, useDesignTokens } from '../../../design-system/utils';
import {
  getInboundIntegration,
  createInboundIntegration,
  updateInboundIntegration,
  getUIConfig,
  testInboundRuntime
} from '../../../services/api';
import { PageHeader } from '../../../components/common/PageHeader';
import {
  AuthenticationFields,
  HttpConfigFields
} from '../../../shared/integration-forms';

const { Text, Paragraph } = Typography;

export const InboundIntegrationDetailRoute = () => {
  const { id } = useParams();
  const navigate = useNavigateWithParams();
  const queryClient = useQueryClient();
  const { spacing } = useDesignTokens();
  const colors = cssVar.legacy;
  const { message: messageApi } = App.useApp();
  const isCreate = !id || id === 'new';

  const [form] = Form.useForm();
  const [isSaving, setIsSaving] = useState(false);
  const [requestTransformEnabled, setRequestTransformEnabled] = useState(false);
  const [responseTransformEnabled, setResponseTransformEnabled] = useState(false);

  // Watch form fields to trigger re-render and unlock tabs dynamically
  const formName = Form.useWatch('name', form);
  const formType = Form.useWatch('type', form);
  const formTargetUrl = Form.useWatch('targetUrl', form);
  const formHttpMethod = Form.useWatch('httpMethod', form);
  const streamResponse = Form.useWatch('streamResponse', form);
  const actionType = Form.useWatch('actionType', form); // NEW: HTTP or COMMUNICATION
  const communicationChannel = Form.useWatch(['communicationConfig', 'channel'], form); // EMAIL, SMS, etc.
  const communicationProvider = Form.useWatch(['communicationConfig', 'provider'], form); // SMTP, GMAIL_OAUTH, etc.

  const runtimeUrlPreview = useMemo(() => {
    const apiBase = import.meta.env.VITE_API_BASE_URL || 'http://localhost:4000/api/v1';
    const base = apiBase.replace(/\/$/, '');
    const typedType = typeof formType === 'string' ? formType.trim() : '';
    const typeSegment = typedType ? encodeURIComponent(typedType) : '<type>';
    return `${base}/integrations/${typeSegment}?orgId=<orgId>`;
  }, [formType]);

  // Watch SMTP fields for reactive button enabling
  const smtpHost = Form.useWatch(['communicationConfig', 'smtp', 'host'], form);
  const smtpPort = Form.useWatch(['communicationConfig', 'smtp', 'port'], form);
  const smtpUsername = Form.useWatch(['communicationConfig', 'smtp', 'username'], form);
  const smtpPassword = Form.useWatch(['communicationConfig', 'smtp', 'password'], form);
  const smtpFromEmail = Form.useWatch(['communicationConfig', 'smtp', 'fromEmail'], form);

  // Automatically disable response transformation when streaming is enabled
  useEffect(() => {
    if (streamResponse && responseTransformEnabled) {
      setResponseTransformEnabled(false);
    }
  }, [streamResponse, responseTransformEnabled]);

  const [curlModalOpen, setCurlModalOpen] = useState(false);
  const [curlApiKey, setCurlApiKey] = useState('');
  const [curlInboundKey, setCurlInboundKey] = useState('');
  const [curlQueryParams, setCurlQueryParams] = useState<Array<{ name: string; value: string }>>([]);
  const defaultApiKey = import.meta.env.VITE_API_KEY || '';
  const [testEmailModalOpen, setTestEmailModalOpen] = useState(false);
  const [testEmailAddress, setTestEmailAddress] = useState('');
  const [testEmailSubject, setTestEmailSubject] = useState('Test Email from Integration Gateway');
  const [testEmailBody, setTestEmailBody] = useState('<h1>Test Email</h1><p>This is a test email sent from the Integration Gateway.</p>');
  const [isSendingTest, setIsSendingTest] = useState(false);
  const [activeTab, setActiveTab] = useState('basic');
  const getDefaultRequestTransformScript = (actionType: string) => {
    if (actionType === 'COMMUNICATION') {
      return `/**
 * Email Transformation - Client Request → Email Format
 *
 * Transform incoming request data into email format.
 * Required fields: to, subject, html
 * Optional fields: text, attachments
 */

// Simple email transformation
return {
  to: payload.patientEmail || payload.email,
  subject: \`Appointment Confirmed - \${payload.appointmentDate}\`,
  html: \`
    <h1>Hello \${payload.patientName}!</h1>
    <p>Your appointment has been confirmed.</p>
    <p><strong>Date:</strong> \${payload.appointmentDate}</p>
    <p><strong>Doctor:</strong> \${payload.doctorName}</p>
  \`,
  text: \`Hello \${payload.patientName}! Your appointment is confirmed for \${payload.appointmentDate}\`
};

/*
Example 2: Multiple recipients
return {
  to: [payload.patientEmail, payload.guardianEmail],
  subject: 'Test Results Available',
  html: '<h1>Your test results are ready</h1><p>Please visit the portal to view.</p>'
};

Example 3: Email with attachment (base64 encoded)
return {
  to: payload.email,
  subject: 'Invoice Attached',
  html: '<h1>Invoice</h1><p>Please find your invoice attached.</p>',
  attachments: [
    {
      filename: 'invoice.pdf',
      content: payload.pdfBase64,
      encoding: 'base64',
      contentType: 'application/pdf'
    }
  ]
};

Example 4: Fetch patient data and compose email
const patient = await http.get(\`https://api.yourserver.com/patients/\${payload.patientId}\`);

if (patient.status !== 200) {
  throw new Error('Failed to fetch patient data');
}

return {
  to: patient.data.email,
  subject: \`Welcome, \${patient.data.firstName}!\`,
  html: \`
    <h1>Welcome to Our Hospital</h1>
    <p>Dear \${patient.data.firstName} \${patient.data.lastName},</p>
    <p>Your registration is complete. Your patient ID is: \${patient.data.id}</p>
  \`
};
*/`;
    }

    // Default HTTP transformation
    return `/**
 * Request Transformation - Client App → External API
 *
 * IMPORTANT: Paste function BODY only (not the full function declaration)
 * The code is automatically wrapped in: async function transform(payload, context) { ... }
 *
 * Available globals:
 * - http.get(url, options), http.post(url, data, options), etc.
 * - context.http (same as http)
 * - epoch(dateStr), datetime(date, time, tz), trim(str), uppercase(str), etc.
 *
 * Returns: Transformed request body (or the original payload)
 */

// Default: pass-through (no transformation)
return payload;

/*
Example 1: Simple field mapping
return {
  patient_id: payload.patientId,
  full_name: payload.patientName,
  email: payload.email
};

Example 2: Fetch additional data from external API
const response = await http.get(
  \`https://api.example.com/patients/\${payload.patientId}\`,
  { headers: { 'Authorization': 'Bearer TOKEN' }, timeout: 15000 }
);

if (response.status !== 200) {
  throw new Error(\`Failed to fetch patient: \${response.status}\`);
}

return {
  ...payload,
  externalData: response.data
};

Example 3: Loop through list and enrich each item
const patients = payload.patientList || [];
const enriched = [];

for (const patient of patients) {
  const res = await http.get(\`https://api.example.com/patients/\${patient.id}\`);
  if (res.status === 200) {
    enriched.push({ ...patient, details: res.data });
  }
}

return { patients: enriched };

Example 4: Sequential API calls with conditional logic
const eligCheck = await http.post(
  'https://api.insurance.com/eligibility',
  { memberId: payload.memberId, serviceDate: payload.date }
);

if (eligCheck.status !== 200 || !eligCheck.data.isEligible) {
  return { status: 'INELIGIBLE', reason: eligCheck.data.reason };
}

const auth = await http.post(
  'https://api.insurance.com/authorization',
  { memberId: payload.memberId, referenceId: eligCheck.data.refId }
);

return {
  status: 'AUTHORIZED',
  authNumber: auth.data.authNumber,
  validUntil: auth.data.validUntil
};
*/`;
  };

  const [requestTransformScript, setRequestTransformScript] = useState(getDefaultRequestTransformScript('HTTP'));
  const [responseTransformScript, setResponseTransformScript] = useState(`/**
 * Response Transformation - External API → Client App
 *
 * IMPORTANT: Paste function BODY only (not the full function declaration)
 * The code is automatically wrapped in: async function transform(payload, context) { ... }
 *
 * Input 'payload' shape: { data, status, headers }
 * - payload.data: Response body from external API
 * - payload.status: HTTP status code (e.g., 200, 404)
 * - payload.headers: Response headers object
 *
 * Available: http.get/post/etc, context.http, epoch(), datetime(), etc.
 */

// Default: pass-through (no transformation)
return payload.data;

/*
Example 1: Extract and map specific fields
return {
  success: payload.status === 200,
  externalId: payload.data.id,
  message: payload.data.message || 'Success',
  timestamp: new Date().toISOString()
};

Example 2: Make additional API call based on response
if (payload.status === 200 && payload.data.requiresFollowup) {
  const followup = await http.post(
    'https://api.example.com/followup',
    { referenceId: payload.data.id }
  );

  return {
    ...payload.data,
    followup: followup.data,
    followupStatus: followup.status
  };
}

return payload.data;

Example 3: Handle errors gracefully
if (payload.status >= 400) {
  return {
    success: false,
    error: payload.data.error || 'External API error',
    httpStatus: payload.status
  };
}

return {
  success: true,
  data: payload.data
};
*/`);

  // Watch form values
  const authType = Form.useWatch('inboundAuthType', form);

  // Fetch UI config
  const { data: uiConfig } = useQuery({
    queryKey: ['ui-config'],
    queryFn: getUIConfig
  });

  // Fetch integration if editing
  const { data: integration, isLoading } = useQuery({
    queryKey: ['inbound-integration', id],
    queryFn: () => getInboundIntegration(id!),
    enabled: !isCreate
  });

  // Update transformation script template when action type changes
  useEffect(() => {
    if (actionType && !integration) {
      // Only update template for new integrations
      setRequestTransformScript(getDefaultRequestTransformScript(actionType));
    }
  }, [actionType, integration]);

  const inferCurlQueryParams = (integrationConfig: any) => {
    if (!integrationConfig) return [];
    const httpMethod = (integrationConfig.httpMethod || 'POST').toUpperCase();
    if (httpMethod !== 'GET') return [];

    const extractQueryParamsFromTemplate = (template?: string) => {
      const params = new Set<string>();
      if (!template || typeof template !== 'string') return params;
      const re = /\{\{\s*query\.([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g;
      let match = re.exec(template);
      while (match) {
        params.add(match[1]);
        match = re.exec(template);
      }
      return params;
    };

    const addDestructuredKeys = (params: Set<string>, source: string) => {
      source
        .split(',')
        .map((part) => part.trim())
        .forEach((part) => {
          if (!part) return;
          const withoutDefault = part.replace(/=.*$/, '').trim();
          const withoutSpread = withoutDefault.replace(/^\.\.\./, '').trim();
          const key = withoutSpread.split(':')[0]?.trim();
          if (key && /^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
            params.add(key);
          }
        });
    };

    const extractQueryParamsFromScript = (script?: string) => {
      const params = new Set<string>();
      if (!script || typeof script !== 'string') return params;

      const dotPatterns = [/\b(?:context|ctx)(?:\s*\?\.)?\s*\.\s*query(?:\s*\?\.)?\s*\.\s*([A-Za-z_][A-Za-z0-9_]*)/g, /\bquery(?:\s*\?\.)?\s*\.\s*([A-Za-z_][A-Za-z0-9_]*)/g];
      for (const pattern of dotPatterns) {
        let match = pattern.exec(script);
        while (match) {
          params.add(match[1]);
          match = pattern.exec(script);
        }
      }

      const destructurePatterns = [/\{([^}]+)\}\s*=\s*(?:context|ctx)\s*\.\s*query\b/g, /\{([^}]+)\}\s*=\s*query\b/g];
      for (const pattern of destructurePatterns) {
        let match = pattern.exec(script);
        while (match) {
          addDestructuredKeys(params, match[1]);
          match = pattern.exec(script);
        }
      }

      return params;
    };

    const orgId = integrationConfig.orgId;
    const paramNames = new Set<string>();
    extractQueryParamsFromTemplate(integrationConfig.targetUrl).forEach((param) => paramNames.add(param));
    extractQueryParamsFromScript(integrationConfig.requestTransformation?.script).forEach((param) => paramNames.add(param));

    if ((paramNames.has('entityName') || paramNames.has('identifier')) && !paramNames.has('entityId')) {
      paramNames.add('entityId');
    }
    paramNames.delete('orgId');

    const defaultSampleValue = (name: string) => {
      if (name === 'entityId') return String(orgId ?? 84);
      if (name === 'entityName') return 'PAPPAMPATTI';
      if (name === 'identifier') return 'SEHPAP-3045';
      return `sample_${name}`;
    };

    const preferredOrder = ['entityId', 'entityName', 'identifier'];
    const orderedNames = Array.from(paramNames).sort((a, b) => {
      const aIdx = preferredOrder.indexOf(a);
      const bIdx = preferredOrder.indexOf(b);
      if (aIdx !== -1 && bIdx !== -1) return aIdx - bIdx;
      if (aIdx !== -1) return -1;
      if (bIdx !== -1) return 1;
      return a.localeCompare(b);
    });

    return orderedNames.map((name) => ({ name, value: defaultSampleValue(name) }));
  };

  const buildInboundCurl = (
    integrationConfig: any,
    options?: { apiKey?: string; inboundKey?: string; queryParams?: Record<string, string> }
  ) => {
    if (!integrationConfig) return '';
    const apiBase = import.meta.env.VITE_API_BASE_URL || 'http://localhost:4000/api/v1';
    const base = apiBase.replace(/\/$/, '');
    const httpMethod = (integrationConfig.httpMethod || 'POST').toUpperCase();
    const orgId = integrationConfig.orgId;
    const headers: string[] = [];
    const apiKey = options?.apiKey?.trim();
    const inboundKey = options?.inboundKey?.trim();
    const inferredParams = inferCurlQueryParams(integrationConfig);

    const queryEntries: Array<[string, string]> = [['orgId', String(orgId ?? 84)]];
    if (httpMethod === 'GET') {
      inferredParams.forEach((param) => {
        const customValue = options?.queryParams?.[param.name];
        queryEntries.push([param.name, customValue ?? param.value]);
      });
    }
    const queryString = new URLSearchParams(queryEntries).toString();
    const url = `${base}/integrations/${encodeURIComponent(integrationConfig.type)}?${queryString}`;

    if (integrationConfig.inboundAuthType === 'API_KEY') {
      const headerName = (integrationConfig.inboundAuthConfig?.headerName || 'x-api-key').toLowerCase();
      if (headerName === 'x-api-key') {
        const value = inboundKey || apiKey || '<API_KEY>';
        headers.push(`-H "X-API-Key: ${value}"`);
      } else {
        headers.push(`-H "X-API-Key: ${apiKey || '<API_KEY>'}"`);
        headers.push(`-H "${headerName}: ${inboundKey || '<INBOUND_API_KEY>'}"`);
      }
    } else {
      headers.push(`-H "X-API-Key: ${apiKey || '<API_KEY>'}"`);
    }

    if (httpMethod !== 'GET') {
      headers.push(`-H "Content-Type: application/json"`);
    }

    if (integrationConfig.inboundAuthType === 'BEARER') {
      headers.push(`-H "Authorization: Bearer <INBOUND_TOKEN>"`);
    } else if (integrationConfig.inboundAuthType === 'BASIC') {
      headers.push(`-H "Authorization: Basic <BASE64_USER_PASS>"`);
    }

    const isEmailCommunication = integrationConfig.type === 'EMAIL' ||
      integrationConfig.actions?.some((a: any) => a.kind === 'COMMUNICATION');

    let dataPart = '';
    if (httpMethod !== 'GET') {
      if (isEmailCommunication) {
        const sampleBody = {
          to: 'recipient@example.com',
          subject: 'Test Email',
          html: '<h1>Test</h1><p>This is a test email.</p>',
          attachments: [
            {
              filename: 'document.pdf',
              content: '<BASE64_ENCODED_PDF>',
              encoding: 'base64',
              contentType: 'application/pdf'
            }
          ]
        };
        dataPart = ` \\\n  --data-raw '${JSON.stringify(sampleBody, null, 2)}'`;
      } else {
        dataPart = ` \\\n  -d '{}'`;
      }
    }

    return `curl -X ${httpMethod} "${url}" \\\n  ${headers.join(' \\\n  ')}${dataPart}`;
  };

  const handleCopyCurl = () => {
    if (!integration) return;
    setCurlApiKey(defaultApiKey);
    setCurlInboundKey('');
    setCurlQueryParams(inferCurlQueryParams(integration));
    setCurlModalOpen(true);
  };

  const handleConfirmCopyCurl = () => {
    if (!integration) return;
    const queryParams = Object.fromEntries(curlQueryParams.map((param) => [param.name, param.value]));
    const curl = buildInboundCurl(integration, { apiKey: curlApiKey, inboundKey: curlInboundKey, queryParams });
    if (!curl) return;
    navigator.clipboard.writeText(curl).then(() => {
      messageApi.success('Curl command copied');
      setCurlModalOpen(false);
    }).catch(() => {
      messageApi.error('Failed to copy curl command');
    });
  };

  const handleTestRuntime = async () => {
    if (!integration) return;
    const hide = messageApi.loading('Testing runtime endpoint...', 0);
    try {
      await testInboundRuntime({
        type: integration.type,
        httpMethod: integration.httpMethod
      });
      hide();
      messageApi.success('Runtime call succeeded');
    } catch (error: any) {
      hide();
      messageApi.error(error.message || 'Runtime call failed');
    }
  };

  const handleOpenTestEmailModal = () => {
    setTestEmailAddress('');
    setTestEmailSubject('Test Email from Integration Gateway');
    setTestEmailBody('<h1>Test Email</h1><p>This is a test email sent from the Integration Gateway.</p>');
    setTestEmailModalOpen(true);
  };

  const handleSendTestEmail = async () => {
    if (!integration || !testEmailAddress) return;

    try {
      setIsSendingTest(true);
      const { testInboundIntegration } = await import('../../../services/api');

      const response = await testInboundIntegration(integration._id, {
        to: testEmailAddress,
        subject: testEmailSubject,
        html: testEmailBody
      }) as any;

      if (response.success) {
        const messageId = response.messageId || response.response?.messageId;
        messageApi.success(
          messageId
            ? `Test email sent successfully! Message ID: ${messageId}`
            : (response.message || 'Test email sent successfully!')
        );
        setTestEmailModalOpen(false); // Close modal on success
      } else {
        messageApi.error(response.error || 'Test email failed');
      }
    } catch (error: any) {
      const errorMsg = error.response?.data?.error || error.response?.data?.details || error.message || 'Failed to send test email';
      messageApi.error(errorMsg);
    } finally {
      setIsSendingTest(false);
    }
  };

  // Populate form when editing
  useEffect(() => {
    if (integration && !isCreate) {
      const requestScript = integration.requestTransformation?.script;
      const responseScript = integration.responseTransformation?.script;

      // Detect action type based on presence of actions array
      const detectedActionType = integration.actions && integration.actions.length > 0 ? 'COMMUNICATION' : 'HTTP';

      form.setFieldsValue({
        name: integration.name,
        type: integration.type,
        actionType: detectedActionType,
        inboundAuthType: integration.inboundAuthType,
        inboundAuthConfig: integration.inboundAuthConfig,
        targetUrl: integration.targetUrl,
        httpMethod: integration.httpMethod || 'POST',
        timeout: integration.timeout || 10000,
        retryCount: integration.retryCount || 3,
        contentType: integration.contentType || 'application/json',
        streamResponse: integration.streamResponse || false,
        communicationConfig: integration.actions?.[0]?.communicationConfig || {
          channel: 'EMAIL',
          provider: 'SMTP'
        }
      });

      // Set request and response transformation scripts
      if (requestScript) {
        setRequestTransformScript(requestScript);
      }
      if (responseScript) {
        setResponseTransformScript(responseScript);
      }

      setRequestTransformEnabled(Boolean(requestScript && requestScript.trim()));
      setResponseTransformEnabled(Boolean(responseScript && responseScript.trim()));
    }
  }, [integration, isCreate, form]);

  // Custom form validation
  const validateForm = async () => {
    const currentActionType = form.getFieldValue('actionType');

    // For COMMUNICATION integrations, bypass HTTP field validation
    if (currentActionType === 'COMMUNICATION') {
      // Temporarily set dummy values for HTTP fields to pass their required validation
      const originalValues = form.getFieldsValue();
      form.setFieldsValue({
        targetUrl: 'https://dummy.communication.placeholder',
        httpMethod: 'POST',
        timeout: 10000,
        retryCount: 3,
        contentType: 'application/json',
        streamResponse: false
      });

      // Clear any errors on HTTP-specific fields
      form.setFields([
        { name: 'targetUrl', errors: [] },
        { name: 'httpMethod', errors: [] },
        { name: 'timeout', errors: [] },
        { name: 'retryCount', errors: [] },
        { name: 'contentType', errors: [] },
        { name: 'streamResponse', errors: [] }
      ]);

      // Validate only COMMUNICATION-specific fields
      await form.validateFields([
        'name',
        'type',
        'actionType',
        ['communicationConfig', 'channel'],
        ['communicationConfig', 'provider'],
        ['communicationConfig', 'smtp', 'host'],
        ['communicationConfig', 'smtp', 'port'],
        ['communicationConfig', 'smtp', 'username'],
        ['communicationConfig', 'smtp', 'password'],
        ['communicationConfig', 'smtp', 'fromEmail']
      ]);

      // Restore original values (remove dummy HTTP values)
      form.setFieldsValue({
        targetUrl: originalValues.targetUrl,
        httpMethod: originalValues.httpMethod,
        timeout: originalValues.timeout,
        retryCount: originalValues.retryCount,
        contentType: originalValues.contentType,
        streamResponse: originalValues.streamResponse
      });
    } else {
      // For HTTP integrations, validate all fields normally
      await form.validateFields();
    }

    return form.getFieldsValue();
  };

  // Handle form submission
  const handleSubmit = async () => {
    if (isSaving) return;

    try {
      setIsSaving(true);

      // Validate form with custom logic
      const values = await validateForm();

      // Build payload based on action type
      let payload: any = {
        name: values.name,
        type: values.type,
        direction: 'INBOUND',
        inboundAuthType: values.inboundAuthType,
        inboundAuthConfig: values.inboundAuthConfig,
        requestTransformation: {
          mode: 'SCRIPT',
          script: requestTransformEnabled ? requestTransformScript : ''
        },
        isActive: true
      };

      if (values.actionType === 'COMMUNICATION') {
        // COMMUNICATION integration
        payload.actions = [
          {
            name: `Send ${values.communicationConfig.channel}`,
            kind: 'COMMUNICATION',
            communicationConfig: values.communicationConfig
          }
        ];
        // Response transformation not used for COMMUNICATION
      } else {
        // HTTP integration
        payload.targetUrl = values.targetUrl;
        payload.httpMethod = values.httpMethod || 'POST';
        payload.timeout = values.timeout || 10000;
        payload.retryCount = values.retryCount || 3;
        payload.contentType = values.contentType || 'application/json';
        payload.streamResponse = values.streamResponse || false;
        payload.responseTransformation = {
          mode: 'SCRIPT',
          script: (responseTransformEnabled && !values.streamResponse) ? responseTransformScript : ''
        };
      }

      if (isCreate) {
        await createInboundIntegration(payload);
        messageApi.success('Inbound integration created successfully');
      } else {
        await updateInboundIntegration(id!, payload);
        messageApi.success('Inbound integration updated successfully');
      }

      queryClient.invalidateQueries({ queryKey: ['inbound-integrations'] });
      navigate('/inbound-integrations');
    } catch (error: any) {
      messageApi.error(error.message || 'Failed to save inbound integration');
    } finally {
      setIsSaving(false);
    }
  };

  // Helper function to check if a tab is complete (uses watched values for reactivity)
  const isTabComplete = (tabKey: string): boolean => {
    switch (tabKey) {
      case 'basic':
        if (actionType === 'COMMUNICATION') {
          return !!(formName && formType && communicationChannel && communicationProvider);
        }
        return !!(formName && formType);
      case 'http':
        if (actionType === 'COMMUNICATION') {
          // Check if SMTP config is complete
          if (communicationProvider === 'SMTP') {
            return !!(smtpHost && smtpPort && smtpUsername && smtpPassword && smtpFromEmail);
          }
          return true;
        }
        return !!(formTargetUrl && formHttpMethod);
      case 'auth':
        return true; // Auth is optional (can be NONE)
      case 'request-transform':
        return true; // Transformation is optional
      case 'response-transform':
        return true; // Transformation is optional
      default:
        return false;
    }
  };

  // Check completion status for progressive disclosure
  const basicComplete = isTabComplete('basic');
  const httpComplete = isTabComplete('http');

  return (
    <div style={{ minHeight: '100vh', background: cssVar.bg.base, paddingBottom: spacing[8] }}>
      {/* Page Header */}
      <PageHeader
        title={isCreate ? 'Create Inbound Integration' : 'Edit Inbound Integration'}
        description={
          actionType === 'COMMUNICATION'
            ? 'Send emails, SMS, and notifications - Client App → Gateway → Communication Provider'
            : 'Real-time API proxy - Client App → Gateway → External API → Response'
        }
        breadcrumb={[
          { label: 'Configuration', path: '/integrations' },
          { label: 'Inbound Integrations', path: '/inbound-integrations' },
          { label: isCreate ? 'New' : integration?.name || 'Edit' }
        ]}
        compact
      />

      {/* Form */}
      <Form
        form={form}
        layout="vertical"
        onFinish={handleSubmit}
        style={{ margin: `0 ${spacing[3]} ${spacing[4]}` }}
        initialValues={{
          actionType: 'HTTP', // NEW: HTTP or COMMUNICATION
          httpMethod: 'POST',
          timeout: 10000,
          retryCount: 3,
          contentType: 'application/json',
          inboundAuthType: 'NONE',
          communicationConfig: {
            channel: 'EMAIL',
            provider: 'SMTP'
          }
        }}
      >
        <Tabs
          className="inbound-integration-tabs"
          activeKey={activeTab}
          onChange={setActiveTab}
          size="middle"
          tabBarStyle={{ marginBottom: spacing[2] }}
          style={{
            background: cssVar.bg.surface,
            border: `1px solid ${cssVar.border.default}`,
            borderRadius: 8
          }}
          items={[
            {
              key: 'basic',
              label: (
                <Space size={6}>
                  <ApiOutlined />
                  Basic Info
                  {basicComplete && (
                    <CheckCircleOutlined style={{ color: colors.success[600], fontSize: 14 }} />
                  )}
                </Space>
              ),
              disabled: false, // First tab always enabled
              children: (
                <Card style={{ marginTop: spacing[2] }} size="small">
                  <Space direction="vertical" size="large" style={{ width: '100%' }}>
                    <Form.Item
                      name="name"
                      label="Integration Name"
                      rules={[{ required: true, message: 'Name is required' }]}
                    >
                      <Input
                        size="large"
                        placeholder="e.g., CleverTap Real-time Sync"
                      />
                    </Form.Item>

                    <Form.Item
                      name="type"
                      label={(
                        <Space size={6}>
                          Integration Type
                          <Tooltip
                            title={(
                              <div>
                                This value becomes the runtime endpoint path:
                                <br />
                                <code>{runtimeUrlPreview}</code>
                              </div>
                            )}
                          >
                            <InfoCircleOutlined />
                          </Tooltip>
                        </Space>
                      )}
                      extra="Unique identifier for this integration type (e.g., 'clevertap', 'zoho-crm')"
                      rules={[
                        { required: true, message: 'Type is required' },
                        ...(isCreate
                          ? [
                              {
                                pattern: /^[a-z0-9-]+$/,
                                message: 'Type must be lowercase alphanumeric with hyphens only'
                              }
                            ]
                          : [])
                      ]}
                    >
                      <Input
                        size="large"
                        placeholder="e.g., clevertap"
                      />
                    </Form.Item>

                    <Form.Item
                      name="actionType"
                      label="Action Type"
                      extra="HTTP: Proxy to external API | COMMUNICATION: Send emails, SMS, WhatsApp, etc."
                      rules={[{ required: true, message: 'Action type is required' }]}
                    >
                      <Radio.Group size="large">
                        <Radio.Button value="HTTP">
                          <Space>
                            <ApiOutlined />
                            HTTP Proxy
                          </Space>
                        </Radio.Button>
                        <Radio.Button value="COMMUNICATION">
                          <Space>
                            <MailOutlined />
                            Communication
                          </Space>
                        </Radio.Button>
                      </Radio.Group>
                    </Form.Item>

                    {actionType === 'COMMUNICATION' && (
                      <>
                        <Form.Item
                          name={['communicationConfig', 'channel']}
                          label="Communication Channel"
                          rules={[{ required: true, message: 'Channel is required' }]}
                        >
                          <Select size="large" placeholder="Select channel">
                            <Select.Option value="EMAIL">
                              <Space>
                                <MailOutlined />
                                Email
                              </Space>
                            </Select.Option>
                            <Select.Option value="SMS" disabled>
                              <Space>
                                <MessageOutlined />
                                SMS (Coming Soon)
                              </Space>
                            </Select.Option>
                            <Select.Option value="WHATSAPP" disabled>
                              <Space>
                                <WhatsAppOutlined />
                                WhatsApp (Coming Soon)
                              </Space>
                            </Select.Option>
                          </Select>
                        </Form.Item>

                        <Form.Item
                          name={['communicationConfig', 'provider']}
                          label="Email Provider"
                          rules={[{ required: true, message: 'Provider is required' }]}
                        >
                          <Select size="large" placeholder="Select provider">
                            <Select.Option value="SMTP">SMTP (Gmail, Outlook, Custom)</Select.Option>
                            <Select.Option value="GMAIL_OAUTH" disabled>Gmail OAuth 2.0 (Coming Soon)</Select.Option>
                            <Select.Option value="OUTLOOK_OAUTH" disabled>Outlook OAuth 2.0 (Coming Soon)</Select.Option>
                          </Select>
                        </Form.Item>
                      </>
                    )}

                    <Divider style={{ margin: `${spacing[4]} 0` }} />

                    <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                      <Button
                        type="primary"
                        size="large"
                        onClick={() => setActiveTab('http')}
                        disabled={!basicComplete}
                      >
                        Continue to Provider Config
                      </Button>
                    </div>
                  </Space>
                </Card>
              )
            },
            {
              key: 'http',
              label: (
                <Space size={6}>
                  {actionType === 'COMMUNICATION' ? <MailOutlined /> : <SendOutlined />}
                  {actionType === 'COMMUNICATION' ? 'Provider Config' : 'Target API'}
                  {httpComplete && (
                    <CheckCircleOutlined style={{ color: colors.success[600], fontSize: 14 }} />
                  )}
                </Space>
              ),
              disabled: !basicComplete, // Requires Basic Info to be complete
              children: (
                <Card style={{ marginTop: spacing[2] }} size="small">
                  {actionType === 'COMMUNICATION' ? (
                    <Space direction="vertical" size="large" style={{ width: '100%' }}>
                      <Alert
                        type="info"
                        showIcon
                        message="Email Provider Configuration"
                        description="Configure your SMTP credentials to send emails through the Integration Gateway."
                      />

                      {communicationProvider === 'SMTP' && (
                        <>
                          <Form.Item
                            name={['communicationConfig', 'smtp', 'host']}
                            label="SMTP Host"
                            rules={[{ required: true, message: 'SMTP host is required' }]}
                            extra="e.g., smtp.gmail.com, smtp-mail.outlook.com, smtp.yourserver.com"
                          >
                            <Input size="large" placeholder="smtp.gmail.com" />
                          </Form.Item>

                          <Form.Item
                            name={['communicationConfig', 'smtp', 'port']}
                            label="SMTP Port"
                            rules={[{ required: true, message: 'SMTP port is required' }]}
                            extra="Common ports: 587 (TLS), 465 (SSL), 25 (Plain)"
                            normalize={(value) => {
                              const num = parseInt(value, 10);
                              return isNaN(num) ? value : num;
                            }}
                          >
                            <Input type="number" size="large" placeholder="587" />
                          </Form.Item>

                          <Form.Item
                            name={['communicationConfig', 'smtp', 'username']}
                            label="SMTP Username"
                            rules={[{ required: true, message: 'SMTP username is required' }]}
                            extra="Usually your email address"
                          >
                            <Input size="large" placeholder="your-email@gmail.com" />
                          </Form.Item>

                          <Form.Item
                            name={['communicationConfig', 'smtp', 'password']}
                            label="SMTP Password"
                            rules={[{ required: true, message: 'SMTP password is required' }]}
                            extra="For Gmail, use an App Password (not your regular password)"
                          >
                            <Input.Password size="large" placeholder="your-app-password" />
                          </Form.Item>

                          <Form.Item
                            name={['communicationConfig', 'smtp', 'fromEmail']}
                            label="From Email Address"
                            rules={[
                              { required: true, message: 'From email is required' },
                              { type: 'email', message: 'Please enter a valid email' }
                            ]}
                            extra="Email address that will appear as sender"
                          >
                            <Input size="large" placeholder="noreply@yourcompany.com" />
                          </Form.Item>

                          <Alert
                            type="warning"
                            showIcon
                            message="Gmail Setup Required"
                            description={
                              <div>
                                <p style={{ marginBottom: 8 }}>To use Gmail as your SMTP provider:</p>
                                <ol style={{ paddingLeft: 20, marginBottom: 0 }}>
                                  <li>Enable 2-factor authentication in your Google account</li>
                                  <li>Generate an App Password at <a href="https://myaccount.google.com/apppasswords" target="_blank" rel="noopener noreferrer">myaccount.google.com/apppasswords</a></li>
                                  <li>Use the 16-character app password above (not your regular password)</li>
                                </ol>
                              </div>
                            }
                          />

                          <Divider style={{ margin: `${spacing[4]} 0` }} />

                          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                            <Button size="large" onClick={() => setActiveTab('basic')}>
                              Back to Basic Info
                            </Button>
                            <Button
                              type="primary"
                              size="large"
                              onClick={() => setActiveTab('auth')}
                              disabled={!httpComplete}
                            >
                              Continue to Authentication
                            </Button>
                          </div>
                        </>
                      )}
                    </Space>
                  ) : (
                    <>
                      <HttpConfigFields
                        form={form}
                        uiConfig={uiConfig}
                        mode="inbound"
                        spacing={spacing}
                        colors={colors}
                      />

                      <Divider style={{ margin: `${spacing[4]} 0` }} />

                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <Button size="large" onClick={() => setActiveTab('basic')}>
                          Back to Basic Info
                        </Button>
                        <Button
                          type="primary"
                          size="large"
                          onClick={() => setActiveTab('auth')}
                          disabled={!httpComplete}
                        >
                          Continue to Authentication
                        </Button>
                      </div>
                    </>
                  )}
                </Card>
              )
            },
            {
              key: 'auth',
              label: (
                <Space size={6}>
                  <LockOutlined />
                  Authentication
                  {isTabComplete('auth') && (
                    <CheckCircleOutlined style={{ color: colors.success[600], fontSize: 14 }} />
                  )}
                </Space>
              ),
              disabled: !basicComplete || !httpComplete, // Requires Basic Info and Target API to be complete
              children: (
                <Card style={{ marginTop: spacing[2] }} size="small">
                  <Space direction="vertical" size="large" style={{ width: '100%' }}>
                    <AuthenticationFields
                      form={form}
                      uiConfig={uiConfig}
                      selectedAuthType={authType}
                      fieldPrefix={['inboundAuthConfig']}
                      mode="inbound"
                      spacing={spacing}
                      authTypeFieldName="inboundAuthType"
                    />

                    <Divider style={{ margin: `${spacing[4]} 0` }} />

                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <Button size="large" onClick={() => setActiveTab('http')}>
                        Back to Provider Config
                      </Button>
                      <Button
                        type="primary"
                        size="large"
                        onClick={() => setActiveTab('request-transform')}
                      >
                        Continue to Request Transform
                      </Button>
                    </div>
                  </Space>
                </Card>
              )
            },
            {
              key: 'request-transform',
              label: (
                <Space size={6}>
                  <CodeOutlined />
                  Request Transform
                  {isTabComplete('request-transform') && (
                    <CheckCircleOutlined style={{ color: colors.success[600], fontSize: 14 }} />
                  )}
                </Space>
              ),
              disabled: !basicComplete || !httpComplete, // Requires Basic Info and Target API to be complete
              children: (
                <Card style={{ marginTop: spacing[2] }} size="small">
                  <Space direction="vertical" size="middle" style={{ width: '100%' }}>
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: spacing[3],
                        flexWrap: 'wrap'
                      }}
                    >
                      <Text strong style={{ fontSize: 16 }}>Request Transform</Text>
                      <Space size="small">
                        <Text type="secondary">Enabled</Text>
                        <Switch
                          checked={requestTransformEnabled}
                          onChange={setRequestTransformEnabled}
                          size="small"
                          aria-label="Enable request transformation"
                        />
                      </Space>
                    </div>

                    {!requestTransformEnabled ? (
                      <Alert
                        type="info"
                        showIcon
                        message="Request transformation is disabled"
                        description={actionType === 'COMMUNICATION'
                          ? "Requests will be used as-is for email content. Enable to transform incoming data into email format."
                          : "Requests will be forwarded as-is. Enable to add a transformation script."}
                      />
                    ) : (
                      <>
                        {actionType === 'COMMUNICATION' ? (
                          <Alert
                            type="success"
                            showIcon
                            message="Transform Request to Email Format"
                            description={
                              <div>
                                <Paragraph style={{ marginBottom: spacing[2] }}>
                                  Transform incoming request data into email format. The Gateway will send the email asynchronously via your configured SMTP provider.
                                </Paragraph>
                                <Paragraph style={{ marginBottom: 0 }}>
                                  <Text strong>Required output:</Text> <code>to</code>, <code>subject</code>, <code>html</code><br />
                                  <Text strong>Optional output:</Text> <code>text</code>, <code>attachments</code>
                                </Paragraph>
                              </div>
                            }
                          />
                        ) : (
                          <Collapse
                            ghost
                            size="small"
                            defaultActiveKey={[]}
                            expandIconPosition="end"
                            expandIcon={({ isActive }) => <CaretRightOutlined rotate={isActive ? 90 : 0} />}
                            items={[
                              {
                                key: 'advanced-http',
                                label: (
                                  <Space size={8}>
                                    <InfoCircleOutlined />
                                    <Text strong>Advanced HTTP Transformations</Text>
                                  </Space>
                                ),
                                children: (
                                  <div>
                                    <Paragraph style={{ marginBottom: spacing[2] }}>
                                      Transform incoming requests with full async/await support and HTTP client access. Like <strong>Mirth Connect</strong>, you can:
                                    </Paragraph>
                                    <ul style={{ marginBottom: 0, paddingLeft: 20 }}>
                                      <li><strong>Fetch lists and loop</strong> - Get patient list, iterate through each to fetch details</li>
                                      <li><strong>Sequential API calls</strong> - Use response from one API to call another</li>
                                      <li><strong>Conditional workflows</strong> - If eligibility passes, call authorization API</li>
                                      <li><strong>Data aggregation</strong> - Combine multiple API responses</li>
                                    </ul>
                                    <Paragraph style={{ marginTop: spacing[2], marginBottom: 0 }}>
                                      <Text strong>Available:</Text> <code>context.http.get()</code>, <code>context.http.post()</code>, <code>context.http.put()</code>, <code>context.http.patch()</code>, <code>context.http.delete()</code>
                                    </Paragraph>
                                  </div>
                                )
                              }
                            ]}
                          />
                        )}

                        <div>
                          <Text strong style={{ display: 'block', marginBottom: spacing[2] }}>
                            JavaScript Transformation Function
                          </Text>
                          <Editor
                            height="320px"
                            language="javascript"
                            theme="vs-dark"
                            value={requestTransformScript}
                            onChange={(value) => setRequestTransformScript(value || '')}
                            options={{
                              minimap: { enabled: false },
                              fontSize: 14,
                              lineNumbers: 'on',
                              wordWrap: 'on',
                              scrollBeyondLastLine: false,
                              automaticLayout: true
                            }}
                          />
                        </div>
                      </>
                    )}

                    <Divider style={{ margin: `${spacing[4]} 0` }} />

                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <Button size="large" onClick={() => setActiveTab('auth')}>
                        Back to Authentication
                      </Button>
                      <Button
                        type="primary"
                        size="large"
                        onClick={() => setActiveTab(actionType === 'COMMUNICATION' ? 'review' : 'response-transform')}
                      >
                        {actionType === 'COMMUNICATION' ? 'Continue to Review & Submit' : 'Continue to Response Transform'}
                      </Button>
                    </div>
                  </Space>
                </Card>
              )
            },
            // Hide Response Transform tab for COMMUNICATION integrations
            ...(actionType !== 'COMMUNICATION' ? [{
              key: 'response-transform',
              label: (
                <Space size={6}>
                  <CodeOutlined />
                  Response Transform
                  {streamResponse && <Tag color="orange" style={{ fontSize: 11, marginLeft: 4 }}>Disabled</Tag>}
                  {!streamResponse && isTabComplete('response-transform') && (
                    <CheckCircleOutlined style={{ color: colors.success[600], fontSize: 14 }} />
                  )}
                </Space>
              ),
              disabled: !basicComplete || !httpComplete, // Requires Basic Info and Target API to be complete
              children: (
                <Card style={{ marginTop: spacing[2] }} size="small">
                  <Space direction="vertical" size="middle" style={{ width: '100%' }}>
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: spacing[3],
                        flexWrap: 'wrap'
                      }}
                    >
                      <Text strong style={{ fontSize: 16 }}>Response Transform</Text>
                      <Space size="small">
                        <Text type="secondary">Enabled</Text>
                        <Switch
                          checked={responseTransformEnabled}
                          onChange={setResponseTransformEnabled}
                          size="small"
                          disabled={streamResponse}
                          aria-label="Enable response transformation"
                        />
                      </Space>
                    </div>

                    {streamResponse ? (
                      <Alert
                        type="warning"
                        showIcon
                        message="Response Transformation Not Available"
                        description={
                          <div>
                            <Paragraph style={{ marginBottom: spacing[2] }}>
                              Stream Response is enabled in the Target API configuration. Response transformations cannot be applied when streaming is enabled because the response is piped directly to the client without buffering.
                            </Paragraph>
                            <Paragraph style={{ marginBottom: 0 }}>
                              <Text strong>To enable response transformations:</Text> Go to the Target API tab and disable "Stream Response"
                            </Paragraph>
                          </div>
                        }
                      />
                    ) : !responseTransformEnabled ? (
                      <Alert
                        type="info"
                        showIcon
                        message="Response transformation is disabled"
                        description="Responses will be returned as-is. Enable to add a transformation script."
                      />
                    ) : (
                      <Space direction="vertical" size="middle" style={{ width: '100%' }}>
                        <Alert
                          type="success"
                          showIcon
                          message="Transform Response Back to Client App"
                          description={
                            <div>
                              <Paragraph style={{ marginBottom: spacing[2] }}>
                                Transform external API responses before returning to the client app. You can also make additional API calls if needed (e.g., fetch related data, trigger followup actions).
                              </Paragraph>
                              <Paragraph style={{ marginBottom: 0 }}>
                                <Text strong>Input shape:</Text> <code>payload.data</code> (response body), <code>payload.status</code> (HTTP status code), <code>payload.headers</code> (response headers)
                              </Paragraph>
                            </div>
                          }
                        />

                        <div>
                          <Text strong style={{ display: 'block', marginBottom: spacing[2] }}>
                            JavaScript Transformation Function
                          </Text>
                          <Editor
                            height="320px"
                            language="javascript"
                            theme="vs-dark"
                            value={responseTransformScript}
                            onChange={(value) => setResponseTransformScript(value || '')}
                            options={{
                              minimap: { enabled: false },
                              fontSize: 14,
                              lineNumbers: 'on',
                              wordWrap: 'on',
                              scrollBeyondLastLine: false,
                              automaticLayout: true
                            }}
                          />
                        </div>
                      </Space>
                    )}

                    <Divider style={{ margin: `${spacing[4]} 0` }} />

                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <Button size="large" onClick={() => setActiveTab('request-transform')}>
                        Back to Request Transform
                      </Button>
                      <Button
                        type="primary"
                        size="large"
                        onClick={() => setActiveTab('review')}
                      >
                        Continue to Review & Submit
                      </Button>
                    </div>
                  </Space>
                </Card>
              )
            }] : []),
            {
              key: 'review',
              label: (
                <Space size={6}>
                  <EyeOutlined />
                  Review & Submit
                  {basicComplete && httpComplete && (
                    <CheckCircleOutlined style={{ color: colors.success[600], fontSize: 14 }} />
                  )}
                </Space>
              ),
              disabled: !basicComplete || !httpComplete, // Requires Basic Info and Target API to be complete
              children: (
                <Card style={{ marginTop: spacing[2] }} size="small">
                  <Space direction="vertical" size="middle" style={{ width: '100%' }}>
                    <Alert
                      type="info"
                      showIcon
                      message="Review Your Configuration"
                      description="Please review all settings before creating the integration. You can click on any tab above to make changes."
                    />

                    {/* Basic Info Summary */}
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: spacing[2], marginBottom: spacing[3] }}>
                        <ApiOutlined style={{ fontSize: 18, color: colors.primary[600] }} />
                        <Text strong style={{ fontSize: 16 }}>Basic Information</Text>
                      </div>
                      <Space direction="vertical" size="small" style={{ width: '100%', paddingLeft: spacing[4] }}>
                        <div style={{ display: 'flex', gap: spacing[2] }}>
                          <Text type="secondary" style={{ minWidth: 150 }}>Integration Name:</Text>
                          <Text strong>{form.getFieldValue('name') || <Text type="secondary">Not set</Text>}</Text>
                        </div>
                        <div style={{ display: 'flex', gap: spacing[2] }}>
                          <Text type="secondary" style={{ minWidth: 150 }}>Integration Type:</Text>
                          <Text strong><code>{form.getFieldValue('type') || <Text type="secondary">Not set</Text>}</code></Text>
                        </div>
                      </Space>
                    </div>

                    <Divider style={{ margin: 0 }} />

                    {/* Configuration Summary - HTTP or COMMUNICATION */}
                    {form.getFieldValue('actionType') === 'COMMUNICATION' ? (
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: spacing[2], marginBottom: spacing[3] }}>
                          <MailOutlined style={{ fontSize: 18, color: colors.primary[600] }} />
                          <Text strong style={{ fontSize: 16 }}>Communication Configuration</Text>
                        </div>
                        <Space direction="vertical" size="small" style={{ width: '100%', paddingLeft: spacing[4] }}>
                          <div style={{ display: 'flex', gap: spacing[2] }}>
                            <Text type="secondary" style={{ minWidth: 150 }}>Channel:</Text>
                            <Tag color="blue">{form.getFieldValue(['communicationConfig', 'channel']) || 'EMAIL'}</Tag>
                          </div>
                          <div style={{ display: 'flex', gap: spacing[2] }}>
                            <Text type="secondary" style={{ minWidth: 150 }}>Provider:</Text>
                            <Tag color="green">{form.getFieldValue(['communicationConfig', 'provider']) || 'SMTP'}</Tag>
                          </div>
                          <div style={{ display: 'flex', gap: spacing[2] }}>
                            <Text type="secondary" style={{ minWidth: 150 }}>SMTP Host:</Text>
                            <Text strong>{form.getFieldValue(['communicationConfig', 'smtp', 'host']) || <Text type="secondary">Not set</Text>}</Text>
                          </div>
                          <div style={{ display: 'flex', gap: spacing[2] }}>
                            <Text type="secondary" style={{ minWidth: 150 }}>SMTP Port:</Text>
                            <Text>{form.getFieldValue(['communicationConfig', 'smtp', 'port']) || <Text type="secondary">Not set</Text>}</Text>
                          </div>
                          <div style={{ display: 'flex', gap: spacing[2] }}>
                            <Text type="secondary" style={{ minWidth: 150 }}>From Email:</Text>
                            <Text>{form.getFieldValue(['communicationConfig', 'smtp', 'fromEmail']) || <Text type="secondary">Not set</Text>}</Text>
                          </div>
                        </Space>
                      </div>
                    ) : (
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: spacing[2], marginBottom: spacing[3] }}>
                          <SendOutlined style={{ fontSize: 18, color: colors.primary[600] }} />
                          <Text strong style={{ fontSize: 16 }}>Target API Configuration</Text>
                        </div>
                        <Space direction="vertical" size="small" style={{ width: '100%', paddingLeft: spacing[4] }}>
                          <div style={{ display: 'flex', gap: spacing[2] }}>
                            <Text type="secondary" style={{ minWidth: 150 }}>Target URL:</Text>
                            <Text strong>{form.getFieldValue('targetUrl') || <Text type="secondary">Not set</Text>}</Text>
                          </div>
                          <div style={{ display: 'flex', gap: spacing[2] }}>
                            <Text type="secondary" style={{ minWidth: 150 }}>HTTP Method:</Text>
                            <Tag color="blue">{form.getFieldValue('httpMethod') || 'POST'}</Tag>
                          </div>
                          <div style={{ display: 'flex', gap: spacing[2] }}>
                            <Text type="secondary" style={{ minWidth: 150 }}>Timeout:</Text>
                            <Text>{form.getFieldValue('timeout') || 10000}ms</Text>
                          </div>
                          <div style={{ display: 'flex', gap: spacing[2] }}>
                            <Text type="secondary" style={{ minWidth: 150 }}>Retry Count:</Text>
                            <Text>{form.getFieldValue('retryCount') || 3}</Text>
                          </div>
                          <div style={{ display: 'flex', gap: spacing[2] }}>
                            <Text type="secondary" style={{ minWidth: 150 }}>Stream Response:</Text>
                            <Tag color={form.getFieldValue('streamResponse') ? 'green' : 'default'}>
                              {form.getFieldValue('streamResponse') ? 'Enabled' : 'Disabled'}
                            </Tag>
                          </div>
                        </Space>
                      </div>
                    )}

                    <Divider style={{ margin: 0 }} />

                    {/* Authentication Summary */}
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: spacing[2], marginBottom: spacing[3] }}>
                        <LockOutlined style={{ fontSize: 18, color: colors.primary[600] }} />
                        <Text strong style={{ fontSize: 16 }}>Authentication</Text>
                      </div>
                      <Space direction="vertical" size="small" style={{ width: '100%', paddingLeft: spacing[4] }}>
                        <div style={{ display: 'flex', gap: spacing[2] }}>
                          <Text type="secondary" style={{ minWidth: 150 }}>Auth Type:</Text>
                          <Tag color={authType === 'NONE' ? 'default' : 'blue'}>{authType || 'NONE'}</Tag>
                        </div>
                      </Space>
                    </div>

                    <Divider style={{ margin: 0 }} />

                    {/* Transformation Summary */}
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: spacing[2], marginBottom: spacing[3] }}>
                        <CodeOutlined style={{ fontSize: 18, color: colors.primary[600] }} />
                        <Text strong style={{ fontSize: 16 }}>Transformations</Text>
                      </div>
                      <Space direction="vertical" size="small" style={{ width: '100%', paddingLeft: spacing[4] }}>
                        <div style={{ display: 'flex', gap: spacing[2] }}>
                          <Text type="secondary" style={{ minWidth: 150 }}>
                            {form.getFieldValue('actionType') === 'COMMUNICATION' ? 'Email Content Transform:' : 'Request Transform:'}
                          </Text>
                          <Tag color={requestTransformEnabled ? 'success' : 'default'}>
                            {requestTransformEnabled ? 'Enabled' : 'Disabled'}
                          </Tag>
                        </div>
                        {form.getFieldValue('actionType') !== 'COMMUNICATION' && (
                          <div style={{ display: 'flex', gap: spacing[2] }}>
                            <Text type="secondary" style={{ minWidth: 150 }}>Response Transform:</Text>
                            <Tag color={responseTransformEnabled ? 'success' : 'default'}>
                              {responseTransformEnabled ? 'Enabled' : 'Disabled'}
                            </Tag>
                          </div>
                        )}
                      </Space>
                    </div>

                    {/* Action Buttons */}
                    <Divider style={{ margin: 0 }} />

                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: spacing[3], paddingTop: spacing[3] }}>
                      <Button
                        size="large"
                        onClick={() => navigate('/inbound-integrations')}
                      >
                        Cancel
                      </Button>
                      <Button
                        type="primary"
                        size="large"
                        icon={<SaveOutlined />}
                        onClick={() => form.submit()}
                        loading={isSaving}
                        disabled={!isTabComplete('basic') || !isTabComplete('http')}
                      >
                        {isCreate ? 'Create Integration' : 'Save Changes'}
                      </Button>
                    </div>
                  </Space>
                </Card>
              )
            }
          ]}
        />

        {/* Remove old footer buttons since they're now in Review tab */}
        {false && isCreate && (
          <Card style={{ marginTop: spacing[2] }} size="small">
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: spacing[3] }}>
              <Button onClick={() => navigate('/inbound-integrations')}>
                Cancel
              </Button>
              <Button
                type="primary"
                htmlType="submit"
                loading={isSaving}
                icon={<SaveOutlined />}
                size="large"
              >
                Create Integration
              </Button>
            </div>
          </Card>
        )}

        {!isCreate && (
          <Card style={{ marginTop: spacing[2] }} size="small">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <Space>
                {/* Copy curl - available for all integrations */}
                <Button
                  icon={<CopyOutlined />}
                  onClick={handleCopyCurl}
                  disabled={!integration}
                >
                  Copy curl
                </Button>

                {/* Show test email button for COMMUNICATION integrations */}
                {(actionType === 'COMMUNICATION' || integration?.actions?.length > 0) && (
                  <Button
                    icon={<MailOutlined />}
                    onClick={handleOpenTestEmailModal}
                    disabled={!integration}
                    type="default"
                  >
                    Send Test Email
                  </Button>
                )}

                {/* Show test runtime button for HTTP integrations only */}
                {actionType !== 'COMMUNICATION' && !integration?.actions?.length && (
                  <Button
                    icon={<ThunderboltOutlined />}
                    onClick={handleTestRuntime}
                    disabled={!integration}
                  >
                    Test runtime
                  </Button>
                )}
              </Space>
              <Space>
                <Button onClick={() => navigate('/inbound-integrations')}>
                  Cancel
                </Button>
                <Button
                  type="primary"
                  htmlType="submit"
                  loading={isSaving}
                  icon={<SaveOutlined />}
                  size="large"
                >
                  Save Changes
                </Button>
              </Space>
            </div>
          </Card>
        )}
      </Form>

      <Modal
        title="Copy curl command"
        open={curlModalOpen}
        onOk={handleConfirmCopyCurl}
        onCancel={() => setCurlModalOpen(false)}
        okText="Copy"
      >
        <Space direction="vertical" size="small" style={{ width: '100%' }}>
          <Text type="secondary">
            Provide the gateway API key to include it in the curl command.
          </Text>
          <Input.Password
            placeholder="Gateway API Key (X-API-Key)"
            value={curlApiKey}
            onChange={(e) => setCurlApiKey(e.target.value)}
          />
          {integration?.inboundAuthType === 'API_KEY' && (
            <Input.Password
              placeholder="Inbound API Key (if required by integration)"
              value={curlInboundKey}
              onChange={(e) => setCurlInboundKey(e.target.value)}
            />
          )}
          {curlQueryParams.length > 0 && (
            <>
              <Divider style={{ margin: '8px 0' }} />
              <Text type="secondary">Sample query parameters (editable):</Text>
              {curlQueryParams.map((param) => (
                <Input
                  key={param.name}
                  addonBefore={param.name}
                  value={param.value}
                  onChange={(e) => {
                    const value = e.target.value;
                    setCurlQueryParams((prev) =>
                      prev.map((item) => (item.name === param.name ? { ...item, value } : item))
                    );
                  }}
                />
              ))}
            </>
          )}
        </Space>
      </Modal>

      {/* Test Email Modal */}
      <Modal
        title="Send Test Email"
        open={testEmailModalOpen}
        onOk={handleSendTestEmail}
        onCancel={() => setTestEmailModalOpen(false)}
        okText={isSendingTest ? 'Sending...' : 'Send Email'}
        confirmLoading={isSendingTest}
        width={600}
      >
        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
          <Alert
            type="info"
            showIcon
            message="Test your email configuration"
            description="Send a test email to verify your SMTP settings and see how the email will be delivered."
          />

          <div>
            <Text strong style={{ display: 'block', marginBottom: 8 }}>Recipient Email *</Text>
            <Input
              type="email"
              placeholder="recipient@example.com"
              value={testEmailAddress}
              onChange={(e) => setTestEmailAddress(e.target.value)}
              size="large"
              disabled={isSendingTest}
            />
          </div>

          <div>
            <Text strong style={{ display: 'block', marginBottom: 8 }}>Subject *</Text>
            <Input
              placeholder="Email subject"
              value={testEmailSubject}
              onChange={(e) => setTestEmailSubject(e.target.value)}
              size="large"
              disabled={isSendingTest}
            />
          </div>

          <div>
            <Text strong style={{ display: 'block', marginBottom: 8 }}>Email Body (HTML) *</Text>
            <Input.TextArea
              placeholder="<h1>Hello!</h1><p>This is a test email.</p>"
              value={testEmailBody}
              onChange={(e) => setTestEmailBody(e.target.value)}
              rows={6}
              disabled={isSendingTest}
            />
          </div>

          <Alert
            type="info"
            showIcon
            message="Synchronous Test"
            description="The test email will be sent immediately using your configured SMTP settings. Check your inbox for delivery."
          />
        </Space>
      </Modal>
    </div>
  );
};
