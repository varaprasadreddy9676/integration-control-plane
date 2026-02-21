import { useState } from 'react';
import { Modal, Upload, Button, Progress, Alert, Space, Tabs, Input, message, Checkbox } from 'antd';
import { UploadOutlined, DownloadOutlined } from '@ant-design/icons';
import type { UploadFile } from 'antd/es/upload/interface';
import { bulkImportEvents, bulkImportEventsJSON, downloadImportTemplate } from '../../../services/api';

interface ImportResult {
  success: boolean;
  summary: {
    total: number;
    successful: number;
    failed: number;
    duplicates: number;
  };
  results: {
    successful: Array<{
      index: number;
      eventId?: string;
      eventType: string;
      status: string;
    }>;
    failed: Array<{
      index: number;
      eventType: string;
      error: string;
      code: string;
    }>;
    duplicates: Array<{
      index: number;
      eventType: string;
      error: string;
      code: string;
    }>;
  };
  parseErrors?: Array<{
    row: number;
    error: string;
  }>;
}

interface BulkImportModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export const BulkImportModal = ({ open, onClose, onSuccess }: BulkImportModalProps) => {
  const [fileList, setFileList] = useState<UploadFile[]>([]);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [importMode, setImportMode] = useState<'file' | 'json'>('file');
  const [jsonInput, setJsonInput] = useState('');
  const [dryRun, setDryRun] = useState(false);
  const [continueOnError, setContinueOnError] = useState(true);

  const handleImport = async (validateOnly: boolean) => {
    setImporting(true);
    setResult(null);

    try {
      let data: ImportResult;

      if (importMode === 'file') {
        if (fileList.length === 0) {
          message.error('Please select a file to import');
          setImporting(false);
          return;
        }

        data = await bulkImportEvents(
          fileList[0].originFileObj as File,
          validateOnly,
          continueOnError
        );
      } else {
        if (!jsonInput.trim()) {
          message.error('Please enter JSON data to import');
          setImporting(false);
          return;
        }

        try {
          const parsedData = JSON.parse(jsonInput);
          const events = Array.isArray(parsedData) ? parsedData : parsedData.events;

          if (!events || !Array.isArray(events)) {
            message.error('JSON must contain an "events" array or be an array');
            setImporting(false);
            return;
          }

          data = await bulkImportEventsJSON(events, validateOnly, continueOnError);
        } catch (error: any) {
          message.error('Invalid JSON: ' + error.message);
          setImporting(false);
          return;
        }
      }

      setResult(data);

      if (data.success && !validateOnly) {
        message.success(`Successfully imported ${data.summary.successful} events`);
        setTimeout(() => {
          onSuccess();
          handleClose();
        }, 2000);
      } else if (validateOnly) {
        if (data.summary.failed === 0) {
          message.success(`Validation complete. All ${data.summary.total} events are valid.`);
        } else {
          message.warning(`Validation complete. ${data.summary.failed} events have errors.`);
        }
      } else if (data.summary.failed > 0) {
        message.warning(
          `Partial import: ${data.summary.successful} successful, ${data.summary.failed} failed, ${data.summary.duplicates} duplicates`
        );
      }
    } catch (error: any) {
      message.error('Import failed: ' + (error.message || 'Unknown error'));
      console.error('Import error:', error);
    } finally {
      setImporting(false);
    }
  };

  const handleClose = () => {
    setFileList([]);
    setJsonInput('');
    setResult(null);
    setDryRun(false);
    onClose();
  };

  const handleDownloadTemplate = (format: 'csv' | 'xlsx' | 'json') => {
    downloadImportTemplate(format);
  };

