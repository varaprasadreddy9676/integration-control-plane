import { useState, useMemo, useEffect } from 'react';
import { Card, Radio, TimePicker, Space, Tag, Button, Input, Typography, Select, Divider } from 'antd';
import {
  ClockCircleOutlined,
  ThunderboltOutlined,
  CopyOutlined,
  CheckOutlined,
  CodeOutlined,
  GlobalOutlined,
  CalendarOutlined
} from '@ant-design/icons';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
import { useDesignTokens, cssVar } from '../../../design-system/utils';

dayjs.extend(utc);
dayjs.extend(timezone);

const { Text } = Typography;

const DAYS = [
  { id: '0', short: 'Sun', long: 'Sunday' },
  { id: '1', short: 'Mon', long: 'Monday' },
  { id: '2', short: 'Tue', long: 'Tuesday' },
  { id: '3', short: 'Wed', long: 'Wednesday' },
  { id: '4', short: 'Thu', long: 'Thursday' },
  { id: '5', short: 'Fri', long: 'Friday' },
  { id: '6', short: 'Sat', long: 'Saturday' }
];

const QUICK_PRESETS = [
  { label: 'Every hour', value: '0 * * * *', freq: 'hourly' },
  { label: 'Every day at 9 AM', value: '0 9 * * *', freq: 'daily' },
  { label: 'Every weekday at 9 AM', value: '0 9 * * 1-5', freq: 'weekly' },
  { label: 'Every Monday at 9 AM', value: '0 9 * * 1', freq: 'weekly' },
  { label: 'First day of month at 9 AM', value: '0 9 1 * *', freq: 'monthly' }
];

const cronToEnglish = (expression: string): string => {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) return "Invalid expression (requires 5 parts)";

  const [min, hour, dom, month, dow] = parts;

  // Common patterns
  if (hour === '*' && dom === '*' && month === '*' && dow === '*' && !min.includes('/')) {
    return `Every hour at :${min.padStart(2, '0')}`;
  }
  if (min === '0' && hour === '0' && dom === '*' && month === '*' && dow === '*') return "Every day at midnight";
  if (min === '*' && hour === '*' && dom === '*' && month === '*' && dow === '*') return "Every minute";

  // Build readable description
  let description = "";

  if (min !== '*' && hour !== '*' && !min.includes('/') && !hour.includes('/')) {
    description = `At ${hour.padStart(2, '0')}:${min.padStart(2, '0')}`;
  } else if (min === '0' && hour.includes('/')) {
    description = `Every ${hour.split('/')[1]} hours`;
  } else if (hour === '*' && min.includes('/')) {
    description = `Every ${min.split('/')[1]} minutes`;
  } else {
    description = `At minute ${min} of hour ${hour}`;
  }

  // Add day/month context
  if (dow !== '*' && dow.includes(',')) {
    const dayNames = dow.split(',').map(d => DAYS.find(day => day.id === d)?.long).filter(Boolean);
    description += ` on ${dayNames.join(', ')}`;
  } else if (dow !== '*' && dow.includes('-')) {
    const [start, end] = dow.split('-');
    const startDay = DAYS.find(d => d.id === start)?.long;
    const endDay = DAYS.find(d => d.id === end)?.long;
    description += ` on ${startDay} through ${endDay}`;
  } else if (dow !== '*') {
    const dayName = DAYS.find(d => d.id === dow)?.long;
    description += ` on ${dayName}`;
  }

  if (dom !== '*' && month === '*') {
    description += ` on day ${dom} of every month`;
  }

  return description;
};

// Calculate next 5 execution times based on cron expression
const getNextExecutions = (cronExpression: string, tz: string): dayjs.Dayjs[] => {
  const executions: dayjs.Dayjs[] = [];
  const parts = cronExpression.trim().split(/\s+/);
  if (parts.length !== 5) return executions;

  const [min, hour, dom, month, dow] = parts;

  // Simple implementation for common patterns
  let currentTime = dayjs().tz(tz);

  for (let i = 0; i < 100 && executions.length < 5; i++) {
    const checkTime = currentTime.add(i, 'hour');

    // Check if this time matches the cron expression
    const matchesMinute = min === '*' || parseInt(min) === checkTime.minute();
    const matchesHour = hour === '*' || parseInt(hour) === checkTime.hour();
    const matchesDOM = dom === '*' || parseInt(dom) === checkTime.date();
    const matchesMonth = month === '*' || parseInt(month) === checkTime.month() + 1;
    const matchesDOW = dow === '*' ||
                       dow.split(',').includes(String(checkTime.day())) ||
                       (dow.includes('-') && checkTime.day() >= parseInt(dow.split('-')[0]) && checkTime.day() <= parseInt(dow.split('-')[1]));

    if (matchesMinute && matchesHour && matchesDOM && matchesMonth && matchesDOW) {
      executions.push(checkTime);
    }
  }

  return executions.slice(0, 5);
};

