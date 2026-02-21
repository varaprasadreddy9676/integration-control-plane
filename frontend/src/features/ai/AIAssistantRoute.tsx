import { useState, useRef, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Button, Input, Space, Typography, Avatar, Spin, Card, List, Alert, Grid
} from 'antd';
import {
  RobotOutlined, UserOutlined, SendOutlined,
  WarningOutlined, ApiOutlined, ThunderboltOutlined,
  QuestionCircleOutlined, ClearOutlined
} from '@ant-design/icons';
import { Link } from 'react-router-dom';
import { PageHeader } from '../../components/common/PageHeader';
import { useTenant } from '../../app/tenant-context';
import { chatWithAI, checkAIStatus, type ChatMessage } from '../../services/ai-api';
import { useDesignTokens } from '../../design-system/utils';
import { MarkdownMessage } from '../../components/ai/MarkdownMessage';

const { Text, Paragraph, Title } = Typography;

const QUICK_ACTIONS = [
  {
    label: 'Analyze recent errors',
    icon: <WarningOutlined style={{ color: '#faad14' }} />,
    message: 'Show me recent delivery errors and explain what might be causing them.'
  },
  {
    label: 'Show failing integrations',
    icon: <ApiOutlined style={{ color: '#ff4d4f' }} />,
    message: 'Which of my integrations are failing or having issues? What should I do to fix them?'
  },
  {
    label: 'Help create integration',
    icon: <ThunderboltOutlined style={{ color: '#1677ff' }} />,
    message: 'Help me create a new integration. What information do I need and what are the best practices?'
  },
  {
    label: 'Explain event types',
    icon: <QuestionCircleOutlined style={{ color: '#52c41a' }} />,
    message: 'What event types does my organization have? What does each one mean?'
  }
];

interface Message extends ChatMessage {
  id: string;
  pending?: boolean;
}

