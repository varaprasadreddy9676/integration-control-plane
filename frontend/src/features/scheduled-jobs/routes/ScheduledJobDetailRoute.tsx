import { useMemo, useState, useEffect } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Form,
  Input,
  Select,
  Card,
  Space,
  Button,
  Radio,
  Divider,
  Alert,
  message,
  Tabs,
  Tag,
  Typography,
  Collapse,
  Modal,
  Table,
  Spin
} from 'antd';
import {
  ArrowLeftOutlined,
  SaveOutlined,
  PlayCircleOutlined,
  DatabaseOutlined,
  ApiOutlined,
  CodeOutlined,
  LockOutlined,
  ThunderboltOutlined,
  ClockCircleOutlined,
  HistoryOutlined,
  EyeOutlined,
  CheckCircleOutlined,
  ExperimentOutlined,
  CloseCircleOutlined,
  CopyOutlined,
  InfoCircleOutlined
} from '@ant-design/icons';
import Editor from '@monaco-editor/react';
import { PageHeader } from '../../../components/common/PageHeader';
import { CronBuilder } from '../components/CronBuilder';
import { cssVar, useDesignTokens } from '../../../design-system/utils';
import {
  getScheduledJobById,
  createScheduledJob,
  updateScheduledJob,
  executeScheduledJob,
  getUIConfig,
  testDataSource
} from '../../../services/api';
import { formatDateTime } from '../../../utils/format';
import { AuthenticationFields } from '../../../shared/integration-forms';

const { TextArea } = Input;
const { Text } = Typography;

const DATA_SOURCE_TYPES = [
  { value: 'SQL', label: 'SQL Query', icon: <DatabaseOutlined /> },
  { value: 'MONGODB', label: 'MongoDB Aggregation', icon: <DatabaseOutlined /> },
  { value: 'API', label: 'Internal API', icon: <ApiOutlined /> }
];

const SQL_EXAMPLE = `SELECT
  b.billId,
  b.patientRid,
  b.totalAmount,
  b.createdDate
FROM bills b
WHERE DATE(b.createdDate) = CURDATE()
  AND b.entityRid = {{config.tenantId}}
ORDER BY b.createdDate DESC`;

const MONGODB_EXAMPLE = `[
  {
    "$match": {
      "tenantId": "{{config.tenantId}}",
      "appointmentDate": {
        "$gte": "{{date.todayStart()}}",
        "$lt": "{{date.todayEnd()}}"
      },
      "status": "CONFIRMED"
    }
  },
  {
    "$project": {
      "patientId": 1,
      "patientName": 1,
      "appointmentDate": 1,
      "doctorName": 1,
      "status": 1
    }
  }
]`;

const API_EXAMPLE = `// Example for GET request
{
  "url": "http://localhost:4000/api/v1/analytics/summary",
  "method": "GET",
  "headers": {
    "X-API-Key": "{{env.API_KEY}}"
  }
}

// Example for POST request with body
{
  "url": "http://localhost:4000/api/v1/reports/generate",
  "method": "POST",
  "headers": {
    "X-API-Key": "{{env.API_KEY}}",
    "Content-Type": "application/json"
  },
  "body": {
    "reportType": "daily_summary",
    "date": "{{date.today()}}"
  }
}`;

