import { Row, Col, Form, Input, Select, Button, Space } from 'antd';
import type { FormInstance } from 'antd';
import { HelpPopover, OAuth2RequirementsHelp, SecureLabel } from './shared';

interface AuthenticationSectionProps {
  form: FormInstance;
  uiConfig?: any;
  selectedAuthType?: string;
  isMultiAction: boolean;
  spacing: any;
}

const spacingToNumber = (value: any): number => {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') return parseInt(value, 10) || 0;
  return 0;
};

/**
 * AuthenticationSection - Authentication configuration
 *
 * Enterprise-focused design: NO explanatory alerts for auth types.
 * Users selecting OAuth, Bearer, etc. already know what these mean.
 * Only provides help for complex OAuth2 token endpoint requirements.
 */
export const AuthenticationSection = ({
  form,
  uiConfig,
  selectedAuthType,
  isMultiAction,
  spacing
}: AuthenticationSectionProps) => {
  return (
    <Row gutter={[spacingToNumber(spacing[4]), 0]}>
      <Col xs={24}>
        <Form.Item name="outgoingAuthType" label="Authentication Type" rules={[{ required: true }]}>
          <Select
            options={uiConfig?.authTypes || []}
            size="large"
          />
        </Form.Item>
      </Col>

      {/* API_KEY fields - NO ALERT */}
      {selectedAuthType === 'API_KEY' && (
        <>
          <Col xs={24} md={12}>
            <Form.Item
              name={['outgoingAuthConfig', 'headerName']}
              label="Header Name"
              rules={[{ required: true, message: 'Header name is required for API Key auth' }]}
            >
              <Input placeholder="e.g., X-API-Key" size="large" />
            </Form.Item>
          </Col>
          <Col xs={24} md={12}>
            <Form.Item
              name={['outgoingAuthConfig', 'apiKey']}
              label={<SecureLabel label="API Key" />}
              rules={[{ required: true, message: 'API Key is required' }]}
            >
              <Input.Password placeholder="Enter your API key" size="large" />
            </Form.Item>
          </Col>
        </>
      )}

      {/* BASIC auth fields - NO ALERT */}
      {selectedAuthType === 'BASIC' && (
        <>
          <Col xs={24} md={12}>
            <Form.Item
              name={['outgoingAuthConfig', 'username']}
              label="Username"
              rules={[{ required: true, message: 'Username is required for Basic auth' }]}
            >
              <Input placeholder="Enter username" size="large" />
            </Form.Item>
          </Col>
          <Col xs={24} md={12}>
            <Form.Item
              name={['outgoingAuthConfig', 'password']}
              label={<SecureLabel label="Password" />}
              rules={[{ required: true, message: 'Password is required' }]}
            >
              <Input.Password placeholder="Enter password" size="large" />
            </Form.Item>
          </Col>
        </>
      )}

      {/* BEARER token field - NO ALERT */}
      {selectedAuthType === 'BEARER' && (
        <Col xs={24}>
          <Form.Item
            name={['outgoingAuthConfig', 'token']}
            label={<SecureLabel label="Bearer Token" />}
            rules={[{ required: true, message: 'Token is required for Bearer auth' }]}
          >
            <Input.Password placeholder="Enter bearer token" size="large" />
          </Form.Item>
        </Col>
      )}

      {/* OAUTH1 fields - For NetSuite, Twitter API, etc. */}
      {selectedAuthType === 'OAUTH1' && (
        <>
          <Col xs={24} md={12}>
            <Form.Item
              name={['outgoingAuthConfig', 'consumerKey']}
              label={<SecureLabel label="Consumer Key" />}
              rules={[{ required: true, message: 'Consumer Key is required for OAuth 1.0a' }]}
            >
              <Input.Password placeholder="Enter consumer key" size="large" />
            </Form.Item>
          </Col>
          <Col xs={24} md={12}>
            <Form.Item
              name={['outgoingAuthConfig', 'consumerSecret']}
              label={<SecureLabel label="Consumer Secret" />}
              rules={[{ required: true, message: 'Consumer Secret is required' }]}
            >
              <Input.Password placeholder="Enter consumer secret" size="large" />
            </Form.Item>
          </Col>
          <Col xs={24} md={12}>
            <Form.Item
              name={['outgoingAuthConfig', 'token']}
              label={<SecureLabel label="Access Token" />}
              rules={[{ required: true, message: 'Access Token is required' }]}
            >
              <Input.Password placeholder="Enter access token" size="large" />
            </Form.Item>
          </Col>
          <Col xs={24} md={12}>
            <Form.Item
              name={['outgoingAuthConfig', 'tokenSecret']}
              label={<SecureLabel label="Token Secret" />}
              rules={[{ required: true, message: 'Token Secret is required' }]}
            >
              <Input.Password placeholder="Enter token secret" size="large" />
            </Form.Item>
          </Col>
          <Col xs={24} md={12}>
            <Form.Item
              name={['outgoingAuthConfig', 'realm']}
              label="Realm (optional)"
              tooltip="Required for NetSuite (e.g., 5688780)"
            >
              <Input placeholder="e.g., 5688780" size="large" />
            </Form.Item>
          </Col>
          <Col xs={24} md={12}>
            <Form.Item
              name={['outgoingAuthConfig', 'signatureMethod']}
              label="Signature Method"
              initialValue="HMAC-SHA256"
            >
              <Select
                options={[
                  { value: 'HMAC-SHA256', label: 'HMAC-SHA256' },
                  { value: 'HMAC-SHA1', label: 'HMAC-SHA1' }
                ]}
                size="large"
              />
            </Form.Item>
          </Col>
        </>
      )}

      {/* OAUTH2 fields - NO GENERAL ALERT, only help popover for requirements */}
      {selectedAuthType === 'OAUTH2' && (
        <>
          <Col xs={24}>
            <Form.Item
              name={['outgoingAuthConfig', 'tokenUrl']}
              label={
                <Space size={4}>
                  Token URL
                  <HelpPopover
                    title="OAuth2 Requirements"
                    content={<OAuth2RequirementsHelp />}
                  />
                </Space>
              }
              rules={[{ required: true, message: 'Token URL is required for OAuth2' }]}
            >
              <Input placeholder="https://auth.example.com/oauth/token" size="large" />
            </Form.Item>
          </Col>
          <Col xs={24} md={12}>
            <Form.Item
              name={['outgoingAuthConfig', 'clientId']}
              label="Client ID"
              rules={[{ required: true, message: 'Client ID is required' }]}
            >
              <Input placeholder="Enter client ID" size="large" />
            </Form.Item>
          </Col>
          <Col xs={24} md={12}>
            <Form.Item
              name={['outgoingAuthConfig', 'clientSecret']}
              label={<SecureLabel label="Client Secret" />}
              rules={[{ required: true, message: 'Client Secret is required' }]}
            >
              <Input.Password placeholder="Enter client secret" size="large" />
            </Form.Item>
          </Col>
          <Col xs={24}>
            <Form.Item name={['outgoingAuthConfig', 'scope']} label="Scope (optional)">
              <Input placeholder="e.g., read write" size="large" />
            </Form.Item>
          </Col>
        </>
      )}

      {/* CUSTOM token auth fields - NO ALERT */}
      {selectedAuthType === 'CUSTOM' && (
        <>
          <Col xs={24}>
            <Form.Item
              name={['outgoingAuthConfig', 'tokenEndpoint']}
              label="Token Endpoint URL"
              rules={[{ required: true, message: 'Token endpoint is required' }]}
            >
              <Input placeholder="https://api.example.com/auth/login" size="large" />
            </Form.Item>
          </Col>
          <Col xs={24} md={8}>
            <Form.Item
              name={['outgoingAuthConfig', 'tokenRequestMethod']}
              label="Request Method"
              initialValue="POST"
            >
              <Select
                options={[
                  { value: 'POST', label: 'POST' },
                  { value: 'GET', label: 'GET' }
                ]}
                size="large"
              />
            </Form.Item>
          </Col>
          <Col xs={24} md={8}>
            <Form.Item
              name={['outgoingAuthConfig', 'tokenResponsePath']}
              label="Token Path in Response"
              tooltip="e.g., 'access_token' or 'data.token'"
            >
              <Input placeholder="access_token" size="large" />
            </Form.Item>
          </Col>
          <Col xs={24} md={8}>
            <Form.Item
              name={['outgoingAuthConfig', 'tokenHeaderName']}
              label="Token Header Name"
              tooltip="Default: Authorization"
            >
              <Input placeholder="Authorization" size="large" />
            </Form.Item>
          </Col>
          <Col xs={24}>
            <Form.Item
              name={['outgoingAuthConfig', 'tokenRequestBody']}
              label="Request Body (JSON)"
              tooltip="JSON with credentials"
              rules={[
                { required: true, message: 'Request body is required' },
                {
                  validator: (_, value) => {
                    if (!value) return Promise.resolve();
                    try {
                      JSON.parse(value);
                      return Promise.resolve();
                    } catch {
                      return Promise.reject(new Error('Must be valid JSON'));
                    }
                  }
                }
              ]}
            >
              <Input.TextArea
                placeholder={'{\n  "username": "your-username",\n  "password": "your-password"\n}'}
                rows={4}
                size="large"
              />
            </Form.Item>
          </Col>
        </>
      )}

      {/* CUSTOM_HEADERS - NO ALERT, NO EXAMPLE */}
      {selectedAuthType === 'CUSTOM_HEADERS' && (
        <Col xs={24}>
          <Form.List name={['outgoingAuthConfig', 'headers']}>
            {(fields, { add, remove }) => (
              <>
                {fields.map(({ key, name, ...restField }) => (
                  <Row key={key} gutter={[spacingToNumber(spacing[2]), 0]} style={{ marginBottom: spacingToNumber(spacing[2]) }}>
                    <Col xs={24} md={10}>
                      <Form.Item
                        {...restField}
                        name={[name, 'key']}
                        rules={[{ required: true, message: 'Header name is required' }]}
                      >
                        <Input placeholder="Header Name (e.g., X-CleverTap-Account-Id)" size="large" />
                      </Form.Item>
                    </Col>
                    <Col xs={24} md={12}>
                      <Form.Item
                        {...restField}
                        name={[name, 'value']}
                        rules={[{ required: true, message: 'Header value is required' }]}
                      >
                        <Input.Password placeholder="Header Value" size="large" />
                      </Form.Item>
                    </Col>
                    <Col xs={24} md={2}>
                      <Button type="text" danger onClick={() => remove(name)} style={{ width: '100%' }}>
                        Remove
                      </Button>
                    </Col>
                  </Row>
                ))}
                <Button
                  type="dashed"
                  onClick={() => add()}
                  block
                  size="large"
                  style={{ marginTop: fields.length > 0 ? spacingToNumber(spacing[2]) : 0 }}
                >
                  + Add Header
                </Button>
              </>
            )}
          </Form.List>
        </Col>
      )}

      {/* NONE - NO ALERT (obvious that no auth means no auth) */}
    </Row>
  );
};
