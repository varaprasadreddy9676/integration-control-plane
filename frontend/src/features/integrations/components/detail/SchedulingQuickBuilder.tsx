import { useEffect, useMemo, useState } from 'react';
import { Card, Space, Typography, Segmented, InputNumber, Select, DatePicker, TimePicker, Button, Tag, App } from 'antd';
import type { Dayjs } from 'dayjs';
import dayjs from 'dayjs';
import {
  ClockCircleOutlined,
  CalendarOutlined,
  ThunderboltOutlined
} from '@ant-design/icons';
import { useDesignTokens, withAlpha, cssVar } from '../../../../design-system/utils';

const { Text } = Typography;

type DeliveryMode = 'IMMEDIATE' | 'DELAYED' | 'RECURRING';
type QuickMode = 'IN_NEXT' | 'IN_LAST' | 'ON' | 'BEFORE' | 'AFTER' | 'BETWEEN';

const timezoneOffsets: Record<string, string> = {
  'Asia/Kolkata': '+05:30',
  'UTC': '+00:00',
  'America/New_York': '-05:00',
  'Europe/London': '+00:00',
  'America/Los_Angeles': '-08:00',
  'Asia/Tokyo': '+09:00',
  'Australia/Sydney': '+10:00'
};

const unitOptions = [
  { label: 'Minutes', value: 'minutes' },
  { label: 'Hours', value: 'hours' },
  { label: 'Days', value: 'days' }
];

const intervalMsByUnit: Record<string, number> = {
  minutes: 60 * 1000,
  hours: 60 * 60 * 1000,
  days: 24 * 60 * 60 * 1000
};

const unitHelpers: Record<string, { add: string; sub: string }> = {
  minutes: { add: 'addMinutes', sub: 'subtractMinutes' },
  hours: { add: 'addHours', sub: 'subtractHours' },
  days: { add: 'addDays', sub: 'subtractDays' }
};

interface SchedulingQuickBuilderProps {
  deliveryMode: DeliveryMode;
  timezone?: string;
  currentScript?: string;
  onApplyScript: (script: string, label: string) => void;
}