export const ScheduledJobDetailRoute = () => {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const { spacing, token } = useDesignTokens();
  const colors = cssVar.legacy;
  const [form] = Form.useForm();

  const orgId = searchParams.get('orgId');
  const isCreate = id === 'new';

  const [dataSourceType, setDataSourceType] = useState<'SQL' | 'MONGODB' | 'API'>('SQL');
  const [scheduleType, setScheduleType] = useState<'CRON' | 'INTERVAL'>('CRON');
  const [transformationMode, setTransformationMode] = useState<'SIMPLE' | 'SCRIPT'>('SCRIPT');
  const [sqlConnectionMode, setSqlConnectionMode] = useState<'STRING' | 'FIELDS'>('FIELDS');

  // Editor values (needed for Monaco Editor to work with Ant Design Form)
  const [sqlQuery, setSqlQuery] = useState('');
  const [mongoPipeline, setMongoPipeline] = useState('');
  const [apiHeaders, setApiHeaders] = useState('');
  const [apiBody, setApiBody] = useState('');
  const [transformScript, setTransformScript] = useState('');

  // Test data source modal state
  const [testModalOpen, setTestModalOpen] = useState(false);
  const [testResult, setTestResult] = useState<any>(null);

  // Watch auth type from form
  const authType = Form.useWatch('outgoingAuthType', form) || 'NONE';

  // Watch form fields to trigger re-render and unlock tabs dynamically
  const formName = Form.useWatch('name', form);
  const formType = Form.useWatch('type', form);
  const formCronExpression = Form.useWatch('cronExpression', form);
  const formIntervalMs = Form.useWatch('intervalMs', form);
  const formSqlQuery = Form.useWatch('sqlQuery', form);
  const formSqlConnectionString = Form.useWatch('sqlConnectionString', form);
  const formSqlHost = Form.useWatch('sqlHost', form);
  const formSqlPort = Form.useWatch('sqlPort', form);
  const formSqlUsername = Form.useWatch('sqlUsername', form);
  const formSqlPassword = Form.useWatch('sqlPassword', form);
  const formSqlDatabase = Form.useWatch('sqlDatabase', form);
  const formMongoQuery = Form.useWatch('mongoQuery', form);
  const formApiUrl = Form.useWatch('apiUrl', form);
  const formTransformScript = Form.useWatch('transformScript', form);
  const formTargetUrl = Form.useWatch('targetUrl', form);

  // Fetch UI config for auth types
  const { data: uiConfig } = useQuery({
    queryKey: ['ui-config'],
    queryFn: getUIConfig
  });

  // Fetch job details
  const { data: job, isLoading } = useQuery({
    queryKey: ['scheduled-job', id],
    queryFn: () => getScheduledJobById(id!, orgId!),
    enabled: !isCreate && !!id
  });

  // Create/Update mutation
  const saveMutation = useMutation({
    mutationFn: async (values: any) => {
      const payload = {
        ...values,
        schedule: {
          type: scheduleType,
          ...(scheduleType === 'CRON' ? {
            expression: values.cronExpression,
            timezone: values.timezone || 'UTC'
          } : {
            intervalMs: values.intervalMs
          })
        },
        dataSource: {
          type: dataSourceType,
          ...(dataSourceType === 'SQL' ? {
            query: values.sqlQuery,
            ...(sqlConnectionMode === 'STRING' && values.sqlConnectionString?.trim()
              ? { connectionString: values.sqlConnectionString.trim() }
              : {}),
            ...(sqlConnectionMode === 'FIELDS' && values.sqlHost?.trim() ? { host: values.sqlHost.trim() } : {}),
            ...(sqlConnectionMode === 'FIELDS' && values.sqlPort ? { port: Number(values.sqlPort) } : {}),
            ...(sqlConnectionMode === 'FIELDS' && values.sqlUsername?.trim() ? { username: values.sqlUsername.trim() } : {}),
            ...(sqlConnectionMode === 'FIELDS' && values.sqlPassword ? { password: values.sqlPassword } : {}),
            ...(sqlConnectionMode === 'FIELDS' && values.sqlDatabase?.trim() ? { database: values.sqlDatabase.trim() } : {})
          } : dataSourceType === 'MONGODB' ? {
            connectionString: values.mongoConnectionString,
            database: values.mongoDatabase,
            collection: values.mongoCollection,
            pipeline: JSON.parse(values.mongoPipeline)
          } : {
            url: values.apiUrl,
            method: values.apiMethod || 'GET',
            headers: values.apiHeaders ? JSON.parse(values.apiHeaders) : {},
            body: values.apiBody ? JSON.parse(values.apiBody) : undefined
          })
        },
        transformation: {
          mode: transformationMode,
          ...(transformationMode === 'SCRIPT' ? {
            script: values.transformScript
          } : {
            mappings: values.fieldMappings || []
          })
        },
        outgoingAuthType: values.outgoingAuthType || 'NONE',
        outgoingAuthConfig: values.outgoingAuthConfig || undefined
      };

      if (isCreate) {
        return createScheduledJob(payload, orgId!);
      } else {
        return updateScheduledJob(id!, payload, orgId!);
      }
    },
    onSuccess: () => {
      message.success(`Scheduled job ${isCreate ? 'created' : 'updated'} successfully`);
      queryClient.invalidateQueries({ queryKey: ['scheduled-jobs'] });
      navigate(`/scheduled-jobs?orgId=${orgId}`);
    },
    onError: (error: any) => {
      message.error(error.message || `Failed to ${isCreate ? 'create' : 'update'} scheduled job`);
    }
  });

  // Execute mutation
  const executeMutation = useMutation({
    mutationFn: () => executeScheduledJob(id!, orgId!),
    onSuccess: () => {
      message.success('Job execution triggered');
      queryClient.invalidateQueries({ queryKey: ['scheduled-job', id] });
    },
    onError: () => {
      message.error('Failed to trigger job execution');
    }
  });

  // Test data source mutation
  const testDataSourceMutation = useMutation({
    mutationFn: async () => {
      const values = form.getFieldsValue();

      // Build data source config based on type
      let dataSourceConfig: any = { type: dataSourceType };

      try {
        if (dataSourceType === 'SQL') {
          dataSourceConfig.query = values.sqlQuery;
          if (sqlConnectionMode === 'STRING' && values.sqlConnectionString && values.sqlConnectionString.trim()) {
            dataSourceConfig.connectionString = values.sqlConnectionString.trim();
          }
          if (sqlConnectionMode === 'FIELDS' && values.sqlHost && values.sqlHost.trim()) {
            dataSourceConfig.host = values.sqlHost.trim();
          }
          if (sqlConnectionMode === 'FIELDS' && values.sqlPort) {
            dataSourceConfig.port = Number(values.sqlPort);
          }
          if (sqlConnectionMode === 'FIELDS' && values.sqlUsername && values.sqlUsername.trim()) {
            dataSourceConfig.username = values.sqlUsername.trim();
          }
          if (sqlConnectionMode === 'FIELDS' && values.sqlPassword) {
            dataSourceConfig.password = values.sqlPassword;
          }
          if (sqlConnectionMode === 'FIELDS' && values.sqlDatabase && values.sqlDatabase.trim()) {
            dataSourceConfig.database = values.sqlDatabase.trim();
          }
        } else if (dataSourceType === 'MONGODB') {
          dataSourceConfig.connectionString = values.mongoConnectionString;
          dataSourceConfig.database = values.mongoDatabase;
          dataSourceConfig.collection = values.mongoCollection;

          // Validate and parse MongoDB pipeline
          try {
            dataSourceConfig.pipeline = JSON.parse(values.mongoPipeline || '[]');
            if (!Array.isArray(dataSourceConfig.pipeline)) {
              throw new Error('MongoDB pipeline must be an array');
            }
          } catch (e) {
            throw new Error(`Invalid MongoDB Pipeline JSON: ${e instanceof Error ? e.message : 'Invalid format'}`);
          }
        } else if (dataSourceType === 'API') {
          dataSourceConfig.url = values.apiUrl;
          dataSourceConfig.method = values.apiMethod || 'GET';

          // Validate and parse API headers
          if (values.apiHeaders && values.apiHeaders.trim()) {
            try {
              dataSourceConfig.headers = JSON.parse(values.apiHeaders);
            } catch (e) {
              throw new Error(`Invalid API Headers JSON: ${e instanceof Error ? e.message : 'Invalid format'}`);
            }
          } else {
            dataSourceConfig.headers = {};
          }

          // Validate and parse API body
          if (values.apiBody && values.apiBody.trim()) {
            try {
              dataSourceConfig.body = JSON.parse(values.apiBody);
            } catch (e) {
              throw new Error(`Invalid API Body JSON: ${e instanceof Error ? e.message : 'Invalid format'}`);
            }
          }
        }

        return await testDataSource(dataSourceConfig, orgId);
      } catch (error) {
        // Re-throw validation errors to be caught by onError
        throw error;
      }
    },
    onSuccess: (result) => {
      setTestResult(result);
      setTestModalOpen(true);
      if (result.success) {
        message.success('Data source test successful');
      }
    },
    onError: (error: any) => {
      setTestResult({
        success: false,
        error: error.message || 'Failed to test data source',
        details: error
      });
      setTestModalOpen(true);
      message.error(error.message || 'Failed to test data source');
    }
  });

  // Initialize default values for new jobs
  useEffect(() => {
    if (isCreate) {
      const defaultTransformScript = '// Transform the data\nreturn {\n  date: new Date().toISOString(),\n  data: payload.data\n};';
      setTransformScript(defaultTransformScript);
    }
  }, [isCreate]);

  // Populate form with existing job data
  useEffect(() => {
    if (job) {
      setDataSourceType(job.dataSource?.type || 'SQL');
      setScheduleType(job.schedule?.type || 'CRON');
      setTransformationMode(job.transformation?.mode || 'SCRIPT');

      // Set editor states
      setSqlQuery(job.dataSource?.query || '');
      setMongoPipeline(job.dataSource?.pipeline ? JSON.stringify(job.dataSource.pipeline, null, 2) : '');
      setApiHeaders(job.dataSource?.headers ? JSON.stringify(job.dataSource.headers, null, 2) : '');
      setApiBody(job.dataSource?.body ? JSON.stringify(job.dataSource.body, null, 2) : '');
      setTransformScript(job.transformation?.script || '');

      form.setFieldsValue({
        name: job.name,
        type: job.type,
        description: job.description,
        targetUrl: job.targetUrl,
        httpMethod: job.httpMethod || 'POST',
        isActive: job.isActive !== false,
        cronExpression: job.schedule?.expression,
        timezone: job.schedule?.timezone || 'UTC',
        intervalMs: job.schedule?.intervalMs,
        sqlQuery: job.dataSource?.query,
        sqlConnectionString: job.dataSource?.connectionString || '',
        sqlHost: job.dataSource?.host || job.dataSource?.hostname || '',
        sqlPort: job.dataSource?.port,
        sqlUsername: job.dataSource?.username || job.dataSource?.user || '',
        sqlPassword: job.dataSource?.password || '',
        sqlDatabase: job.dataSource?.database || '',
        mongoConnectionString: job.dataSource?.connectionString || '',
        mongoDatabase: job.dataSource?.database || '',
        mongoCollection: job.dataSource?.collection || '',
        mongoPipeline: job.dataSource?.pipeline ? JSON.stringify(job.dataSource.pipeline, null, 2) : '',
        apiUrl: job.dataSource?.url,
        apiMethod: job.dataSource?.method,
        apiHeaders: job.dataSource?.headers ? JSON.stringify(job.dataSource.headers, null, 2) : '',
        apiBody: job.dataSource?.body ? JSON.stringify(job.dataSource.body, null, 2) : '',
        transformScript: job.transformation?.script || '',
        outgoingAuthType: job.outgoingAuthType || 'NONE',
        outgoingAuthConfig: job.outgoingAuthConfig || {}
      });
      const hasFieldConfig = !!(
        job.dataSource?.host ||
        job.dataSource?.hostname ||
        job.dataSource?.port ||
        job.dataSource?.username ||
        job.dataSource?.user ||
        job.dataSource?.database
      );
      if (hasFieldConfig) {
        setSqlConnectionMode('FIELDS');
      } else if (job.dataSource?.connectionString) {
        setSqlConnectionMode('STRING');
      } else {
        setSqlConnectionMode('FIELDS');
      }
    }
  }, [job, form]);

  // Auto-build SQL connection string when fields are provided
  useEffect(() => {
    if (dataSourceType !== 'SQL') return;
    if (sqlConnectionMode !== 'FIELDS') return;
    if (!formSqlHost || !formSqlDatabase) return;

    const portPart = formSqlPort ? `:${formSqlPort}` : '';
    const userPart = formSqlUsername ? encodeURIComponent(formSqlUsername) : '';
    const passPart = formSqlPassword ? `:${encodeURIComponent(formSqlPassword)}` : '';
    const authPart = formSqlUsername ? `${userPart}${passPart}@` : '';
    const connectionString = `mysql://${authPart}${formSqlHost}${portPart}/${formSqlDatabase}`;

    if (formSqlConnectionString !== connectionString) {
      form.setFieldValue('sqlConnectionString', connectionString);
    }
  }, [
    dataSourceType,
    sqlConnectionMode,
    formSqlConnectionString,
    formSqlHost,
    formSqlPort,
    formSqlUsername,
    formSqlPassword,
    formSqlDatabase,
    form
  ]);

  const handleSubmit = (values: any) => {
    saveMutation.mutate(values);
  };

  const canTestDataSource = () => {
    const values = form.getFieldsValue();

    if (dataSourceType === 'SQL') {
      return !!values.sqlQuery;
    } else if (dataSourceType === 'MONGODB') {
      return !!(values.mongoConnectionString && values.mongoDatabase && values.mongoCollection && values.mongoPipeline);
    } else if (dataSourceType === 'API') {
      return !!values.apiUrl;
    }

    return false;
  };

  const renderDataSourceConfig = () => {
    switch (dataSourceType) {
      case 'SQL': {
        const portPart = formSqlPort ? `:${formSqlPort}` : '';
        const userPart = formSqlUsername ? encodeURIComponent(formSqlUsername) : '';
        const passPart = formSqlPassword ? `:${encodeURIComponent(formSqlPassword)}` : '';
        const authPart = formSqlUsername ? `${userPart}${passPart}@` : '';
        const generatedConnectionString =
          formSqlHost && formSqlDatabase
            ? `mysql://${authPart}${formSqlHost}${portPart}/${formSqlDatabase}`
            : '';

        return (
          <>
            <div>
              <Text strong style={{ display: 'block', marginBottom: spacing[2] }}>Connection Method</Text>
              <Radio.Group
                value={sqlConnectionMode}
                onChange={(e) => setSqlConnectionMode(e.target.value)}
                buttonStyle="solid"
              >
                <Radio.Button value="STRING">Connection String</Radio.Button>
                <Radio.Button value="FIELDS">Host / Port / Credentials</Radio.Button>
              </Radio.Group>
            </div>

            {sqlConnectionMode === 'STRING' ? (
              <Form.Item
                label="Connection String (optional)"
                name="sqlConnectionString"
                extra="Leave blank to use the platform database."
              >
                <Input size="large" placeholder="mysql://user:password@host:3306/dbname" />
              </Form.Item>
            ) : (
              <>
                <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: spacing[3] }}>
                  <Form.Item label="Host" name="sqlHost">
                    <Input size="large" placeholder="db.mycompany.com" />
                  </Form.Item>
                  <Form.Item label="Port" name="sqlPort">
                    <Input size="large" placeholder="3306" type="number" />
                  </Form.Item>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: spacing[3] }}>
                  <Form.Item label="Username" name="sqlUsername">
                    <Input size="large" placeholder="db_user" />
                  </Form.Item>
                  <Form.Item label="Password" name="sqlPassword">
                    <Input.Password size="large" placeholder="••••••••" />
                  </Form.Item>
                </div>
                <Form.Item label="Database" name="sqlDatabase">
                  <Input size="large" placeholder="your_database" />
                </Form.Item>
                <Form.Item label="Generated Connection String">
                  <Input
                    size="large"
                    value={generatedConnectionString || ''}
                    placeholder="Fill Host and Database to generate"
                    readOnly
                  />
                </Form.Item>
              </>
            )}

            <Form.Item
              label="SQL Query"
              name="sqlQuery"
              rules={[{ required: true, message: 'SQL query is required' }]}
              extra="Use variables: {{config.tenantId}}, {{date.today()}}, {{date.yesterday()}}"
            >
              <Editor
                height="200px"
                language="sql"
                theme="vs-dark"
                value={sqlQuery}
                onChange={(value) => {
                  setSqlQuery(value || '');
                  form.setFieldValue('sqlQuery', value || '');
                }}
                options={{
                  minimap: { enabled: false },
                  fontSize: 13,
                  lineNumbers: 'on',
                  wordWrap: 'on'
                }}
              />
            </Form.Item>
          </>
        );
      }

      case 'MONGODB':
        return (
          <>
            <Form.Item
              label="Connection String"
              name="mongoConnectionString"
              rules={[{ required: true, message: 'MongoDB connection string is required' }]}
              extra="MongoDB connection string (e.g., mongodb://user:password@host:port)"
            >
              <Input size="large" placeholder="mongodb://localhost:27017" />
            </Form.Item>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: spacing[3] }}>
              <Form.Item
                label="Database Name"
                name="mongoDatabase"
                rules={[{ required: true, message: 'Database name is required' }]}
              >
                <Input size="large" placeholder="your_database" />
              </Form.Item>
              <Form.Item
                label="Collection Name"
                name="mongoCollection"
                rules={[{ required: true, message: 'Collection name is required' }]}
              >
                <Input size="large" placeholder="appointments" />
              </Form.Item>
            </div>
            <Form.Item
              label="Aggregation Pipeline (JSON)"
              name="mongoPipeline"
              rules={[
                { required: true, message: 'Pipeline is required' },
                {
                  validator: (_, value) => {
                    try {
                      if (value) JSON.parse(value);
                      return Promise.resolve();
                    } catch {
                      return Promise.reject('Invalid JSON');
                    }
                  }
                }
              ]}
              extra="Array of aggregation stages with variable support"
            >
              <Editor
                height="200px"
                language="json"
                theme="vs-dark"
                value={mongoPipeline}
                onChange={(value) => {
                  setMongoPipeline(value || '');
                  form.setFieldValue('mongoPipeline', value || '');
                }}
                options={{
                  minimap: { enabled: false },
                  fontSize: 13
                }}
              />
            </Form.Item>
          </>
        );

      case 'API':
        return (
          <>
            <Form.Item
              label="API URL"
              name="apiUrl"
              rules={[{ required: true, message: 'API URL is required' }]}
            >
              <Input size="large" placeholder="http://localhost:4000/api/v1/analytics" />
            </Form.Item>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: spacing[3] }}>
              <Form.Item label="HTTP Method" name="apiMethod" initialValue="GET">
                <Select size="large">
                  <Select.Option value="GET">GET</Select.Option>
                  <Select.Option value="POST">POST</Select.Option>
                  <Select.Option value="PUT">PUT</Select.Option>
                </Select>
              </Form.Item>
            </div>
            <Form.Item
              label="Headers (JSON)"
              name="apiHeaders"
              rules={[
                {
                  validator: (_, value) => {
                    if (!value || value.trim() === '') return Promise.resolve();
                    try {
                      JSON.parse(value);
                      return Promise.resolve();
                    } catch {
                      return Promise.reject('Invalid JSON');
                    }
                  }
                }
              ]}
              extra="Optional request headers"
            >
              <Editor
                height="100px"
                language="json"
                theme="vs-dark"
                value={apiHeaders}
                onChange={(value) => {
                  setApiHeaders(value || '');
                  form.setFieldValue('apiHeaders', value || '');
                }}
                options={{
                  minimap: { enabled: false },
                  fontSize: 13
                }}
              />
            </Form.Item>
            <Form.Item
              label="Body (JSON)"
              name="apiBody"
              rules={[
                {
                  validator: (_, value) => {
                    if (!value || value.trim() === '') return Promise.resolve();
                    try {
                      JSON.parse(value);
                      return Promise.resolve();
                    } catch {
                      return Promise.reject('Invalid JSON');
                    }
                  }
                }
              ]}
              extra="Optional request body for POST/PUT requests"
            >
              <Editor
                height="150px"
                language="json"
                theme="vs-dark"
                value={apiBody}
                onChange={(value) => {
                  setApiBody(value || '');
                  form.setFieldValue('apiBody', value || '');
                }}
                options={{
                  minimap: { enabled: false },
                  fontSize: 13
                }}
              />
            </Form.Item>
          </>
        );
    }
  };

  return (
    <div>
      <div style={{ marginBottom: spacing[2] }}>
        <Button
          type="text"
          icon={<ArrowLeftOutlined />}
          onClick={() => navigate(`/scheduled-jobs?orgId=${orgId}`)}
        >
          Back to Scheduled Jobs
        </Button>
      </div>

      <PageHeader
        title={isCreate ? 'Create Scheduled Job' : job?.name || 'Scheduled Job'}
        description={isCreate ? 'Configure a new time-driven batch integration' : 'Manage scheduled job configuration'}
        breadcrumb={[
          { label: 'Configuration', path: '/integrations' },
          { label: 'Scheduled Jobs', path: `/scheduled-jobs?orgId=${orgId}` },
          { label: isCreate ? 'New' : job?.name || 'Details' }
        ]}
        compact
        statusChips={!isCreate && job ? [
          { label: job.isActive ? 'Active' : 'Paused', color: job.isActive ? colors.success[600] : colors.warning[600] },
          { label: job.schedule?.type || 'CRON' },
          { label: job.dataSource?.type || 'SQL', color: colors.primary[600] }
        ] : undefined}
        actions={
          !isCreate && (
            <Space>
              <Button
                icon={<PlayCircleOutlined />}
                onClick={() => executeMutation.mutate()}
                loading={executeMutation.isPending}
                disabled={!job?.isActive}
              >
                Execute Now
              </Button>
              <Button
                type="primary"
                icon={<SaveOutlined />}
                onClick={() => form.submit()}
                loading={saveMutation.isPending}
              >
                Save Changes
              </Button>
            </Space>
          )
        }
      />

      <Form
        form={form}
        layout="vertical"
        onFinish={handleSubmit}
        initialValues={{
          httpMethod: 'POST',
          isActive: true,
          timezone: 'UTC',
          apiMethod: 'GET',
          transformScript: '// Transform the data\nreturn {\n  date: new Date().toISOString(),\n  data: payload.data\n};',
          outgoingAuthType: 'NONE'
        }}
      >
        <Tabs
          defaultActiveKey="basic"
          size="middle"
          tabBarStyle={{ marginBottom: spacing[2] }}
          items={(() => {
            // Check completion status for progressive disclosure
            const values = form.getFieldsValue();
            const basicComplete = !!(values.name && values.type);
            const scheduleComplete = scheduleType === 'CRON'
              ? !!(values.cronExpression)
              : !!(values.intervalMs);
            const datasourceComplete = dataSourceType === 'SQL'
              ? !!(values.sqlQuery)
              : dataSourceType === 'MONGODB'
                ? !!(values.mongoConnectionString && values.mongoDatabase && values.mongoCollection && values.mongoPipeline)
                : !!(values.apiUrl);
            const transformComplete = !!(values.transformScript);
            const targetComplete = !!(values.targetUrl);

            return [
              {
                key: 'basic',
                label: (
                  <Space size={6}>
                    <ThunderboltOutlined />
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
                        label="Job Name"
                        name="name"
                        rules={[{ required: true, message: 'Job name is required' }]}
                      >
                        <Input size="large" placeholder="Daily Bills Export" />
                      </Form.Item>

                      <Form.Item
                        label="Job Type"
                        name="type"
                        extra="Categorize this job for better organization"
                      >
                        <Input size="large" placeholder="DAILY_EXPORT" />
                      </Form.Item>

                      <Form.Item label="Description" name="description">
                        <TextArea rows={3} placeholder="Export daily bills to finance system" />
                      </Form.Item>

                      <Form.Item label="Status" name="isActive" valuePropName="checked">
                        <Radio.Group buttonStyle="solid">
                          <Radio.Button value={true}>Active</Radio.Button>
                          <Radio.Button value={false}>Paused</Radio.Button>
                        </Radio.Group>
                      </Form.Item>
                    </Space>
                  </Card>
                )
              },
              {
                key: 'schedule',
                label: (
                  <Space size={6}>
                    <ClockCircleOutlined />
                    Schedule
                    {scheduleComplete && (
                      <CheckCircleOutlined style={{ color: colors.success[600], fontSize: 14 }} />
                    )}
                  </Space>
                ),
                disabled: !basicComplete, // Requires Basic Info to be complete
                children: (
                  <Card style={{ marginTop: spacing[2] }} size="small">
                    <Space direction="vertical" size="large" style={{ width: '100%' }}>
                      <div>
                        <Text strong style={{ display: 'block', marginBottom: spacing[2] }}>Schedule Type</Text>
                        <Radio.Group
                          value={scheduleType}
                          onChange={(e) => setScheduleType(e.target.value)}
                          buttonStyle="solid"
                        >
                          <Radio.Button value="CRON">Cron Expression</Radio.Button>
                          <Radio.Button value="INTERVAL">Fixed Interval</Radio.Button>
                        </Radio.Group>
                      </div>

                      {scheduleType === 'CRON' ? (
                        <>
                          <Form.Item name="cronExpression" hidden />
                          <Form.Item name="timezone" hidden />
                          <CronBuilder
                            value={form.getFieldValue('cronExpression')}
                            timezone={form.getFieldValue('timezone')}
                            onChange={(cron) => form.setFieldValue('cronExpression', cron)}
                            onTimezoneChange={(tz) => form.setFieldValue('timezone', tz)}
                          />
                        </>
                      ) : (
                        <Form.Item
                          label="Interval (milliseconds)"
                          name="intervalMs"
                          rules={[
                            { required: scheduleType === 'INTERVAL', message: 'Interval is required' },
                            {
                              type: 'number',
                              min: 60000,
                              message: 'Minimum interval is 60000ms (1 minute)'
                            }
                          ]}
                          extra="Minimum: 60000ms (1 minute)"
                        >
                          <Input type="number" size="large" placeholder="3600000" addonAfter="ms" />
                        </Form.Item>
                      )}
                    </Space>
                  </Card>
                )
              },
              {
                key: 'datasource',
                label: (
                  <Space size={6}>
                    <DatabaseOutlined />
                    Data Source
                    {datasourceComplete && (
                      <CheckCircleOutlined style={{ color: colors.success[600], fontSize: 14 }} />
                    )}
                  </Space>
                ),
                disabled: !basicComplete || !scheduleComplete, // Requires Basic Info and Schedule to be complete
                children: (
                  <Card style={{ marginTop: spacing[2] }} size="small">
                    <Space direction="vertical" size="large" style={{ width: '100%' }}>
                      <div>
                        <Text strong style={{ display: 'block', marginBottom: spacing[2] }}>Data Source Type</Text>
                        <Radio.Group
                          value={dataSourceType}
                          onChange={(e) => setDataSourceType(e.target.value)}
                          buttonStyle="solid"
                        >
                          {DATA_SOURCE_TYPES.map(type => (
                            <Radio.Button key={type.value} value={type.value}>
                              <Space>
                                {type.icon}
                                {type.label}
                              </Space>
                            </Radio.Button>
                          ))}
                        </Radio.Group>
                      </div>

                      {renderDataSourceConfig()}

                      {/* Test Data Source Section */}
                      <div style={{ paddingTop: spacing[2] }}>
                        <Alert
                          message="Test Your Data Source"
                          description={
                            <div>
                              <Text>Click below to validate your configuration and preview sample data.</Text>
                              <ul style={{ marginTop: spacing[2], marginBottom: 0, paddingLeft: spacing[4] }}>
                                <li>Variables like <code>{'{{config.tenantId}}'}</code> will be substituted with actual values</li>
                                <li>Test may take up to 30 seconds for complex queries</li>
                                <li>Returns up to 10 sample records for preview</li>
                              </ul>
                            </div>
                          }
                          type="info"
                          showIcon
                          icon={<InfoCircleOutlined />}
                          style={{ marginBottom: spacing[3] }}
                        />
                        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                          <Button
                            icon={<ExperimentOutlined />}
                            onClick={() => testDataSourceMutation.mutate()}
                            loading={testDataSourceMutation.isPending}
                            disabled={!canTestDataSource()}
                            size="large"
                          >
                            {testDataSourceMutation.isPending ? 'Testing Connection...' : 'Test Data Source'}
                          </Button>
                        </div>
                      </div>

                      <Alert
                        message="Variable Substitution"
                        description={
                          <div>
                            <Text>Available variables (works in connection strings, queries, and pipelines):</Text>
                            <ul style={{ marginTop: spacing[2], marginBottom: 0 }}>
                              <li><code>{'{{config.tenantId}}'}</code> - Current tenant ID</li>
                              <li><code>{'{{date.today()}}'}</code> - Today's date (YYYY-MM-DD)</li>
                              <li><code>{'{{date.yesterday()}}'}</code> - Yesterday's date</li>
                              <li><code>{'{{date.todayStart()}}'}</code> - Today at 00:00:00 (ISO)</li>
                              <li><code>{'{{date.todayEnd()}}'}</code> - Today at 23:59:59 (ISO)</li>
                              <li><code>{'{{date.now()}}'}</code> - Current timestamp (ISO)</li>
                              <li><code>{'{{env.VAR_NAME}}'}</code> - Environment variable</li>
                            </ul>
                          </div>
                        }
                        type="info"
                        showIcon
                      />
                    </Space>
                  </Card>
                )
              },
              {
                key: 'transformation',
                label: (
                  <Space size={6}>
                    <CodeOutlined />
                    Transformation
                    {transformComplete && (
                      <CheckCircleOutlined style={{ color: colors.success[600], fontSize: 14 }} />
                    )}
                  </Space>
                ),
                disabled: !basicComplete || !scheduleComplete || !datasourceComplete, // Requires Basic Info, Schedule, and Data Source to be complete
                children: (
                  <Card style={{ marginTop: spacing[2] }} size="small">
                    <Space direction="vertical" size="large" style={{ width: '100%' }}>
                      <Form.Item
                        label="Transformation Script"
                        name="transformScript"
                        rules={[{ required: true, message: 'Transformation script is required' }]}
                        extra="JavaScript function to transform the query results. Return value will be sent to target URL."
                      >
                        <Editor
                          height="300px"
                          language="javascript"
                          theme="vs-dark"
                          value={transformScript}
                          onChange={(value) => {
                            setTransformScript(value || '');
                            form.setFieldValue('transformScript', value || '');
                          }}
                          options={{
                            minimap: { enabled: false },
                            fontSize: 13,
                            lineNumbers: 'on',
                            wordWrap: 'on'
                          }}
                        />
                      </Form.Item>

                      <Alert
                        message="Available Context"
                        description={
                          <div>
                            <Text>The script receives:</Text>
                            <ul style={{ marginTop: spacing[2], marginBottom: 0 }}>
                              <li><code>payload.data</code> - Query results (array or object)</li>
                              <li><code>payload.metadata</code> - Job execution metadata</li>
                            </ul>
                          </div>
                        }
                        type="info"
                        showIcon
                      />
                    </Space>
                  </Card>
                )
              },
              {
                key: 'target',
                label: (
                  <Space size={6}>
                    <ApiOutlined />
                    Target API
                    {targetComplete && (
                      <CheckCircleOutlined style={{ color: colors.success[600], fontSize: 14 }} />
                    )}
                  </Space>
                ),
                disabled: !basicComplete || !scheduleComplete || !datasourceComplete || !transformComplete, // Requires all previous tabs to be complete
                children: (
                  <Card style={{ marginTop: spacing[2] }} size="small">
                    <Space direction="vertical" size="large" style={{ width: '100%' }}>
                      <Form.Item
                        label="Target URL"
                        name="targetUrl"
                        rules={[
                          { required: true, message: 'Target URL is required' },
                          { type: 'url', message: 'Must be a valid URL' }
                        ]}
                      >
                        <Input size="large" placeholder="https://api.finance.com/v1/import" />
                      </Form.Item>

                      <Form.Item label="HTTP Method" name="httpMethod">
                        <Radio.Group buttonStyle="solid">
                          <Radio.Button value="POST">POST</Radio.Button>
                          <Radio.Button value="PUT">PUT</Radio.Button>
                        </Radio.Group>
                      </Form.Item>
                    </Space>
                  </Card>
                )
              },
              {
                key: 'auth',
                label: (
                  <Space size={6}>
                    <LockOutlined />
                    Authentication
                    <CheckCircleOutlined style={{ color: colors.success[600], fontSize: 14 }} />
                  </Space>
                ),
                disabled: !basicComplete || !scheduleComplete || !datasourceComplete || !transformComplete || !targetComplete, // Requires all previous tabs to be complete
                children: (
                  <Card style={{ marginTop: spacing[2] }} size="small">
                    <AuthenticationFields
                      form={form}
                      uiConfig={uiConfig}
                      selectedAuthType={authType}
                      fieldPrefix={['outgoingAuthConfig']}
                      mode="scheduled"
                      spacing={spacing}
                      authTypeFieldName="outgoingAuthType"
                    />
                  </Card>
                )
              },
              {
                key: 'review',
                label: (
                  <Space size={6}>
                    <EyeOutlined />
                    Review & Submit
                    {basicComplete && scheduleComplete && datasourceComplete && transformComplete && targetComplete && (
                      <CheckCircleOutlined style={{ color: colors.success[600], fontSize: 14 }} />
                    )}
                  </Space>
                ),
                disabled: !basicComplete || !scheduleComplete || !datasourceComplete || !transformComplete || !targetComplete, // Requires all previous tabs to be complete
                children: (
                  <Card style={{ marginTop: spacing[2] }} size="small">
                    <Space direction="vertical" size="large" style={{ width: '100%' }}>
                      <Alert
                        type="info"
                        showIcon
                        message="Review Your Configuration"
                        description="Please review all settings before creating the scheduled job. You can click on any tab above to make changes."
                      />

                      {/* Basic Info Summary */}
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: spacing[2], marginBottom: spacing[3] }}>
                          <ThunderboltOutlined style={{ fontSize: 18, color: colors.primary[600] }} />
                          <Text strong style={{ fontSize: 16 }}>Basic Information</Text>
                        </div>
                        <Space direction="vertical" size="small" style={{ width: '100%', paddingLeft: spacing[4] }}>
                          <div style={{ display: 'flex', gap: spacing[2] }}>
                            <Text type="secondary" style={{ minWidth: 150 }}>Job Name:</Text>
                            <Text strong>{form.getFieldValue('name') || <Text type="secondary">Not set</Text>}</Text>
                          </div>
                          <div style={{ display: 'flex', gap: spacing[2] }}>
                            <Text type="secondary" style={{ minWidth: 150 }}>Job Type:</Text>
                            <Text strong>{form.getFieldValue('type') || <Text type="secondary">Not set</Text>}</Text>
                          </div>
                          <div style={{ display: 'flex', gap: spacing[2] }}>
                            <Text type="secondary" style={{ minWidth: 150 }}>Status:</Text>
                            <Tag color={form.getFieldValue('isActive') ? 'success' : 'default'}>
                              {form.getFieldValue('isActive') ? 'Active' : 'Paused'}
                            </Tag>
                          </div>
                          {form.getFieldValue('description') && (
                            <div style={{ display: 'flex', gap: spacing[2] }}>
                              <Text type="secondary" style={{ minWidth: 150 }}>Description:</Text>
                              <Text>{form.getFieldValue('description')}</Text>
                            </div>
                          )}
                        </Space>
                      </div>

                      <Divider style={{ margin: 0 }} />

                      {/* Schedule Summary */}
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: spacing[2], marginBottom: spacing[3] }}>
                          <ClockCircleOutlined style={{ fontSize: 18, color: colors.primary[600] }} />
                          <Text strong style={{ fontSize: 16 }}>Schedule</Text>
                        </div>
                        <Space direction="vertical" size="small" style={{ width: '100%', paddingLeft: spacing[4] }}>
                          <div style={{ display: 'flex', gap: spacing[2] }}>
                            <Text type="secondary" style={{ minWidth: 150 }}>Schedule Type:</Text>
                            <Tag color={scheduleType === 'CRON' ? 'blue' : 'purple'}>{scheduleType}</Tag>
                          </div>
                          {scheduleType === 'CRON' && form.getFieldValue('cronExpression') && (
                            <div style={{ display: 'flex', gap: spacing[2] }}>
                              <Text type="secondary" style={{ minWidth: 150 }}>Cron Expression:</Text>
                              <Text strong><code>{form.getFieldValue('cronExpression')}</code></Text>
                            </div>
                          )}
                          {scheduleType === 'INTERVAL' && form.getFieldValue('intervalMs') && (
                            <div style={{ display: 'flex', gap: spacing[2] }}>
                              <Text type="secondary" style={{ minWidth: 150 }}>Interval:</Text>
                              <Text strong>{form.getFieldValue('intervalMs')}ms</Text>
                            </div>
                          )}
                          {form.getFieldValue('timezone') && (
                            <div style={{ display: 'flex', gap: spacing[2] }}>
                              <Text type="secondary" style={{ minWidth: 150 }}>Timezone:</Text>
                              <Text>{form.getFieldValue('timezone')}</Text>
                            </div>
                          )}
                        </Space>
                      </div>

                      <Divider style={{ margin: 0 }} />

                      {/* Data Source Summary */}
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: spacing[2], marginBottom: spacing[3] }}>
                          <DatabaseOutlined style={{ fontSize: 18, color: colors.primary[600] }} />
                          <Text strong style={{ fontSize: 16 }}>Data Source</Text>
                        </div>
                        <Space direction="vertical" size="small" style={{ width: '100%', paddingLeft: spacing[4] }}>
                          <div style={{ display: 'flex', gap: spacing[2] }}>
                            <Text type="secondary" style={{ minWidth: 150 }}>Source Type:</Text>
                            <Tag color={
                              dataSourceType === 'SQL' ? 'blue' :
                                dataSourceType === 'MONGODB' ? 'green' :
                                  'purple'
                            }>
                              {dataSourceType}
                            </Tag>
                          </div>
                          {dataSourceType === 'SQL' && (
                            <>
                              <div style={{ display: 'flex', gap: spacing[2] }}>
                                <Text type="secondary" style={{ minWidth: 150 }}>Connection:</Text>
                                {sqlConnectionMode === 'FIELDS' && (form.getFieldValue('sqlHost') || form.getFieldValue('sqlDatabase')) ? (
                                  <Text type="secondary">
                                    {form.getFieldValue('sqlHost') || 'host'}{form.getFieldValue('sqlPort') ? `:${form.getFieldValue('sqlPort')}` : ''} / {form.getFieldValue('sqlDatabase') || 'database'}
                                  </Text>
                                ) : form.getFieldValue('sqlConnectionString') ? (
                                  <Text code style={{ fontSize: '11px' }}>{form.getFieldValue('sqlConnectionString')?.substring(0, 30)}...</Text>
                                ) : (
                                  <Text type="secondary">Platform database (default)</Text>
                                )}
                              </div>
                              {form.getFieldValue('sqlQuery') && (
                                <div style={{ display: 'flex', gap: spacing[2] }}>
                                  <Text type="secondary" style={{ minWidth: 150 }}>SQL Query:</Text>
                                  <Text type="secondary">Configured ({form.getFieldValue('sqlQuery').split('\n').length} lines)</Text>
                                </div>
                              )}
                            </>
                          )}
                          {dataSourceType === 'MONGODB' && form.getFieldValue('mongoCollection') && (
                            <>
                              <div style={{ display: 'flex', gap: spacing[2] }}>
                                <Text type="secondary" style={{ minWidth: 150 }}>Connection:</Text>
                                <Text code style={{ fontSize: '11px' }}>{form.getFieldValue('mongoConnectionString')?.substring(0, 30)}...</Text>
                              </div>
                              <div style={{ display: 'flex', gap: spacing[2] }}>
                                <Text type="secondary" style={{ minWidth: 150 }}>Database:</Text>
                                <Text strong>{form.getFieldValue('mongoDatabase')}</Text>
                              </div>
                              <div style={{ display: 'flex', gap: spacing[2] }}>
                                <Text type="secondary" style={{ minWidth: 150 }}>Collection:</Text>
                                <Text strong>{form.getFieldValue('mongoCollection')}</Text>
                              </div>
                              <div style={{ display: 'flex', gap: spacing[2] }}>
                                <Text type="secondary" style={{ minWidth: 150 }}>Aggregation:</Text>
                                <Text type="secondary">Configured ({form.getFieldValue('mongoPipeline')?.split('\n').length || 0} lines)</Text>
                              </div>
                            </>
                          )}
                          {dataSourceType === 'API' && form.getFieldValue('apiUrl') && (
                            <div style={{ display: 'flex', gap: spacing[2] }}>
                              <Text type="secondary" style={{ minWidth: 150 }}>API URL:</Text>
                              <Text strong>{form.getFieldValue('apiUrl')}</Text>
                            </div>
                          )}
                        </Space>
                      </div>

                      <Divider style={{ margin: 0 }} />

                      {/* Transformation Summary */}
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: spacing[2], marginBottom: spacing[3] }}>
                          <CodeOutlined style={{ fontSize: 18, color: colors.primary[600] }} />
                          <Text strong style={{ fontSize: 16 }}>Transformation</Text>
                        </div>
                        <Space direction="vertical" size="small" style={{ width: '100%', paddingLeft: spacing[4] }}>
                          <div style={{ display: 'flex', gap: spacing[2] }}>
                            <Text type="secondary" style={{ minWidth: 150 }}>Transform Script:</Text>
                            {form.getFieldValue('transformScript') ? (
                              <Text type="secondary">Configured ({form.getFieldValue('transformScript').split('\n').length} lines)</Text>
                            ) : (
                              <Text type="secondary">Not set</Text>
                            )}
                          </div>
                        </Space>
                      </div>

                      <Divider style={{ margin: 0 }} />

                      {/* Target API Summary */}
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: spacing[2], marginBottom: spacing[3] }}>
                          <ApiOutlined style={{ fontSize: 18, color: colors.primary[600] }} />
                          <Text strong style={{ fontSize: 16 }}>Target API</Text>
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
                        </Space>
                      </div>

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
                            <Tag color={authType === 'NONE' ? 'default' : 'blue'}>
                              {authType || 'NONE'}
                            </Tag>
                          </div>
                        </Space>
                      </div>

                      {/* Action Buttons */}
                      <Divider style={{ margin: 0 }} />
                      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: spacing[3], paddingTop: spacing[3] }}>
                        <Button size="large" onClick={() => navigate('/scheduled-jobs')} disabled={saveMutation.isPending}>
                          Cancel
                        </Button>
                        <Button
                          type="primary"
                          size="large"
                          icon={<SaveOutlined />}
                          onClick={() => form.submit()}
                          loading={saveMutation.isPending}
                          disabled={!form.getFieldValue('name') || !form.getFieldValue('targetUrl')}
                        >
                          {isCreate ? 'Create Scheduled Job' : 'Save Changes'}
                        </Button>
                      </div>
                    </Space>
                  </Card>
                )
              },
              ...((!isCreate && job) ? [{
                key: 'history',
                label: (
                  <Space size={6}>
                    <HistoryOutlined />
                    Execution History
                  </Space>
                ),
                disabled: false, // History tab always enabled when viewing existing job
                children: (
                  <Card style={{ marginTop: spacing[2] }} size="small">
                    {job.lastExecution ? (
                      <Space direction="vertical" size="large" style={{ width: '100%' }}>
                        <div>
                          <Text strong>Last Execution</Text>
                          <div style={{ marginTop: spacing[2] }}>
                            <Tag color={job.lastExecution.status === 'SUCCESS' ? 'success' : 'error'}>
                              {job.lastExecution.status}
                            </Tag>
                            <Text type="secondary"> at {formatDateTime(job.lastExecution.startedAt)}</Text>
                          </div>
                        </div>
                        {job.lastExecution.recordsFetched !== undefined && (
                          <div>
                            <Text type="secondary">Records Fetched: </Text>
                            <Text strong>{job.lastExecution.recordsFetched}</Text>
                          </div>
                        )}
                        {job.lastExecution.durationMs && (
                          <div>
                            <Text type="secondary">Duration: </Text>
                            <Text strong>{job.lastExecution.durationMs}ms</Text>
                          </div>
                        )}
                      </Space>
                    ) : (
                      <Text type="secondary">No executions yet</Text>
                    )}
                  </Card>
                )
              }] : [])
            ];
          })()}
        />
      </Form>

      {/* Test Data Source Modal */}
      <Modal
        title={
          <Space>
            {testResult?.success ? (
              <CheckCircleOutlined style={{ color: colors.success[600] }} />
            ) : (
              <CloseCircleOutlined style={{ color: colors.error[600] }} />
            )}
            <span>Data Source Test Result</span>
          </Space>
        }
        open={testModalOpen}
        onCancel={() => setTestModalOpen(false)}
        footer={[
          testResult?.success && testResult?.sampleData && (
            <Button
              key="copy"
              icon={<CopyOutlined />}
              onClick={() => {
                navigator.clipboard.writeText(JSON.stringify(testResult.sampleData, null, 2));
                message.success('Sample data copied to clipboard');
              }}
            >
              Copy Sample Data
            </Button>
          ),
          <Button
            key="retest"
            icon={<ExperimentOutlined />}
            onClick={() => {
              setTestModalOpen(false);
              setTimeout(() => testDataSourceMutation.mutate(), 100);
            }}
            loading={testDataSourceMutation.isPending}
          >
            Test Again
          </Button>,
          <Button key="close" type="primary" onClick={() => setTestModalOpen(false)}>
            Close
          </Button>
        ]}
        width={900}
      >
        {testResult && (
          <Space direction="vertical" size="large" style={{ width: '100%' }}>
            {testResult.success ? (
              <>
                <Alert
                  message="Connection Successful"
                  description={testResult.message}
                  type="success"
                  showIcon
                />

                <div>
                  <Text strong>Records Fetched: </Text>
                  <Tag color="blue">{testResult.recordsFetched}</Tag>
                  {testResult.limitedRecords && (
                    <Tag color="orange">Showing first 10 records</Tag>
                  )}
                </div>

                {testResult.sampleData && (
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing[2] }}>
                      <Text strong>Sample Data:</Text>
                      <Button
                        size="small"
                        icon={<CopyOutlined />}
                        onClick={() => {
                          navigator.clipboard.writeText(JSON.stringify(testResult.sampleData, null, 2));
                          message.success('Copied to clipboard');
                        }}
                      >
                        Copy
                      </Button>
                    </div>
                    {Array.isArray(testResult.sampleData) ? (
                      testResult.sampleData.length > 0 ? (
                        <>
                          {/* Try to render as table if records have consistent structure */}
                          {(() => {
                            const firstRecord = testResult.sampleData[0];
                            if (firstRecord && typeof firstRecord === 'object' && !Array.isArray(firstRecord)) {
                              const keys = Object.keys(firstRecord);
                              const allRecordsHaveSameKeys = testResult.sampleData.every(
                                (record: any) =>
                                  record &&
                                  typeof record === 'object' &&
                                  Object.keys(record).length === keys.length
                              );

                              if (allRecordsHaveSameKeys && keys.length <= 10) {
                                // Render as table for better readability
                                const columns = keys.slice(0, 8).map(key => ({
                                  title: key,
                                  dataIndex: key,
                                  key: key,
                                  ellipsis: true,
                                  render: (value: any) => {
                                    if (value === null) return <Text type="secondary">null</Text>;
                                    if (value === undefined) return <Text type="secondary">undefined</Text>;
                                    if (typeof value === 'object') {
                                      return <Text code style={{ fontSize: '11px' }}>{JSON.stringify(value)}</Text>;
                                    }
                                    return String(value);
                                  }
                                }));

                                return (
                                  <div style={{ marginTop: spacing[2] }}>
                                    <Table
                                      dataSource={testResult.sampleData.map((item: any, idx: number) => ({ ...item, key: idx }))}
                                      columns={columns}
                                      size="small"
                                      pagination={false}
                                      scroll={{ x: 'max-content', y: 300 }}
                                      bordered
                                    />
                                    {keys.length > 8 && (
                                      <Alert
                                        message={`Showing first 8 of ${keys.length} columns`}
                                        type="info"
                                        showIcon
                                        style={{ marginTop: spacing[2] }}
                                      />
                                    )}
                                  </div>
                                );
                              }
                            }

                            // Fall back to JSON view
                            return (
                              <div style={{
                                maxHeight: '400px',
                                overflow: 'auto',
                                border: `1px solid ${colors.neutral[200]}`,
                                borderRadius: token.borderRadius,
                                padding: spacing[2],
                                backgroundColor: colors.neutral[50]
                              }}>
                                <pre style={{
                                  margin: 0,
                                  fontSize: '12px',
                                  fontFamily: 'monospace',
                                  whiteSpace: 'pre-wrap',
                                  wordBreak: 'break-word'
                                }}>
                                  {JSON.stringify(testResult.sampleData, null, 2)}
                                </pre>
                              </div>
                            );
                          })()}
                        </>
                      ) : (
                        <Alert
                          message="No data returned"
                          description="The query executed successfully but returned no results."
                          type="info"
                          showIcon
                        />
                      )
                    ) : (
                      <div style={{
                        maxHeight: '400px',
                        overflow: 'auto',
                        border: `1px solid ${colors.neutral[200]}`,
                        borderRadius: token.borderRadius,
                        padding: spacing[2],
                        backgroundColor: colors.neutral[50]
                      }}>
                        <pre style={{
                          margin: 0,
                          fontSize: '12px',
                          fontFamily: 'monospace',
                          whiteSpace: 'pre-wrap',
                          wordBreak: 'break-word'
                        }}>
                          {JSON.stringify(testResult.sampleData, null, 2)}
                        </pre>
                      </div>
                    )}
                  </div>
                )}
              </>
            ) : (
              <>
                <Alert
                  message="Connection Failed"
                  description={testResult.error || 'An error occurred while testing the data source'}
                  type="error"
                  showIcon
                />

                {/* Common error hints */}
                <div style={{
                  padding: spacing[3],
                  backgroundColor: colors.warning[50],
                  border: `1px solid ${colors.warning[200]}`,
                  borderRadius: token.borderRadius
                }}>
                  <Text strong style={{ display: 'block', marginBottom: spacing[2] }}>
                    💡 Common Issues:
                  </Text>
                  <ul style={{ margin: 0, paddingLeft: spacing[4] }}>
                    {dataSourceType === 'SQL' && (
                      <>
                        <li>Check SQL syntax and table/column names</li>
                        <li>Verify database connection and credentials</li>
                        <li>Ensure query doesn't have syntax errors</li>
                      </>
                    )}
                    {dataSourceType === 'MONGODB' && (
                      <>
                        <li>Verify MongoDB connection string format: <code>mongodb://host:port</code></li>
                        <li>Check database and collection names are correct</li>
                        <li>Ensure aggregation pipeline is valid JSON array</li>
                        <li>Verify authentication credentials if required</li>
                      </>
                    )}
                    {dataSourceType === 'API' && (
                      <>
                        <li>Verify API endpoint URL is correct and accessible</li>
                        <li>Check headers JSON format is valid</li>
                        <li>Ensure authentication headers are correct</li>
                        <li>Verify the API is responding (not timeout/down)</li>
                      </>
                    )}
                  </ul>
                </div>

                {testResult.details && (
                  <Collapse
                    ghost
                    items={[{
                      key: '1',
                      label: <Text strong>View Technical Details</Text>,
                      children: (
                        <div style={{
                          padding: spacing[2],
                          backgroundColor: colors.neutral[50],
                          border: `1px solid ${colors.neutral[200]}`,
                          borderRadius: token.borderRadius,
                          maxHeight: '200px',
                          overflow: 'auto'
                        }}>
                          <pre style={{ margin: 0, fontSize: '11px', whiteSpace: 'pre-wrap' }}>
                            {typeof testResult.details === 'string'
                              ? testResult.details
                              : JSON.stringify(testResult.details, null, 2)}
                          </pre>
                        </div>
                      )
                    }]}
                  />
                )}
              </>
            )}
          </Space>
        )}
      </Modal>
    </div>
  );
};
