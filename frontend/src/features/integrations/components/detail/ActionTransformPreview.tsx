import { useEffect, useState } from 'react';
import { Alert, Button, Collapse, Input, Typography } from 'antd';
import { ThunderboltOutlined } from '@ant-design/icons';
import type { FormInstance } from 'antd';

interface ActionTransformPreviewProps {
  actionIndex: number;
  form: FormInstance;
  selectedEventTypeData: any;
  colors: any;
  spacing: any;
  token: any;
}

export const ActionTransformPreview = ({
  actionIndex,
  form,
  selectedEventTypeData,
  colors,
  spacing,
  token
}: ActionTransformPreviewProps) => {
  const [sampleInput, setSampleInput] = useState('{}');
  const [output, setOutput] = useState('');
  const [isExpanded, setIsExpanded] = useState(false);

  // Auto-populate sample input when event type data changes
  useEffect(() => {
    if (selectedEventTypeData?.samplePayload && isExpanded) {
      setSampleInput(JSON.stringify(selectedEventTypeData.samplePayload, null, 2));
    }
  }, [selectedEventTypeData, isExpanded]);

  const runPreview = () => {
    try {
      const action = form.getFieldValue(['actions', actionIndex]);
      const mode = action?.transformationMode || 'SCRIPT';
      const payload = JSON.parse(sampleInput || '{}');
      const context = {
        eventType: form.getFieldValue('eventType') || 'TEST_EVENT',
        tenantId: 100,
        entityName: 'Test Entity'
      };

      let result;
      if (mode === 'SCRIPT') {
        const script = action?.transformation?.script;
        if (!script) {
          setOutput(JSON.stringify({ error: 'No script defined' }, null, 2));
          return;
        }
        const fn = new Function('payload', 'context', script);
        result = fn(payload, context);
      } else {
        // SIMPLE mode
        const mappings = action?.transformation?.mappings || [];
        const staticFields = action?.transformation?.staticFields || [];
        result = {};

        // Apply mappings
        mappings.forEach((mapping: any) => {
          if (mapping.targetField && mapping.sourceField) {
            const keys = mapping.sourceField.split('.');
            let value = payload;
            for (const key of keys) {
              value = value?.[key];
            }

            // Apply transform
            switch (mapping.transform) {
              case 'trim':
                value = typeof value === 'string' ? value.trim() : value;
                break;
              case 'upper':
                value = typeof value === 'string' ? value.toUpperCase() : value;
                break;
              case 'lower':
                value = typeof value === 'string' ? value.toLowerCase() : value;
                break;
            }

            result[mapping.targetField] = value;
          }
        });

        // Apply static fields
        staticFields.forEach((field: any) => {
          if (field.key) {
            result[field.key] = field.value;
          }
        });
      }

      setOutput(JSON.stringify(result, null, 2));
    } catch (err: any) {
      setOutput(JSON.stringify({ error: err.message }, null, 2));
    }
  };

  return (
    <Collapse
      ghost
      activeKey={isExpanded ? ['preview'] : []}
      onChange={(keys) => setIsExpanded(keys.includes('preview'))}
      items={[
        {
          key: 'preview',
          label: (
            <Typography.Text type="secondary">
              <ThunderboltOutlined /> Test Transformation
            </Typography.Text>
          ),
          children: (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: spacing[3] }}>
              <div>
                <Typography.Text strong style={{ display: 'block', marginBottom: spacing[1] }}>
                  Sample Input
                </Typography.Text>
                <Input.TextArea
                  value={sampleInput}
                  onChange={(e) => setSampleInput(e.target.value)}
                  rows={6}
                  placeholder='{"patientRID": 12345}'
                  style={{
                    fontFamily: 'monospace',
                    fontSize: 12,
                    background: colors.neutral[900],
                    color: colors.neutral[50]
                  }}
                />
              </div>
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: spacing[1] }}>
                  <Typography.Text strong>Output</Typography.Text>
                  <Button size="small" type="primary" onClick={runPreview} icon={<ThunderboltOutlined />}>
                    Run
                  </Button>
                </div>
                <Input.TextArea
                  value={output}
                  readOnly
                  rows={6}
                  placeholder="Click Run to preview"
                  style={{
                    fontFamily: 'monospace',
                    fontSize: 12,
                    background: colors.neutral[900],
                    color: colors.neutral[50]
                  }}
                />
              </div>
            </div>
          )
        }
      ]}
    />
  );
};
