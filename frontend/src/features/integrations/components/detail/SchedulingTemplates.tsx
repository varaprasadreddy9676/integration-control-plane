import { useEffect, useMemo, useState } from 'react';
import { Card, Row, Col, Button, Typography, Tag, Space, Tooltip } from 'antd';
import {
  ClockCircleOutlined,
  CalendarOutlined,
  ThunderboltOutlined,
  BellOutlined,
  SyncOutlined,
  CopyOutlined,
  DownOutlined,
  RightOutlined
} from '@ant-design/icons';
import { useDesignTokens, withAlpha, cssVar } from '../../../../design-system/utils';

const { Text } = Typography;

interface SchedulingTemplate {
  id: string;
  name: string;
  description: string;
  mode: 'DELAYED' | 'RECURRING';
  icon: React.ReactNode;
  color: string;
  script: string;
  usageNote?: string;
}

const TEMPLATES: SchedulingTemplate[] = [
  {
    id: 'd-24hrs',
    name: 'D-24hrs Before Visit',
    description: 'Send 24 hours before visit/appointment',
    mode: 'DELAYED',
    icon: <ClockCircleOutlined />,
    color: 'blue',
    script: `// Send 24 hours before visit/appointment
// Works with: OP_VISIT_CREATED, APPOINTMENT_SCHEDULED
const visitDate = event?.visit?.date || event?.appt?.apptDate || event?.appt?.fromDate;
const visitTime = event?.visit?.time || event?.appt?.apptTime || event?.appt?.fromTime;

if (!visitDate || !visitTime) {
  throw new Error('Visit date/time not found. Available fields: ' + Object.keys(event).join(', '));
}

// Handle date formats: DD/MM/YYYY or YYYY-MM-DD
let isoDate = visitDate;
if (visitDate.includes('/')) {
  const [day, month, year] = visitDate.split('/');
  isoDate = \`\${year}-\${month.padStart(2, '0')}-\${day.padStart(2, '0')}\`;
}

// Handle time formats: HH:mm AM/PM or HH:mm:ss
let time24 = visitTime;
if (visitTime.includes('AM') || visitTime.includes('PM')) {
  const isPM = visitTime.includes('PM');
  const timeOnly = visitTime.replace(/AM|PM/gi, '').trim();
  const [hours, minutes] = timeOnly.split(':').map(Number);
  const hours24 = isPM && hours !== 12 ? hours + 12 : !isPM && hours === 12 ? 0 : hours;
  time24 = \`\${String(hours24).padStart(2, '0')}:\${String(minutes).padStart(2, '0')}:00\`;
} else if (time24.split(':').length === 2) {
  time24 = \`\${time24}:00\`;
}

const visitDateTime = \`\${isoDate}T\${time24}+05:30\`;
const visitAt = parseDate(visitDateTime);

// Schedule 24 hours before
const reminderAt = subtractHours(visitAt, 24);
return toTimestamp(reminderAt);`,
    usageNote: 'Works with OP_VISIT_CREATED (visit.date/time) and APPOINTMENT events (appt.apptDate/time)'
  },
  {
    id: 't-3hrs',
    name: 'T-3hrs Before Visit',
    description: 'Send 3 hours before visit/appointment',
    mode: 'DELAYED',
    icon: <BellOutlined />,
    color: 'orange',
    script: `// Send 3 hours before visit/appointment
// Works with: OP_VISIT_CREATED, APPOINTMENT_SCHEDULED
const visitDate = event?.visit?.date || event?.appt?.apptDate || event?.appt?.fromDate;
const visitTime = event?.visit?.time || event?.appt?.apptTime || event?.appt?.fromTime;

if (!visitDate || !visitTime) {
  throw new Error('Visit date/time not found. Available fields: ' + Object.keys(event).join(', '));
}

// Handle date formats: DD/MM/YYYY or YYYY-MM-DD
let isoDate = visitDate;
if (visitDate.includes('/')) {
  const [day, month, year] = visitDate.split('/');
  isoDate = \`\${year}-\${month.padStart(2, '0')}-\${day.padStart(2, '0')}\`;
}

// Handle time formats: HH:mm AM/PM or HH:mm:ss
let time24 = visitTime;
if (visitTime.includes('AM') || visitTime.includes('PM')) {
  const isPM = visitTime.includes('PM');
  const timeOnly = visitTime.replace(/AM|PM/gi, '').trim();
  const [hours, minutes] = timeOnly.split(':').map(Number);
  const hours24 = isPM && hours !== 12 ? hours + 12 : !isPM && hours === 12 ? 0 : hours;
  time24 = \`\${String(hours24).padStart(2, '0')}:\${String(minutes).padStart(2, '0')}:00\`;
} else if (time24.split(':').length === 2) {
  time24 = \`\${time24}:00\`;
}

const visitDateTime = \`\${isoDate}T\${time24}+05:30\`;
const visitAt = parseDate(visitDateTime);

// Schedule 3 hours before
const reminderAt = subtractHours(visitAt, 3);
return toTimestamp(reminderAt);`,
    usageNote: 'Works with OP_VISIT_CREATED (visit.date/time) and APPOINTMENT events (appt.apptDate/time)'
  },
  {
    id: 'd-plus-5hrs',
    name: 'D+5hrs After Event',
    description: 'Send 5 hours after event occurred',
    mode: 'DELAYED',
    icon: <ThunderboltOutlined />,
    color: 'green',
    script: `// Send 5 hours after event timestamp
// Works with most events that have datetime or timestamp
const eventTime = event?.datetime || event?.arrivedAt || event?.createdAt || event?.timestamp;

if (!eventTime) {
  throw new Error('Event timestamp not found. Available fields: ' + Object.keys(event).join(', '));
}

// Handle datetime formats: DD/MM/YYYY HH:mm AM or ISO format
let isoDateTime = eventTime;
if (eventTime.includes('/')) {
  // Format: 05/02/2026 11:39 AM
  const parts = eventTime.split(' ');
  const [day, month, year] = parts[0].split('/');
  let time24 = parts[1];

  if (parts[2] === 'PM' || parts[2] === 'AM') {
    const isPM = parts[2] === 'PM';
    const [hours, minutes] = parts[1].split(':').map(Number);
    const hours24 = isPM && hours !== 12 ? hours + 12 : !isPM && hours === 12 ? 0 : hours;
    time24 = \`\${String(hours24).padStart(2, '0')}:\${String(minutes).padStart(2, '0')}:00\`;
  }

  isoDateTime = \`\${year}-\${month.padStart(2, '0')}-\${day.padStart(2, '0')}T\${time24}+05:30\`;
}

const eventDate = parseDate(isoDateTime);
const sendAt = addHours(eventDate, 5);
return toTimestamp(sendAt);`,
    usageNote: 'Works with most events - uses datetime, arrivedAt, createdAt, or timestamp field'
  },
  {
    id: 'daily-9am',
    name: 'Daily at 9 AM',
    description: 'Send every day at 9:00 AM IST',
    mode: 'RECURRING',
    icon: <CalendarOutlined />,
    color: 'purple',
    script: `// Send daily at 9:00 AM IST
const tomorrow = addDays(now(), 1);
const firstRun = new Date(tomorrow);
firstRun.setHours(9, 0, 0, 0);

return {
  firstOccurrence: toTimestamp(firstRun),
  intervalMs: 24 * 60 * 60 * 1000, // 24 hours
  maxOccurrences: 30 // Run for 30 days
};`,
    usageNote: 'Sends at 9 AM IST every day for 30 days'
  },
  {
    id: 'every-6hrs',
    name: 'Every 6 Hours',
    description: 'Send every 6 hours, max 10 times',
    mode: 'RECURRING',
    icon: <SyncOutlined />,
    color: 'cyan',
    script: `// Send every 6 hours
const firstTime = addHours(now(), 1); // Start in 1 hour

return {
  firstOccurrence: toTimestamp(firstTime),
  intervalMs: 6 * 60 * 60 * 1000, // 6 hours
  maxOccurrences: 10
};`,
    usageNote: 'Starts in 1 hour, repeats every 6 hours for 10 occurrences'
  },
  {
    id: 'weekly-monday',
    name: 'Weekly on Monday',
    description: 'Send every Monday at 10 AM IST',
    mode: 'RECURRING',
    icon: <CalendarOutlined />,
    color: 'magenta',
    script: `// Send every Monday at 10:00 AM IST
const today = now();
const dayOfWeek = today.getDay(); // 0 = Sunday, 1 = Monday
const daysUntilMonday = dayOfWeek === 0 ? 1 : dayOfWeek === 1 ? 7 : 8 - dayOfWeek;

const nextMonday = addDays(today, daysUntilMonday);
nextMonday.setHours(10, 0, 0, 0);

return {
  firstOccurrence: toTimestamp(nextMonday),
  intervalMs: 7 * 24 * 60 * 60 * 1000, // 7 days
  maxOccurrences: 12 // Run for ~3 months
};`,
    usageNote: 'Sends every Monday at 10 AM for 12 weeks'
  }
];

