import { useState, useRef, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Drawer, Button, Input, Space, Typography, Avatar, Spin, Tag, Tooltip, Grid,
  Card, Descriptions, message as antMessage
} from 'antd';
import {
  RobotOutlined, UserOutlined, SendOutlined, ClearOutlined,
  PlusCircleOutlined, WarningOutlined, ApiOutlined, CalendarOutlined,
  CheckCircleOutlined, EditOutlined
} from '@ant-design/icons';
import { useLocation, useNavigate } from 'react-router-dom';
import { useTenant } from '../../app/tenant-context';
import {
  chatWithAI, checkAIStatus,
  type ChatMessage, type ChatContext, type ChatAction
} from '../../services/ai-api';
import { createOutboundIntegrationRaw, createInboundIntegration, createScheduledJob } from '../../services/api';
import { MarkdownMessage } from './MarkdownMessage';

const { Text, Paragraph } = Typography;

const QUICK_ACTIONS = [
  {
    label: 'Create an integration',
    icon: <PlusCircleOutlined style={{ color: '#52c41a' }} />,
    message: 'I want to create a new integration. Please guide me step by step.'
  },
  {
    label: 'Debug recent failures',
    icon: <WarningOutlined style={{ color: '#faad14' }} />,
    message: 'Show me my most recent delivery failures and explain what is causing them. How do I fix them?'
  },
  {
    label: 'Integration health check',
    icon: <ApiOutlined style={{ color: '#1677ff' }} />,
    message: 'Do a health check on all my integrations. Which ones are active, which are failing, and which are inactive?'
  },
  {
    label: 'Schedule a reminder',
    icon: <CalendarOutlined style={{ color: '#722ed1' }} />,
    message: 'I want to set up a scheduled integration that sends appointment reminders. Can you guide me?'
  }
];

interface Message extends ChatMessage {
  id: string;
  pending?: boolean;
  action?: ChatAction;
}

function useContextFromLocation(): ChatContext {
  const location = useLocation();
  const context: ChatContext = {};
  const logMatch = location.pathname.match(/\/logs\/([^/]+)$/);
  if (logMatch) context.logId = logMatch[1];
  const intMatch = location.pathname.match(/\/integrations\/([^/]+)$/);
  if (intMatch) context.integrationId = intMatch[1];
  return context;
}

// ─── Integration Review Card ──────────────────────────────────────────────────

interface ReviewCardProps {
  config: Record<string, any>;
  onCreated: (id: string, name: string, isInbound: boolean, isScheduled: boolean) => void;
  onError: (msg: string) => void;
}

const AUTH_LABELS: Record<string, string> = {
  NONE: 'None',
  API_KEY: 'API Key',
  BEARER: 'Bearer Token',
  BASIC: 'Basic Auth',
  OAUTH2: 'OAuth2',
  CUSTOM: 'Custom Headers'
};

const normalizeAIDraftForCreate = (draft: Record<string, any>) => {
  if (!draft || typeof draft !== 'object') return draft;

  if (draft.direction === 'INBOUND') {
    const normalized = { ...draft };

    // Accept shorthand drafts and normalize into backend/UI canonical actions shape.
    if (!Array.isArray(normalized.actions) || normalized.actions.length === 0) {
      if (normalized.communicationConfig) {
        normalized.actions = [
          {
            name: `Send ${normalized.communicationConfig.channel || 'EMAIL'}`,
            kind: 'COMMUNICATION',
            communicationConfig: normalized.communicationConfig
          }
        ];
      } else if (normalized.smtp) {
        normalized.actions = [
          {
            name: 'Send EMAIL',
            kind: 'COMMUNICATION',
            communicationConfig: {
              channel: 'EMAIL',
              provider: 'SMTP',
              smtp: normalized.smtp
            }
          }
        ];
      }
    }

    return normalized;
  }

  return draft;
};