interface CronBuilderProps {
  value?: string;
  timezone?: string;
  onChange?: (cron: string) => void;
  onTimezoneChange?: (timezone: string) => void;
}

export const CronBuilder = ({ value, timezone = 'UTC', onChange, onTimezoneChange }: CronBuilderProps) => {
  const { spacing, token } = useDesignTokens();
  const colors = cssVar.legacy;
  const [frequency, setFrequency] = useState<'hourly' | 'daily' | 'weekly' | 'monthly'>('daily');
  const [time, setTime] = useState(dayjs().hour(9).minute(0));
  const [selectedDays, setSelectedDays] = useState<string[]>(['1', '2', '3', '4', '5']); // Mon-Fri
  const [isAdvanced, setIsAdvanced] = useState(false);
  const [advancedCron, setAdvancedCron] = useState(value || '0 9 * * *');
  const [copied, setCopied] = useState(false);

  // Update advanced cron when value prop changes
  useEffect(() => {
    if (value && value !== cronExpression && !isAdvanced) {
      setIsAdvanced(true);
      setAdvancedCron(value);
    }
  }, [value]);

  const cronExpression = useMemo(() => {
    if (isAdvanced) return advancedCron;

    const hour = time.hour();
    const minute = time.minute();

    if (frequency === 'hourly') return `${minute} * * * *`; // Run at specified minute of every hour
    if (frequency === 'daily') return `${minute} ${hour} * * *`;
    if (frequency === 'weekly') {
      if (selectedDays.length === 0) return `${minute} ${hour} * * *`;
      return `${minute} ${hour} * * ${selectedDays.sort((a, b) => parseInt(a) - parseInt(b)).join(',')}`;
    }
    return `${minute} ${hour} 1 * *`; // Monthly on 1st
  }, [frequency, time, selectedDays, isAdvanced, advancedCron]);

  const interpretation = useMemo(() => {
    try {
      return cronToEnglish(isAdvanced ? advancedCron : cronExpression);
    } catch {
      return "Invalid cron expression";
    }
  }, [cronExpression, isAdvanced, advancedCron]);

  const nextExecutions = useMemo(() => {
    try {
      return getNextExecutions(isAdvanced ? advancedCron : cronExpression, timezone);
    } catch {
      return [];
    }
  }, [cronExpression, isAdvanced, advancedCron, timezone]);

  const handleCopy = () => {
    navigator.clipboard.writeText(cronExpression);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handlePresetSelect = (cronValue: string) => {
    setIsAdvanced(true);
    setAdvancedCron(cronValue);
    onChange?.(cronValue);
  };

  useMemo(() => {
    onChange?.(cronExpression);
  }, [cronExpression]);

  const panelStyle = {
    borderRadius: token.borderRadiusLG,
    border: `1px solid ${cssVar.border.default}`,
    background: cssVar.bg.surface
  };

  return (
    <Card style={panelStyle} bodyStyle={{ padding: spacing[4] }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing[4] }}>
        <Space>
          <ThunderboltOutlined style={{ fontSize: 20, color: colors.primary[600] }} />
          <div>
            <Text strong style={{ display: 'block', fontSize: 16 }}>Schedule Configuration</Text>
            <Text type="secondary" style={{ fontSize: 12 }}>Configure when this job should run</Text>
          </div>
        </Space>
        <Button
          size="small"
          onClick={() => setIsAdvanced(!isAdvanced)}
          icon={<CodeOutlined />}
        >
          {isAdvanced ? 'Use Builder' : 'Advanced'}
        </Button>
      </div>

      <Divider style={{ margin: `${spacing[3]} 0` }} />

      {/* Quick Presets */}
      {!isAdvanced && (
        <div style={{ marginBottom: spacing[4] }}>
          <Text type="secondary" style={{ fontSize: 12, fontWeight: 600, marginBottom: spacing[2], display: 'block' }}>
            Quick Presets
          </Text>
          <Space size="small" wrap>
            {QUICK_PRESETS.map((preset) => (
              <Tag
                key={preset.value}
                style={{
                  cursor: 'pointer',
                  borderColor: cssVar.border.default,
                  background: cssVar.bg.elevated,
                  padding: `${spacing[1]} ${spacing[2]}`
                }}
                onClick={() => handlePresetSelect(preset.value)}
              >
                {preset.label}
              </Tag>
            ))}
          </Space>
        </div>
      )}

      {!isAdvanced ? (
        <Space direction="vertical" size="large" style={{ width: '100%' }}>
          {/* Frequency Selector */}
          <div>
            <Text type="secondary" style={{ fontSize: 12, fontWeight: 600, marginBottom: spacing[2], display: 'block' }}>
              Frequency
            </Text>
            <Radio.Group
              value={frequency}
              onChange={(e) => setFrequency(e.target.value)}
              buttonStyle="solid"
              style={{ width: '100%' }}
            >
              <Radio.Button value="hourly" style={{ width: '25%', textAlign: 'center' }}>
                <ClockCircleOutlined /> Hourly
              </Radio.Button>
              <Radio.Button value="daily" style={{ width: '25%', textAlign: 'center' }}>
                <CalendarOutlined /> Daily
              </Radio.Button>
              <Radio.Button value="weekly" style={{ width: '25%', textAlign: 'center' }}>
                <CalendarOutlined /> Weekly
              </Radio.Button>
              <Radio.Button value="monthly" style={{ width: '25%', textAlign: 'center' }}>
                <CalendarOutlined /> Monthly
              </Radio.Button>
            </Radio.Group>
          </div>

          {/* Time & Timezone Grid */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: spacing[3] }}>
            <div>
              <Text type="secondary" style={{ fontSize: 12, fontWeight: 600, marginBottom: spacing[2], display: 'block' }}>
                {frequency === 'hourly' ? 'Minute Past Hour' : 'Execution Time'}
              </Text>
              <TimePicker
                value={time}
                onChange={(t) => t && setTime(t)}
                format={frequency === 'hourly' ? 'mm' : 'HH:mm'}
                size="large"
                showNow={false}
                style={{ width: '100%' }}
                suffixIcon={<ClockCircleOutlined />}
                placeholder={frequency === 'hourly' ? 'Select minute (0-59)' : 'Select time'}
              />
            </div>
            <div>
              <Text type="secondary" style={{ fontSize: 12, fontWeight: 600, marginBottom: spacing[2], display: 'block' }}>
                Timezone
              </Text>
              <Select
                value={timezone}
                onChange={onTimezoneChange}
                size="large"
                style={{ width: '100%' }}
                suffixIcon={<GlobalOutlined />}
                options={[
                  { value: 'UTC', label: 'UTC' },
                  { value: 'America/New_York', label: 'America/New York (EST)' },
                  { value: 'America/Los_Angeles', label: 'America/Los Angeles (PST)' },
                  { value: 'Europe/London', label: 'Europe/London (GMT)' },
                  { value: 'Asia/Kolkata', label: 'Asia/Kolkata (IST)' },
                  { value: 'Asia/Tokyo', label: 'Asia/Tokyo (JST)' }
                ]}
              />
            </div>
          </div>

          {/* Weekly Day Selector */}
          {frequency === 'weekly' && (
            <div>
              <Text type="secondary" style={{ fontSize: 12, fontWeight: 600, marginBottom: spacing[2], display: 'block' }}>
                Days of Week
              </Text>
              <div
                style={{
                  display: 'flex',
                  gap: spacing[2],
                  flexWrap: 'wrap'
                }}
              >
                {DAYS.map((day) => {
                  const isSelected = selectedDays.includes(day.id);
                  return (
                    <Button
                      key={day.id}
                      type={isSelected ? 'primary' : 'default'}
                      onClick={() => {
                        setSelectedDays(prev =>
                          prev.includes(day.id)
                            ? prev.filter(d => d !== day.id)
                            : [...prev, day.id]
                        );
                      }}
                      style={{ flex: 1, minWidth: 80 }}
                    >
                      {day.short}
                    </Button>
                  );
                })}
              </div>
            </div>
          )}
        </Space>
      ) : (
        <div>
          <Text type="secondary" style={{ fontSize: 12, fontWeight: 600, marginBottom: spacing[2], display: 'block' }}>
            Cron Expression
          </Text>
          <Input
            value={advancedCron}
            onChange={(e) => {
              setAdvancedCron(e.target.value);
              onChange?.(e.target.value);
            }}
            prefix={<CodeOutlined style={{ color: colors.primary[500] }} />}
            size="large"
            style={{ fontFamily: 'monospace', fontSize: 14 }}
            placeholder="0 9 * * *"
          />
          <Text type="secondary" style={{ fontSize: 11, marginTop: spacing[1], display: 'block' }}>
            Format: minute hour day-of-month month day-of-week
          </Text>
        </div>
      )}

      <Divider style={{ margin: `${spacing[4]} 0` }} />

      {/* Interpretation */}
      <div
        style={{
          padding: spacing[3],
          borderRadius: token.borderRadius,
          background: cssVar.info.bg,
          border: `1px solid ${cssVar.info.border}`,
          marginBottom: spacing[4]
        }}
      >
        <Space align="start">
          <ClockCircleOutlined style={{ color: colors.info[600], marginTop: 2 }} />
          <div>
            <Text type="secondary" style={{ fontSize: 11, display: 'block' }}>
              This job will run:
            </Text>
            <Text strong style={{ fontSize: 14, color: cssVar.text.primary }}>{interpretation}</Text>
          </div>
        </Space>
      </div>

      {/* Cron Expression Output */}
      <div
        style={{
          padding: spacing[3],
          background: cssVar.bg.overlay,
          border: `1px solid ${cssVar.border.default}`,
          borderRadius: token.borderRadius,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: spacing[4]
        }}
      >
        <div style={{ flex: 1 }}>
          <Text type="secondary" style={{ fontSize: 11, display: 'block', marginBottom: spacing[1] }}>
            Cron Expression
          </Text>
          <Text strong style={{ fontSize: 16, fontFamily: 'monospace', letterSpacing: '1px' }}>
            {cronExpression}
          </Text>
        </div>
        <Button
          type={copied ? 'primary' : 'default'}
          icon={copied ? <CheckOutlined /> : <CopyOutlined />}
          onClick={handleCopy}
        >
          {copied ? 'Copied' : 'Copy'}
        </Button>
      </div>

      {/* Next Executions Preview */}
      <div>
        <Text type="secondary" style={{ fontSize: 12, fontWeight: 600, marginBottom: spacing[2], display: 'block' }}>
          Next 5 Scheduled Executions
        </Text>
        <Space direction="vertical" size="small" style={{ width: '100%' }}>
          {nextExecutions.length > 0 ? (
            nextExecutions.map((exec, i) => (
              <div
                key={i}
                style={{
                  padding: `${spacing[2]} ${spacing[3]}`,
                  background: cssVar.bg.elevated,
                  border: `1px solid ${cssVar.border.default}`,
                  borderRadius: token.borderRadius,
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center'
                }}
              >
                <Space>
                  <Tag color={i === 0 ? 'blue' : 'default'} style={{ margin: 0 }}>
                    {i + 1}
                  </Tag>
                  <Text style={{ fontSize: 13 }}>
                    {exec.format('ddd, MMM D, YYYY')}
                  </Text>
                </Space>
                <Text strong style={{ fontSize: 13, fontFamily: 'monospace' }}>
                  {exec.format('HH:mm:ss')} {timezone}
                </Text>
              </div>
            ))
          ) : (
            <div
              style={{
                padding: spacing[3],
                background: cssVar.warning.bg,
                border: `1px solid ${cssVar.warning.border}`,
                borderRadius: token.borderRadius,
                textAlign: 'center'
              }}
            >
              <Text style={{ color: cssVar.warning.text }}>Unable to calculate next executions. Please verify your cron expression.</Text>
            </div>
          )}
        </Space>
      </div>
    </Card>
  );
};