interface SchedulingTemplatesProps {
  deliveryMode: 'IMMEDIATE' | 'DELAYED' | 'RECURRING';
  onSelectTemplate: (script: string) => void;
}

/**
 * SchedulingTemplates - Quick access to common scheduling patterns
 *
 * Provides domain-specific templates for:
 * - Appointment reminders (D-24hrs, T-3hrs)
 * - Follow-up messages (D+5hrs)
 * - Recurring schedules (daily, weekly, hourly)
 */
export const SchedulingTemplates = ({ deliveryMode, onSelectTemplate }: SchedulingTemplatesProps) => {
  const { token, transitions } = useDesignTokens();
  const colors = cssVar.legacy;
  const [collapsed, setCollapsed] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Filter templates by delivery mode
  const templates = useMemo(() => TEMPLATES.filter(t => t.mode === deliveryMode), [deliveryMode]);

  useEffect(() => {
    if (selectedId && !templates.find(t => t.id === selectedId)) {
      setSelectedId(null);
    }
  }, [templates, selectedId]);

  const handleSelect = (template: SchedulingTemplate) => {
    setSelectedId(template.id);
    onSelectTemplate(template.script);
    setCollapsed(true);
  };

  return (
    <Card
      size="small"
      title={
        <Space>
          <CopyOutlined style={{ color: colors.info[500] }} />
          <span>Quick Templates</span>
        </Space>
      }
      extra={(
        <Button
          type="text"
          size="small"
          icon={collapsed ? <RightOutlined /> : <DownOutlined />}
          onClick={() => setCollapsed((prev) => !prev)}
        >
          {collapsed ? 'Show' : 'Hide'}
        </Button>
      )}
      style={{
        background: cssVar.bg.subtle,
        borderColor: cssVar.border.default
      }}
    >
      {collapsed ? (
        <Text type="secondary" style={{ fontSize: 12 }}>
          {templates.length} templates hidden. Click "Show" to expand.
        </Text>
      ) : (
        <>
      <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 12 }}>
        Click a template to use it as a starting point. You can customize it after insertion.
      </Text>

      <Row gutter={[12, 12]}>
        {templates.map(template => (
          <Col xs={24} sm={12} md={8} key={template.id}>
            <Tooltip title={template.usageNote}>
              <Card
                size="small"
                hoverable
                onClick={() => handleSelect(template)}
                style={{
                  cursor: 'pointer',
                  borderColor: selectedId === template.id ? colors.primary[500] : colors.neutral[700],
                  transition: transitions.all,
                  boxShadow: selectedId === template.id ? `0 0 0 1px ${withAlpha(colors.primary[500], 0.2)}` : 'none',
                  background: selectedId === template.id ? withAlpha(colors.primary[500], 0.06) : cssVar.bg.surface
                }}
                styles={{
                  body: { padding: 12 }
                }}
              >
                <Space direction="vertical" size={4} style={{ width: '100%' }}>
                  <Space>
                    <Tag color={template.color} icon={template.icon}>
                      {template.mode}
                    </Tag>
                  </Space>
                  <Text strong style={{ fontSize: 13 }}>
                    {template.name}
                  </Text>
                  <Text type="secondary" style={{ fontSize: 11 }}>
                    {template.description}
                  </Text>
                </Space>
              </Card>
            </Tooltip>
          </Col>
        ))}
      </Row>
        </>
      )}
    </Card>
  );
};