const IntegrationReviewCard = ({ config, onCreated, onError }: ReviewCardProps) => {
  const [creating, setCreating] = useState(false);
  const [done, setDone] = useState(false);

  const isInbound = config.direction === 'INBOUND';
  const isScheduled = config.direction === 'SCHEDULED';
  const smtpConfig = config.actions?.[0]?.communicationConfig?.smtp;
  const isCommunication = isInbound && Array.isArray(config.actions) && config.actions.some((a: any) => a.kind === 'COMMUNICATION');

  const handleCreate = async () => {
    setCreating(true);
    try {
      let result: any;
      const normalizedConfig = normalizeAIDraftForCreate(config);
      if (isInbound) {
        result = await createInboundIntegration(normalizedConfig);
      } else if (isScheduled) {
        result = await createScheduledJob(normalizedConfig);
      } else {
        result = await createOutboundIntegrationRaw(normalizedConfig);
      }
      setDone(true);
      onCreated(result?.id || result?._id || '', normalizedConfig.name, isInbound, isScheduled);
    } catch (err: any) {
      onError(err?.message || 'Failed to create integration');
    } finally {
      setCreating(false);
    }
  };

  if (done) {
    return (
      <div style={{
        marginTop: 8, padding: '10px 14px',
        background: 'rgba(82,196,26,0.08)', borderRadius: 8,
        border: '1px solid rgba(82,196,26,0.3)',
        display: 'flex', alignItems: 'center', gap: 8
      }}>
        <CheckCircleOutlined style={{ color: '#52c41a', fontSize: 16 }} />
        <Text style={{ fontSize: 13, color: '#52c41a' }}>Integration created successfully!</Text>
      </div>
    );
  }

  return (
    <Card
      size="small"
      title={
        <Space>
          <CheckCircleOutlined style={{ color: '#1677ff' }} />
          <Text strong style={{ fontSize: 13 }}>Ready to create</Text>
        </Space>
      }
      style={{
        marginTop: 8, borderRadius: 8,
        border: '1px solid rgba(22,119,255,0.3)',
        background: 'rgba(22,119,255,0.03)'
      }}
      styles={{ body: { padding: '10px 12px' } }}
    >
      <Descriptions column={1} size="small" styles={{ label: { fontSize: 12, color: '#888', width: 110 }, content: { fontSize: 12 } }}>
        <Descriptions.Item label="Name">{config.name}</Descriptions.Item>
        <Descriptions.Item label="Direction">
          {isInbound ? 'Inbound' : isScheduled ? 'Scheduled Job' : 'Outbound'}
        </Descriptions.Item>
        {isInbound && config.type && (
          <Descriptions.Item label="Type Slug"><code>{config.type}</code></Descriptions.Item>
        )}
        {isCommunication ? (
          <>
            <Descriptions.Item label="Channel">Email (SMTP)</Descriptions.Item>
            {smtpConfig && (
              <>
                <Descriptions.Item label="SMTP Host">{smtpConfig.host}:{smtpConfig.port}</Descriptions.Item>
                <Descriptions.Item label="From">{smtpConfig.fromEmail}</Descriptions.Item>
              </>
            )}
          </>
        ) : isScheduled ? (
          <>
            {config.schedule && (
              <Descriptions.Item label="Schedule">
                {config.schedule.type === 'CRON'
                  ? <><code>{config.schedule.expression}</code> ({config.schedule.timezone || 'UTC'})</>
                  : `Every ${Math.round((config.schedule.intervalMs || 0) / 60000)} min`}
              </Descriptions.Item>
            )}
            {config.dataSource && (
              <Descriptions.Item label="Data Source">{config.dataSource.type}</Descriptions.Item>
            )}
            {config.targetUrl && (
              <Descriptions.Item label="Target URL">
                <Text style={{ fontSize: 12, wordBreak: 'break-all' }}>{config.targetUrl}</Text>
              </Descriptions.Item>
            )}
            <Descriptions.Item label="Auth">{AUTH_LABELS[config.outgoingAuthType] || config.outgoingAuthType || 'None'}</Descriptions.Item>
            <Descriptions.Item label="Transform">{config.transformation?.mode || 'SIMPLE'}</Descriptions.Item>
          </>
        ) : (
          <>
            {config.eventType && <Descriptions.Item label="Event">{config.eventType}</Descriptions.Item>}
            {config.targetUrl && (
              <Descriptions.Item label="Target URL">
                <Text style={{ fontSize: 12, wordBreak: 'break-all' }}>{config.targetUrl}</Text>
              </Descriptions.Item>
            )}
            <Descriptions.Item label="Method">{config.httpMethod || 'POST'}</Descriptions.Item>
            {!isInbound && (
              <>
                <Descriptions.Item label="Auth">{AUTH_LABELS[config.outgoingAuthType] || config.outgoingAuthType || 'None'}</Descriptions.Item>
                <Descriptions.Item label="Delivery">{config.deliveryMode || 'IMMEDIATE'}</Descriptions.Item>
                {config.schedulingConfig?.description && (
                  <Descriptions.Item label="Schedule">
                    <Text style={{ fontSize: 12 }}>{config.schedulingConfig.description}</Text>
                  </Descriptions.Item>
                )}
                <Descriptions.Item label="Transform">{config.transformation?.mode || 'PASSTHROUGH'}</Descriptions.Item>
              </>
            )}
          </>
        )}
      </Descriptions>

      <Space style={{ marginTop: 10 }}>
        <Button
          type="primary"
          size="small"
          icon={<CheckCircleOutlined />}
          onClick={handleCreate}
          loading={creating}
        >
          Create Integration
        </Button>
        <Button
          size="small"
          icon={<EditOutlined />}
          onClick={() => {/* User can continue the chat to modify */}}
        >
          Request changes
        </Button>
      </Space>
    </Card>
  );
};