export const SchedulingQuickBuilder = ({
  deliveryMode,
  timezone,
  currentScript,
  onApplyScript
}: SchedulingQuickBuilderProps) => {
  const { token, spacing } = useDesignTokens();
  const colors = cssVar.legacy;
  const { message } = App.useApp();

  const [mode, setMode] = useState<QuickMode>('IN_NEXT');
  const [amount, setAmount] = useState(3);
  const [unit, setUnit] = useState('hours');
  const [targetDate, setTargetDate] = useState<Dayjs | null>(dayjs().add(1, 'day'));
  const [targetTime, setTargetTime] = useState<Dayjs | null>(dayjs().minute(0).second(0));
  const [offsetAmount, setOffsetAmount] = useState(1);
  const [offsetUnit, setOffsetUnit] = useState('hours');
  const [rangeStart, setRangeStart] = useState<Dayjs | null>(dayjs().add(1, 'day'));
  const [rangeEnd, setRangeEnd] = useState<Dayjs | null>(dayjs().add(7, 'day'));
  const [rangeTime, setRangeTime] = useState<Dayjs | null>(dayjs().minute(0).second(0));
  const [intervalAmount, setIntervalAmount] = useState(6);
  const [intervalUnit, setIntervalUnit] = useState('hours');
  const [lastGenerated, setLastGenerated] = useState<string | null>(null);

  const availableModes = useMemo(() => {
    if (deliveryMode === 'RECURRING') {
      return ['BETWEEN'] as QuickMode[];
    }
    if (deliveryMode === 'DELAYED') {
      return ['IN_NEXT', 'IN_LAST', 'ON', 'BEFORE', 'AFTER'] as QuickMode[];
    }
    return [] as QuickMode[];
  }, [deliveryMode]);

  useEffect(() => {
    if (!availableModes.includes(mode)) {
      setMode(availableModes[0]);
    }
  }, [availableModes, mode]);

  if (deliveryMode === 'IMMEDIATE') {
    return null;
  }

  const tzOffset = timezoneOffsets[timezone || ''] || '+00:00';

  const formatDateTime = (date: Dayjs | null, time: Dayjs | null) => {
    const datePart = (date || dayjs()).format('YYYY-MM-DD');
    const timePart = (time || dayjs()).format('HH:mm:ss');
    return `${datePart}T${timePart}${tzOffset}`;
  };

  const buildDelayedScript = () => {
    const helper = unitHelpers[unit];
    const offsetHelper = unitHelpers[offsetUnit];
    if (!helper || !offsetHelper) return null;

    if (mode === 'IN_NEXT' || mode === 'IN_LAST') {
      const fn = mode === 'IN_NEXT' ? helper.add : helper.sub;
      return `// Quick schedule: ${mode === 'IN_NEXT' ? 'in the next' : 'in the last'} ${amount} ${unit}
const base = now();
const scheduled = ${fn}(base, ${amount});
return toTimestamp(scheduled);`;
    }

    if (mode === 'ON') {
      const targetIso = formatDateTime(targetDate, targetTime);
      return `// Quick schedule: on ${targetIso}
const target = parseDate('${targetIso}');
return toTimestamp(target);`;
    }

    if (mode === 'BEFORE' || mode === 'AFTER') {
      const targetIso = formatDateTime(targetDate, targetTime);
      const fn = mode === 'BEFORE' ? offsetHelper.sub : offsetHelper.add;
      return `// Quick schedule: ${mode === 'BEFORE' ? 'before' : 'after'} ${targetIso}
const target = parseDate('${targetIso}');
const scheduled = ${fn}(target, ${offsetAmount});
return toTimestamp(scheduled);`;
    }

    return null;
  };

  const buildRecurringScript = () => {
    const intervalMs = intervalMsByUnit[intervalUnit] * Math.max(1, intervalAmount);
    const startIso = formatDateTime(rangeStart, rangeTime);
    const endIso = formatDateTime(rangeEnd, rangeTime);

    return `// Quick schedule: recurring between ${startIso} and ${endIso}
const start = parseDate('${startIso}');
const end = parseDate('${endIso}');
return {
  firstOccurrence: toTimestamp(start),
  intervalMs: ${intervalMs},
  endDate: toTimestamp(end)
};`;
  };

  const handleApply = () => {
    if (!availableModes.length) return;

    if (deliveryMode === 'RECURRING') {
      if (!rangeStart || !rangeEnd) {
        message.error('Select a start and end date.');
        return;
      }
      if (rangeEnd.isBefore(rangeStart)) {
        message.error('End date must be after start date.');
        return;
      }
      const script = buildRecurringScript();
      if (!script) return;
      setLastGenerated(script);
      onApplyScript(script, 'Quick schedule');
      return;
    }

    if (!targetDate && (mode === 'ON' || mode === 'BEFORE' || mode === 'AFTER')) {
      message.error('Select a target date.');
      return;
    }
    if ((mode === 'IN_NEXT' || mode === 'IN_LAST') && (!amount || amount <= 0)) {
      message.error('Enter a valid amount.');
      return;
    }
    if ((mode === 'BEFORE' || mode === 'AFTER') && (!offsetAmount || offsetAmount <= 0)) {
      message.error('Enter a valid offset.');
      return;
    }

    const script = buildDelayedScript();
    if (!script) return;
    setLastGenerated(script);
    onApplyScript(script, 'Quick schedule');
  };

  const isCustom = !!currentScript && !!lastGenerated && currentScript.trim() !== lastGenerated.trim();

  return (
    <Card
      size="small"
      title={
        <Space>
          <ThunderboltOutlined style={{ color: colors.primary[500] }} />
          <span>Quick Scheduler</span>
        </Space>
      }
      extra={isCustom ? <Tag color="purple">Custom Script</Tag> : null}
      style={{
        background: cssVar.bg.subtle,
        borderColor: cssVar.border.default
      }}
      styles={{ body: { padding: spacing[3] } }}
    >
      <Space direction="vertical" size="small" style={{ width: '100%' }}>
        <Space wrap size="small" style={{ width: '100%', justifyContent: 'space-between' }}>
          <Segmented
            value={mode}
            onChange={(value) => setMode(value as QuickMode)}
            options={availableModes.map((item) => ({
              label: item === 'IN_NEXT'
                ? 'In The Next'
                : item === 'IN_LAST'
                ? 'In The Last'
                : item === 'ON'
                ? 'On'
                : item === 'BEFORE'
                ? 'Before'
                : item === 'AFTER'
                ? 'After'
                : 'Between',
              value: item
            }))}
          />
          <Space size={6}>
            <Text type="secondary" style={{ fontSize: 12 }}>Timezone</Text>
            <Tag color="blue">{timezone || 'UTC'}</Tag>
          </Space>
        </Space>

        {deliveryMode === 'DELAYED' && (mode === 'IN_NEXT' || mode === 'IN_LAST') && (
          <Space wrap size="small">
            <InputNumber min={1} value={amount} onChange={(value) => setAmount(Number(value || 1))} />
            <Select value={unit} onChange={setUnit} options={unitOptions} style={{ minWidth: 120 }} />
            <Text type="secondary" style={{ fontSize: 12 }}>
              {mode === 'IN_NEXT' ? 'from now' : 'before now (overdue)'}
            </Text>
          </Space>
        )}

        {deliveryMode === 'DELAYED' && (mode === 'ON' || mode === 'BEFORE' || mode === 'AFTER') && (
          <Space wrap size="small">
            <DatePicker value={targetDate} onChange={setTargetDate} />
            <TimePicker value={targetTime} onChange={setTargetTime} format="HH:mm" />
            {(mode === 'BEFORE' || mode === 'AFTER') && (
              <Space size={6}>
                <Text type="secondary" style={{ fontSize: 12 }}>Offset</Text>
                <InputNumber min={1} value={offsetAmount} onChange={(value) => setOffsetAmount(Number(value || 1))} />
                <Select value={offsetUnit} onChange={setOffsetUnit} options={unitOptions} style={{ minWidth: 120 }} />
              </Space>
            )}
          </Space>
        )}

        {deliveryMode === 'RECURRING' && mode === 'BETWEEN' && (
          <Space direction="vertical" size="small" style={{ width: '100%' }}>
            <Space wrap size="small">
              <DatePicker value={rangeStart} onChange={setRangeStart} placeholder="Start date" />
              <DatePicker value={rangeEnd} onChange={setRangeEnd} placeholder="End date" />
              <TimePicker value={rangeTime} onChange={setRangeTime} format="HH:mm" />
            </Space>
            <Space wrap size="small">
              <Text type="secondary" style={{ fontSize: 12 }}>Interval</Text>
              <InputNumber min={1} value={intervalAmount} onChange={(value) => setIntervalAmount(Number(value || 1))} />
              <Select value={intervalUnit} onChange={setIntervalUnit} options={unitOptions} style={{ minWidth: 120 }} />
            </Space>
          </Space>
        )}

        <Space style={{ width: '100%', justifyContent: 'space-between' }}>
          <Text type="secondary" style={{ fontSize: 12 }}>
            Uses standard timezone offsets (DST not applied). Double-check if DST matters.
          </Text>
          <Button type="primary" icon={<ClockCircleOutlined />} onClick={handleApply}>
            Apply to Script
          </Button>
        </Space>

        <div
          style={{
            borderRadius: token.borderRadius,
            padding: `${spacing[2]} ${spacing[3]}`,
            background: withAlpha(colors.primary[500], 0.08),
            border: `1px dashed ${withAlpha(colors.primary[500], 0.3)}`
          }}
        >
          <Space size={6}>
            <CalendarOutlined style={{ color: colors.primary[500] }} />
            <Text style={{ fontSize: 12 }}>
              This will generate a scheduling script you can still edit manually.
            </Text>
          </Space>
        </div>
      </Space>
    </Card>
  );
};
