import { useState, useEffect } from 'react';
import { Alert, Button, Space, Typography } from 'antd';
import { CheckCircleOutlined, WarningOutlined, CopyOutlined, DownloadOutlined } from '@ant-design/icons';
import Editor from '@monaco-editor/react';
import { cssVar } from '../../../design-system/utils';

const { Text } = Typography;

interface RawJsonEditorProps {
  value: string;
  onChange: (value: string) => void;
  onApply: (parsedJson: any) => void;
  readOnly?: boolean;
  height?: string;
  spacing?: Record<string, string>;
  colors?: any;
}

export const RawJsonEditor = ({
  value,
  onChange,
  onApply,
  readOnly = false,
  height = '600px',
  spacing = { 1: '4px', 2: '8px', 3: '12px' },
  colors = { neutrals: { 50: cssVar.bg.base, 200: cssVar.border.default } }
}: RawJsonEditorProps) => {
  const [localValue, setLocalValue] = useState(value);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [hasChanges, setHasChanges] = useState(false);

  // Sync external value to local state when prop changes
  useEffect(() => {
    setLocalValue(value);
    setHasChanges(false);
    validateJson(value);
  }, [value]);

  const validateJson = (jsonStr: string): boolean => {
    try {
      JSON.parse(jsonStr);
      setValidationError(null);
      return true;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Invalid JSON';
      setValidationError(errorMessage);
      return false;
    }
  };

  const handleEditorChange = (newValue: string | undefined) => {
    if (newValue === undefined) return;

    setLocalValue(newValue);
    setHasChanges(newValue !== value);
    validateJson(newValue);
    onChange(newValue);
  };

  const handleApplyChanges = () => {
    if (validationError) {
      return;
    }

    try {
      const parsed = JSON.parse(localValue);
      onApply(parsed);
      setHasChanges(false);
    } catch (error) {
      setValidationError(error instanceof Error ? error.message : 'Failed to parse JSON');
    }
  };

  const handleDiscardChanges = () => {
    setLocalValue(value);
    setHasChanges(false);
    validateJson(value);
  };

  const handleCopyToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(localValue);
    } catch (error) {
      console.error('Failed to copy to clipboard:', error);
    }
  };

  const handleDownload = () => {
    try {
      const parsed = JSON.parse(localValue);
      const blob = new Blob([JSON.stringify(parsed, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `integration-config-${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Failed to download:', error);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: spacing?.[3] || '12px' }}>
      {/* Validation Status */}
      {validationError ? (
        <Alert
          type="error"
          message="Invalid JSON"
          description={validationError}
          icon={<WarningOutlined />}
          showIcon
        />
      ) : (
        <Alert
          type="success"
          message="Valid JSON"
          description={
            hasChanges
              ? 'JSON is valid. Click "Apply Changes" to update the form.'
              : 'JSON structure is valid and synced with the form.'
          }
          icon={<CheckCircleOutlined />}
          showIcon
        />
      )}

      {/* Actions Bar */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: spacing[2] || '8px',
          backgroundColor: colors?.neutrals?.[50] || cssVar.bg.base,
          borderRadius: spacing[1] || '4px',
        }}
      >
        <Space>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {readOnly ? 'Read-only mode' : 'Edit the JSON directly or paste from a file'}
          </Text>
        </Space>
        <Space>
          <Button
            size="small"
            icon={<CopyOutlined />}
            onClick={handleCopyToClipboard}
          >
            Copy
          </Button>
          <Button
            size="small"
            icon={<DownloadOutlined />}
            onClick={handleDownload}
            disabled={!!validationError}
          >
            Download
          </Button>
          {hasChanges && !readOnly && (
            <>
              <Button size="small" onClick={handleDiscardChanges}>
                Discard
              </Button>
              <Button
                type="primary"
                size="small"
                onClick={handleApplyChanges}
                disabled={!!validationError}
              >
                Apply Changes
              </Button>
            </>
          )}
        </Space>
      </div>

      {/* Monaco Editor */}
      <div
        style={{
          border: `1px solid ${colors?.neutrals?.[200] || cssVar.border.default}`,
          borderRadius: spacing[1] || '4px',
          overflow: 'hidden',
        }}
      >
        <Editor
          height={height}
          defaultLanguage="json"
          value={localValue}
          onChange={handleEditorChange}
          theme="vs-light"
          options={{
            readOnly,
            minimap: { enabled: true },
            scrollBeyondLastLine: false,
            fontSize: 13,
            lineNumbers: 'on',
            folding: true,
            formatOnPaste: true,
            formatOnType: true,
            autoIndent: 'full',
            tabSize: 2,
            insertSpaces: true,
            wordWrap: 'on',
            wrappingIndent: 'indent',
          }}
        />
      </div>

      {/* Help Text */}
      {!readOnly && (
        <Alert
          type="info"
          message="How to use"
          description={
            <ul style={{ margin: 0, paddingLeft: spacing?.[3] || '12px' }}>
              <li>Edit JSON directly in the editor above</li>
              <li>Copy/paste from external files (like clevertap-integration-config-updated.json)</li>
              <li>Click "Apply Changes" to update the form fields</li>
              <li>Use "Download" to save the current configuration to a file</li>
            </ul>
          }
          showIcon
        />
      )}
    </div>
  );
};