// ─── Main Drawer Component ────────────────────────────────────────────────────

export const AIChatDrawer = () => {
  const { orgId } = useTenant();
  const navigate = useNavigate();
  const screens = Grid.useBreakpoint();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<any>(null);
  const context = useContextFromLocation();
  const [messageApi, contextHolder] = antMessage.useMessage();

  const { data: aiStatusData } = useQuery({
    queryKey: ['ai-status', orgId],
    queryFn: () => checkAIStatus(orgId!),
    enabled: !!orgId,
    staleTime: 30_000
  });
  const aiAvailable = orgId ? (aiStatusData?.available ?? null) : false;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  if (!aiAvailable) return null;

  const addMessage = (msg: Omit<Message, 'id'>) => {
    const id = Date.now().toString() + Math.random();
    setMessages(prev => [...prev, { ...msg, id }]);
    return id;
  };

  const appendSystemMessage = (content: string) => {
    addMessage({ role: 'assistant', content });
  };

  const sendMessage = async (text: string) => {
    if (!text.trim() || loading || !orgId) return;
    setInput('');
    addMessage({ role: 'user', content: text });

    const pendingId = addMessage({ role: 'assistant', content: '', pending: true });
    setLoading(true);

    try {
      const history: ChatMessage[] = [
        ...messages.filter(m => !m.pending).map(m => ({ role: m.role, content: m.content })),
        { role: 'user', content: text }
      ];

      const result = await chatWithAI(orgId, history, context);

      setMessages(prev => prev.map(m =>
        m.id === pendingId
          ? { ...m, content: result.reply, pending: false, action: result.action }
          : m
      ));
    } catch (err: any) {
      let errorContent: string;
      const status = err.response?.status;
      if (status === 429) errorContent = 'Daily AI limit reached. Resets tomorrow — or increase your limit in AI Settings.';
      else if (status === 503) errorContent = 'AI service unavailable. Check your API key in AI Settings.';
      else if (status === 401 || status === 403) errorContent = 'Authentication error — try refreshing the page.';
      else if (err.code === 'ERR_NETWORK' || err.message?.toLowerCase().includes('network')) errorContent = 'Network error — check your connection.';
      else if (err.name === 'CanceledError' || err.name === 'AbortError') errorContent = 'Request cancelled.';
      else errorContent = err.message || 'AI request failed. Please try again.';

      setMessages(prev => prev.map(m =>
        m.id === pendingId ? { ...m, content: errorContent, pending: false } : m
      ));
    } finally {
      setLoading(false);
    }
  };

  const handleQuickAction = (msg: string) => {
    setOpen(true);
    setTimeout(() => sendMessage(msg), 100);
  };

  const handleIntegrationCreated = (id: string, name: string, isInbound: boolean, isScheduled: boolean) => {
    appendSystemMessage(`**${name}** is live! ${id ? `You can find it in your integrations list.` : ''}`);
    if (id) {
      setTimeout(() => {
        messageApi.success({ content: 'Integration created! Opening...', duration: 2 });
        const path = isInbound
          ? `/inbound-integrations/${id}`
          : isScheduled
          ? `/scheduled-jobs/${id}`
          : `/integrations/${id}`;
        navigate(path);
      }, 1200);
    }
  };

  const handleIntegrationError = (msg: string) => {
    appendSystemMessage(`Sorry, I couldn't create the integration: **${msg}**\n\nPlease try again or create it manually from the integrations page.`);
  };

  const contextTags = [];
  if (context.logId) contextTags.push(<Tag key="log" color="orange" style={{ fontSize: 11 }}>Log context</Tag>);
  if (context.integrationId) contextTags.push(<Tag key="int" color="blue" style={{ fontSize: 11 }}>Integration context</Tag>);

  return (
    <>
      {contextHolder}

      {/* Floating button */}
      <Tooltip title="AI Assistant" placement="left">
        <Button
          type="primary"
          shape="circle"
          size="large"
          icon={<RobotOutlined />}
          onClick={() => setOpen(true)}
          style={{
            position: 'fixed',
            bottom: 32,
            right: 32,
            zIndex: 1100,
            width: 56,
            height: 56,
            fontSize: 24,
            boxShadow: '0 4px 20px rgba(22,119,255,0.35)'
          }}
        />
      </Tooltip>

      {/* Chat Drawer */}
      <Drawer
        title={
          <Space>
            <RobotOutlined style={{ color: '#1677ff' }} />
            <span>AI Assistant</span>
            {contextTags}
          </Space>
        }
        placement="right"
        width={screens.md ? 440 : '100vw'}
        open={open}
        onClose={() => setOpen(false)}
        afterOpenChange={vis => { if (vis) inputRef.current?.focus(); }}
        mask={false}
        extra={
          messages.length > 0 ? (
            <Button
              type="text"
              size="small"
              icon={<ClearOutlined />}
              onClick={() => setMessages([])}
            >
              Clear
            </Button>
          ) : null
        }
        styles={{
          body: { display: 'flex', flexDirection: 'column', padding: 0, height: '100%' },
          header: { borderBottom: '1px solid rgba(0,0,0,0.06)', padding: '12px 16px' }
        }}
      >
        {/* Message list */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '12px 16px' }}>
          {/* Empty state — quick actions */}
          {messages.length === 0 && (
            <div style={{ padding: '8px 0' }}>
              <Paragraph type="secondary" style={{ fontSize: 13, marginBottom: 16 }}>
                I can help you create integrations, diagnose failures, and answer questions about your setup. I have full access to your organization's live data.
              </Paragraph>
              <Text type="secondary" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, display: 'block', marginBottom: 8 }}>
                Quick start
              </Text>
              <Space direction="vertical" size={6} style={{ width: '100%' }}>
                {QUICK_ACTIONS.map(action => (
                  <Button
                    key={action.label}
                    icon={action.icon}
                    onClick={() => handleQuickAction(action.message)}
                    style={{
                      textAlign: 'left',
                      width: '100%',
                      height: 'auto',
                      padding: '8px 12px',
                      borderRadius: 8,
                      whiteSpace: 'normal'
                    }}
                  >
                    <Text style={{ fontSize: 13 }}>{action.label}</Text>
                  </Button>
                ))}
              </Space>
            </div>
          )}

          {/* Message thread */}
          {messages.map(msg => (
            <div
              key={msg.id}
              style={{
                display: 'flex',
                gap: 8,
                marginBottom: 14,
                flexDirection: msg.role === 'user' ? 'row-reverse' : 'row',
                alignItems: 'flex-start'
              }}
            >
              <Avatar
                size={28}
                icon={msg.role === 'user' ? <UserOutlined /> : <RobotOutlined />}
                style={{
                  flexShrink: 0,
                  background: msg.role === 'user' ? '#1677ff' : '#52c41a'
                }}
              />
              <div style={{ maxWidth: '82%', minWidth: 60 }}>
                <div
                  style={{
                    padding: '8px 12px',
                    borderRadius: msg.role === 'user' ? '12px 2px 12px 12px' : '2px 12px 12px 12px',
                    background: msg.role === 'user' ? '#1677ff' : 'rgba(0,0,0,0.04)',
                    color: msg.role === 'user' ? '#fff' : 'inherit'
                  }}
                >
                  {msg.pending ? (
                    <Spin size="small" />
                  ) : (
                    <MarkdownMessage
                      content={msg.content}
                      inverted={msg.role === 'user'}
                      fontSize={13}
                    />
                  )}
                </div>

                {/* Integration review card — rendered below the bubble */}
                {!msg.pending && msg.action?.type === 'CREATE_INTEGRATION' && (
                  <IntegrationReviewCard
                    config={msg.action.config}
                    onCreated={handleIntegrationCreated}
                    onError={handleIntegrationError}
                  />
                )}
              </div>
            </div>
          ))}
          <div ref={bottomRef} />
        </div>

        {/* Input area */}
        <div style={{ padding: '10px 16px', borderTop: '1px solid rgba(0,0,0,0.06)', flexShrink: 0 }}>
          <Space.Compact style={{ width: '100%' }}>
            <Input
              ref={inputRef}
              placeholder="Ask about your integrations or type a request…"
              value={input}
              onChange={e => setInput(e.target.value)}
              onPressEnter={() => sendMessage(input)}
              disabled={loading}
              style={{ fontSize: 13 }}
            />
            <Button
              type="primary"
              icon={<SendOutlined />}
              onClick={() => sendMessage(input)}
              disabled={!input.trim() || loading}
              loading={loading}
            />
          </Space.Compact>
          <Text type="secondary" style={{ fontSize: 11, display: 'block', marginTop: 4, textAlign: 'center' }}>
            AI can create, update, and diagnose integrations
          </Text>
        </div>
      </Drawer>
    </>
  );
};