export const AIAssistantRoute = () => {
  const { token, spacing } = useDesignTokens();
  const { orgId } = useTenant();
  const screens = Grid.useBreakpoint();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

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

  const addMessage = (msg: Omit<Message, 'id'>): string => {
    const id = Date.now().toString() + Math.random();
    setMessages(prev => [...prev, { ...msg, id }]);
    return id;
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
      const result = await chatWithAI(orgId, history);
      setMessages(prev => prev.map(m =>
        m.id === pendingId ? { ...m, content: result.reply, pending: false } : m
      ));
    } catch (err: any) {
      let errorContent: string;
      const status = err.response?.status;
      if (status === 429) {
        errorContent = 'Daily AI limit reached. Resets tomorrow — or increase your limit in AI Settings.';
      } else if (status === 503) {
        errorContent = 'AI service unavailable. Check that your API key is valid in AI Settings.';
      } else if (status === 401 || status === 403) {
        errorContent = 'Authentication error. Your session may have expired — try refreshing the page.';
      } else if (err.code === 'ERR_NETWORK' || err.message?.toLowerCase().includes('network')) {
        errorContent = 'Network error — check your connection and try again.';
      } else if (err.name === 'CanceledError' || err.name === 'AbortError') {
        errorContent = 'Request cancelled.';
      } else {
        errorContent = err.message || 'AI request failed. Please try again.';
      }
      setMessages(prev => prev.map(m =>
        m.id === pendingId ? { ...m, content: errorContent, pending: false } : m
      ));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="AI Assistant"
        description="Ask questions about your integrations, errors, and configurations"
        actions={
          messages.length > 0 ? (
            <Button
              icon={<ClearOutlined />}
              onClick={() => setMessages([])}
            >
              Clear chat
            </Button>
          ) : undefined
        }
      />

      {aiAvailable === false && (
        <Alert
          type="warning"
          showIcon
          message="AI not configured"
          description="Please configure your AI provider in AI Settings before using this feature."
          action={<Link to="/ai-settings"><Button size="small">Configure AI</Button></Link>}
          style={{ marginBottom: spacing[4] }}
        />
      )}

      <div style={{ display: 'flex', flexDirection: screens.md ? 'row' : 'column', gap: spacing[4], height: 'calc(100vh - 200px)', minHeight: 400 }}>
        {/* Quick actions sidebar — hidden on mobile once conversation starts */}
        {(screens.md || messages.length === 0) && (
        <Card
          title="Quick Actions"
          size="small"
          style={{ width: screens.md ? 220 : '100%', flexShrink: 0, borderRadius: token.borderRadiusLG, alignSelf: 'flex-start' }}
        >
          <List
            size="small"
            dataSource={QUICK_ACTIONS}
            renderItem={action => (
              <List.Item style={{ padding: '4px 0', cursor: 'pointer' }}>
                <Button
                  type="text"
                  icon={action.icon}
                  onClick={() => sendMessage(action.message)}
                  disabled={loading || !aiAvailable}
                  style={{ textAlign: 'left', width: '100%', height: 'auto', padding: '6px 8px', whiteSpace: 'normal' }}
                >
                  <Text style={{ fontSize: 12 }}>{action.label}</Text>
                </Button>
              </List.Item>
            )}
          />
        </Card>
        )}

        {/* Chat area */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          <Card
            style={{
              flex: 1,
              borderRadius: token.borderRadiusLG,
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden'
            }}
            styles={{ body: { flex: 1, overflowY: 'auto', padding: spacing[4], display: 'flex', flexDirection: 'column' } }}
          >
            {messages.length === 0 ? (
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                <RobotOutlined style={{ fontSize: 48, color: token.colorPrimary, marginBottom: spacing[4] }} />
                <Title level={4} style={{ marginBottom: spacing[2] }}>How can I help you?</Title>
                <Paragraph type="secondary" style={{ textAlign: 'center', maxWidth: 400 }}>
                  I have access to your organization's integrations, delivery logs, and event configurations.
                  Ask me anything!
                </Paragraph>
              </div>
            ) : (
              <div style={{ flex: 1 }}>
                {messages.map(msg => (
                  <div
                    key={msg.id}
                    style={{
                      display: 'flex',
                      gap: spacing[3],
                      marginBottom: spacing[4],
                      flexDirection: msg.role === 'user' ? 'row-reverse' : 'row',
                      alignItems: 'flex-start'
                    }}
                  >
                    <Avatar
                      size={36}
                      icon={msg.role === 'user' ? <UserOutlined /> : <RobotOutlined />}
                      style={{
                        flexShrink: 0,
                        background: msg.role === 'user' ? token.colorPrimary : '#52c41a'
                      }}
                    />
                    <div
                      style={{
                        maxWidth: '75%',
                        padding: `${spacing[3]} ${spacing[4]}`,
                        borderRadius: msg.role === 'user' ? '16px 4px 16px 16px' : '4px 16px 16px 16px',
                        background: msg.role === 'user' ? token.colorPrimary : token.colorFillAlter,
                        color: msg.role === 'user' ? '#fff' : token.colorText
                      }}
                    >
                      {msg.pending ? (
                        <Space>
                          <Spin size="small" />
                          <Text type="secondary" style={{ fontSize: 13 }}>Thinking...</Text>
                        </Space>
                      ) : (
                        <MarkdownMessage
                          content={msg.content}
                          inverted={msg.role === 'user'}
                          fontSize={14}
                        />
                      )}
                    </div>
                  </div>
                ))}
                <div ref={bottomRef} />
              </div>
            )}
          </Card>

          {/* Input */}
          <div style={{ marginTop: spacing[3], display: 'flex', gap: 8, alignItems: 'flex-end' }}>
            <Input.TextArea
              autoSize={{ minRows: 1, maxRows: 5 }}
              placeholder={aiAvailable === false ? 'AI not configured' : 'Ask anything… (Enter to send, Shift+Enter for new line)'}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  sendMessage(input);
                }
              }}
              disabled={loading || !aiAvailable}
              autoFocus
              style={{ flex: 1, fontSize: 14 }}
            />
            <Button
              type="primary"
              size="large"
              icon={<SendOutlined />}
              onClick={() => sendMessage(input)}
              disabled={!input.trim() || loading || !aiAvailable}
              loading={loading}
            >
              Send
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};