  return (
    <Modal
      title="Bulk Import Events"
      open={open}
      onCancel={handleClose}
      width={900}
      footer={[
        <Button key="close" onClick={handleClose} disabled={importing}>
          Close
        </Button>,
        <Button
          key="validate"
          onClick={() => handleImport(true)}
          disabled={importing}
          loading={importing}
        >
          Validate Only
        </Button>,
        <Button
          key="import"
          type="primary"
          onClick={() => handleImport(false)}
          loading={importing}
          disabled={importing}
        >
          Import Events
        </Button>,
      ]}
    >
      <Space direction="vertical" style={{ width: '100%' }} size="large">
        <Alert
          message="Import up to 1000 events at once"
          description="Events will be processed through existing OUTBOUND integrations automatically. Supported formats: CSV, Excel (XLSX/XLS), JSON."
          type="info"
          showIcon
        />

        <Tabs
          activeKey={importMode}
          onChange={(key) => {
            setImportMode(key as 'file' | 'json');
            setResult(null);
          }}
          items={[
            {
              key: 'file',
              label: 'File Upload',
              children: (
                <Space direction="vertical" style={{ width: '100%' }} size="middle">
                  <Upload
                    maxCount={1}
                    fileList={fileList}
                    onChange={({ fileList: newFileList }) => {
                      setFileList(newFileList);
                      setResult(null);
                    }}
                    beforeUpload={() => false}
                    accept=".csv,.xlsx,.xls,.json"
                    onRemove={() => {
                      setFileList([]);
                      setResult(null);
                    }}
                  >
                    <Button icon={<UploadOutlined />}>Select File (CSV, Excel, JSON)</Button>
                  </Upload>

                  <div>
                    <strong>Download Templates:</strong>
                    <Space style={{ marginLeft: 12 }}>
                      <Button
                        size="small"
                        icon={<DownloadOutlined />}
                        onClick={() => handleDownloadTemplate('xlsx')}
                      >
                        Excel
                      </Button>
                      <Button
                        size="small"
                        icon={<DownloadOutlined />}
                        onClick={() => handleDownloadTemplate('csv')}
                      >
                        CSV
                      </Button>
                      <Button
                        size="small"
                        icon={<DownloadOutlined />}
                        onClick={() => handleDownloadTemplate('json')}
                      >
                        JSON
                      </Button>
                    </Space>
                  </div>
                </Space>
              ),
            },
            {
              key: 'json',
              label: 'JSON Input',
              children: (
                <Space direction="vertical" style={{ width: '100%' }} size="middle">
                  <Input.TextArea
                    rows={12}
                    placeholder={`Paste JSON array or object with events array:
[
  {
    "eventType": "APPOINTMENT_SCHEDULED",
    "tenantId": 12345,
    "payload": {
      "patientRid": 100,
      "doctorId": 50,
      "appointmentDate": "2024-03-20"
    },
    "source": "BULK_IMPORT",
    "sourceId": "optional-id"
  }
]`}
                    value={jsonInput}
                    onChange={(e) => {
                      setJsonInput(e.target.value);
                      setResult(null);
                    }}
                    style={{ fontFamily: 'monospace', fontSize: 12 }}
                  />

                  <Button
                    size="small"
                    icon={<DownloadOutlined />}
                    onClick={() => handleDownloadTemplate('json')}
                  >
                    Download JSON Template
                  </Button>
                </Space>
              ),
            },
          ]}
        />

        <Checkbox
          checked={continueOnError}
          onChange={(e) => setContinueOnError(e.target.checked)}
        >
          Continue on error (import valid events even if some fail)
        </Checkbox>

        {importing && (
          <div>
            <Progress percent={100} status="active" />
            <div style={{ textAlign: 'center', marginTop: 8, color: '#666' }}>
              Processing import...
            </div>
          </div>
        )}

        {result && (
          <Space direction="vertical" style={{ width: '100%' }} size="middle">
            <Alert
              type={result.success ? 'success' : result.summary.successful > 0 ? 'warning' : 'error'}
              message={`Import ${result.summary.failed === 0 && result.summary.duplicates === 0 ? 'Successful' : 'Completed with Issues'}`}
              description={
                <div style={{ fontSize: 13 }}>
                  <div><strong>Total:</strong> {result.summary.total}</div>
                  <div style={{ color: '#52c41a' }}><strong>Successful:</strong> {result.summary.successful}</div>
                  <div style={{ color: '#faad14' }}><strong>Duplicates:</strong> {result.summary.duplicates}</div>
                  <div style={{ color: '#ff4d4f' }}><strong>Failed:</strong> {result.summary.failed}</div>
                </div>
              }
              showIcon
            />

            {result.parseErrors && result.parseErrors.length > 0 && (
              <Alert
                type="warning"
                message={`${result.parseErrors.length} Parse Errors`}
                description={
                  <div style={{ maxHeight: 200, overflow: 'auto', fontSize: 12, fontFamily: 'monospace' }}>
                    {result.parseErrors.slice(0, 10).map((err, idx) => (
                      <div key={idx} style={{ marginBottom: 4 }}>
                        <strong>Row {err.row}:</strong> {err.error}
                      </div>
                    ))}
                    {result.parseErrors.length > 10 && (
                      <div style={{ marginTop: 8, fontStyle: 'italic' }}>
                        ... and {result.parseErrors.length - 10} more parse errors
                      </div>
                    )}
                  </div>
                }
              />
            )}

            {result.results.failed.length > 0 && (
              <Alert
                type="error"
                message={`${result.results.failed.length} Validation Failures`}
                description={
                  <div style={{ maxHeight: 200, overflow: 'auto', fontSize: 12, fontFamily: 'monospace' }}>
                    {result.results.failed.slice(0, 10).map((err, idx) => (
                      <div key={idx} style={{ marginBottom: 4 }}>
                        <strong>Event {err.index + 1}</strong> ({err.eventType || 'unknown'}): {err.error}
                      </div>
                    ))}
                    {result.results.failed.length > 10 && (
                      <div style={{ marginTop: 8, fontStyle: 'italic' }}>
                        ... and {result.results.failed.length - 10} more validation errors
                      </div>
                    )}
                  </div>
                }
              />
            )}

            {result.results.duplicates.length > 0 && (
              <Alert
                type="warning"
                message={`${result.results.duplicates.length} Duplicate Events Skipped`}
                description={
                  <div style={{ maxHeight: 150, overflow: 'auto', fontSize: 12 }}>
                    Events with duplicate eventKey were skipped to avoid reprocessing.
                  </div>
                }
              />
            )}

            {result.summary.successful > 0 && result.summary.failed === 0 && result.summary.duplicates === 0 && (
              <Alert
                type="success"
                message="All events imported successfully"
                description="Events are now being processed through OUTBOUND integrations."
              />
            )}
          </Space>
        )}
      </Space>
    </Modal>
  );
};
