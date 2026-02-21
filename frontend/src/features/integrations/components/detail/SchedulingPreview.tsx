import { useEffect, useState } from 'react';
import { Card, Tag, Space, Typography, Spin, Alert, Statistic, Row, Col, Collapse, Modal, Button, App } from 'antd';
import {
  ClockCircleOutlined,
  CalendarOutlined,
  CheckCircleOutlined,
  SyncOutlined,
  InfoCircleOutlined,
  EditOutlined,
  DownOutlined,
  RightOutlined,
  UnorderedListOutlined
} from '@ant-design/icons';
import Editor from '@monaco-editor/react';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import { testSchedulingScript, type SchedulingTestResult } from '../../../../services/api';
import { cssVar, useDesignTokens } from '../../../../design-system/utils';

dayjs.extend(relativeTime);

const { Text, Paragraph } = Typography;

interface SchedulingPreviewProps {
  integrationId?: string; // Can be undefined for new integrations
  script?: string;
  deliveryMode: 'IMMEDIATE' | 'DELAYED' | 'RECURRING';
  eventType?: string;
  onPreviewChange?: (state: { preview: SchedulingTestResult | null; error: string | null; loading: boolean }) => void;
}

/**
 * SchedulingPreview - Real-time preview of when integration will be scheduled
 *
 * Shows a visual preview of scheduling results:
 * - DELAYED: Shows single scheduled time
 * - RECURRING: Shows first occurrence, interval, and total occurrences
 *
 * Auto-refreshes when script changes (debounced 800ms)
 */
export const SchedulingPreview = ({
  integrationId,
  script,
  deliveryMode,
  eventType,
  onPreviewChange
}: SchedulingPreviewProps) => {
  const { token } = useDesignTokens();
  const colors = cssVar.legacy;
  const { message } = App.useApp();
  const [preview, setPreview] = useState<SchedulingTestResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [samplePayload, setSamplePayload] = useState<any>(null);
  const [customPayload, setCustomPayload] = useState<any>(null);
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editedPayloadText, setEditedPayloadText] = useState<string>('');
  const [previewCollapsed, setPreviewCollapsed] = useState(false);
  const [showNextRuns, setShowNextRuns] = useState(false);

  useEffect(() => {
    if (deliveryMode !== 'RECURRING') {
      setShowNextRuns(false);
    }
  }, [deliveryMode]);

  useEffect(() => {
    // Only fetch preview for DELAYED or RECURRING modes with script
    if (deliveryMode === 'IMMEDIATE' || !script || script.trim().length === 0) {
      setPreview(null);
      setError(null);
      setLoading(false);
      onPreviewChange?.({ preview: null, error: null, loading: false });
      return;
    }

    let isActive = true;
    const fetchPreview = async () => {
      setLoading(true);
      onPreviewChange?.({ preview: null, error: null, loading: true });
      setError(null);
      try {
        // Use 'new' as integration ID for create mode, otherwise use actual ID
        const id = integrationId || 'new';

        // Send current script, deliveryMode, and eventType from form (unsaved changes)
        // Use custom payload if user has edited it, otherwise backend will use event-specific sample
        const result = await testSchedulingScript(id, {
          script,
          deliveryMode,
          eventType, // Send event type so backend can use event-specific sample payload
          payload: customPayload // Send custom payload if available (overrides event-specific sample)
        });
        if (!isActive) return;
        setPreview(result);
        // Store sample payload if available
        if ((result as any).samplePayload) {
          setSamplePayload((result as any).samplePayload);
        }
        onPreviewChange?.({ preview: result, error: null, loading: false });
      } catch (err: any) {
        if (!isActive) return;
        const message = err.message || 'Failed to generate preview';
        setError(message);
        setPreview(null);
        onPreviewChange?.({ preview: null, error: message, loading: false });
      } finally {
        if (isActive) {
          setLoading(false);
        }
      }
    };

    // Debounce to avoid too many API calls while user is typing
    const timer = setTimeout(fetchPreview, 800);
    return () => {
      isActive = false;
      clearTimeout(timer);
    };
  }, [script, deliveryMode, eventType, integrationId, customPayload, onPreviewChange]);

  const handleEditSampleData = () => {
    // Use current sample payload or custom payload as starting point
    const currentPayload = customPayload || samplePayload || {
      sample: true,
      testMode: true,
      timestamp: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      arrivedAt: new Date().toISOString(),
      appt: {
        apptDate: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        fromDate: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        apptTime: '14:00:00',
        fromTime: '14:00:00',
        patientName: 'Test Patient',
        reasonForVisit: 'new consult'
      },
      patient: {
        fullName: 'Test Patient',
        phone: '9876543210',
        uhid: 'TEST_UHID_001'
      },
      appointmentDateTime: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
      patientRid: 12345,
      eventType: eventType || 'TEST_EVENT',
      patientName: 'Test Patient'
    };
    setEditedPayloadText(JSON.stringify(currentPayload, null, 2));
    setEditModalOpen(true);
  };

  const handleSaveCustomPayload = () => {
    try {
      const parsed = JSON.parse(editedPayloadText);
      setCustomPayload(parsed);
      setEditModalOpen(false);
      message.success('Custom sample data saved - preview will update');
    } catch (err: any) {
      message.error('Invalid JSON: ' + err.message);
    }
  };

  const handleResetToDefault = () => {
    setCustomPayload(null);
    setEditModalOpen(false);
    message.info('Reset to default sample data');
  };

  // Don't show anything for IMMEDIATE mode
  if (deliveryMode === 'IMMEDIATE') {
    return null;
  }

  // Don't show if no script yet
  if (!script || script.trim().length === 0) {
    return (
      <Card
        size="small"
        style={{
          background: cssVar.bg.subtle,
          borderColor: cssVar.border.default
        }}
      >
        <Text type="secondary">
          <ClockCircleOutlined /> Enter a scheduling script to see preview
        </Text>
      </Card>
    );
  }

  // Don't show if no event type selected (unless custom payload is provided)
  if (!eventType && !customPayload) {
    return (
      <Card
        size="small"
        title={
          <Space>
            <ClockCircleOutlined style={{ color: colors.warning[500] }} />
            <span>No Event Type Selected</span>
          </Space>
        }
        extra={
          <Button
            type="link"
            size="small"
            icon={<EditOutlined />}
            onClick={handleEditSampleData}
            style={{ padding: 0, height: 'auto' }}
          >
            Use Custom Sample
          </Button>
        }
        style={{
          background: cssVar.bg.subtle,
          borderColor: cssVar.border.default
        }}
      >
        <Text type="secondary" style={{ fontSize: 12 }}>
          Select an event type to see preview with relevant sample data, or click "Use Custom Sample" to provide your own test data.
        </Text>

        {/* Edit Sample Modal */}
        <Modal
          title="Edit Sample Test Data"
          open={editModalOpen}
          onCancel={() => setEditModalOpen(false)}
          width={700}
          footer={
            <Space>
              <Button onClick={handleResetToDefault}>
                Reset to Default
              </Button>
              <Button onClick={() => setEditModalOpen(false)}>
                Cancel
              </Button>
              <Button type="primary" onClick={handleSaveCustomPayload}>
                Apply Custom Data
              </Button>
            </Space>
          }
        >
          <Space direction="vertical" size={12} style={{ width: '100%' }}>
            <Alert
              type="info"
              showIcon
              message="Create custom test data for your scheduling script"
              description="Since no event type is selected, you can provide custom JSON data to test your script."
            />
            <div
              style={{
                border: `1px solid ${cssVar.border.default}`,
                borderRadius: token.borderRadiusLG,
                overflow: 'hidden'
              }}
            >
              <Editor
                height="400px"
                language="json"
                value={editedPayloadText}
                onChange={(value) => setEditedPayloadText(value || '')}
                options={{
                  minimap: { enabled: false },
                  fontSize: 13,
                  lineNumbers: 'on',
                  wordWrap: 'on',
                  formatOnPaste: true,
                  formatOnType: true
                }}
                theme="vs-dark"
              />
            </div>
          </Space>
        </Modal>
      </Card>
    );
  }

  // Loading state
  if (loading) {
    return (
      <Card
        size="small"
        style={{
          background: cssVar.bg.subtle,
          borderColor: cssVar.border.default
        }}
      >
        <Space>
          <Spin size="small" />
          <Text type="secondary">Generating schedule preview...</Text>
        </Space>
      </Card>
    );
  }

  // Error state - show error but still allow editing sample data
  if (error) {
    return (
      <Card
        size="small"
        title={
          <Space>
            <CalendarOutlined style={{ color: colors.error[500] }} />
            <span>Schedule Preview Error</span>
          </Space>
        }
        extra={
          <Space size={8}>
            {customPayload && (
              <Tag color="purple">
                Custom Data
              </Tag>
            )}
            {!customPayload && (
              <Tag
                icon={<InfoCircleOutlined />}
                color="blue"
              >
                Sample Data
              </Tag>
            )}
            <Button
              type="link"
              size="small"
              icon={<EditOutlined />}
              onClick={handleEditSampleData}
              style={{ padding: 0, height: 'auto' }}
            >
              Edit Sample
            </Button>
          </Space>
        }
        style={{
          background: cssVar.bg.subtle,
          borderColor: colors.error[600]
        }}
      >
        <Alert
          type="error"
          showIcon
          message="Scheduling script execution failed"
          description={
            <Space direction="vertical" size={8}>
              <Text style={{ fontSize: 12 }}>{error}</Text>
              <Text style={{ fontSize: 12 }}>
                <strong>Tip:</strong> Click "Edit Sample" above to customize the test data with fields your script needs.
                {!customPayload && " The default sample may not have the fields your script expects."}
              </Text>
            </Space>
          }
          style={{ marginBottom: 0 }}
        />

        {/* Edit Sample Modal */}
        <Modal
          title="Edit Sample Test Data"
          open={editModalOpen}
          onCancel={() => setEditModalOpen(false)}
          width={700}
          footer={
            <Space>
              <Button onClick={handleResetToDefault}>
                Reset to Default
              </Button>
              <Button onClick={() => setEditModalOpen(false)}>
                Cancel
              </Button>
              <Button type="primary" onClick={handleSaveCustomPayload}>
                Apply Custom Data
              </Button>
            </Space>
          }
        >
          <Space direction="vertical" size={12} style={{ width: '100%' }}>
            <Alert
              type="info"
              showIcon
              message="Edit the JSON payload below to test your scheduling script with custom data"
              description="Make sure the JSON is valid and includes all fields your script needs. The preview will update automatically when you apply."
            />
            <div
              style={{
                border: `1px solid ${cssVar.border.default}`,
                borderRadius: token.borderRadiusLG,
                overflow: 'hidden'
              }}
            >
              <Editor
                height="400px"
                language="json"
                value={editedPayloadText}
                onChange={(value) => setEditedPayloadText(value || '')}
                options={{
                  minimap: { enabled: false },
                  fontSize: 13,
                  lineNumbers: 'on',
                  wordWrap: 'on',
                  formatOnPaste: true,
                  formatOnType: true
                }}
                theme="vs-dark"
              />
            </div>
          </Space>
        </Modal>
      </Card>
    );
  }

  // No preview data
  if (!preview) {
    return null;
  }

  // DELAYED mode preview
  if (deliveryMode === 'DELAYED' && preview.result.scheduledFor) {
    const scheduledTime = dayjs(preview.result.scheduledFor);
    const isPastDue = preview.result.isPastDue || scheduledTime.isBefore(dayjs());
    const fromNow = scheduledTime.fromNow();

    // Extract sample appointment details if available
    const sampleApptDate = samplePayload?.appt?.apptDate || samplePayload?.appt?.fromDate;
    const sampleApptTime = samplePayload?.appt?.apptTime || samplePayload?.appt?.fromTime;
    const sampleApptDateTime = sampleApptDate && sampleApptTime
      ? dayjs(`${sampleApptDate}T${sampleApptTime}`)
      : null;

    return (
      <Card
        size="small"
        title={
          <Space>
            <CalendarOutlined style={{ color: colors.info[500] }} />
            <span>Schedule Preview (Test Mode)</span>
          </Space>
        }
        extra={
          <Space size={8}>
            {customPayload && (
              <Tag color="purple">
                Custom Data
              </Tag>
            )}
            {!customPayload && (
              <Tag
                icon={<InfoCircleOutlined />}
                color="blue"
              >
                Sample Data
              </Tag>
            )}
            <Button
              type="link"
              size="small"
              icon={<EditOutlined />}
              onClick={handleEditSampleData}
              style={{ padding: 0, height: 'auto' }}
            >
              Edit
            </Button>
            <Button
              type="text"
              size="small"
              icon={previewCollapsed ? <RightOutlined /> : <DownOutlined />}
              onClick={() => setPreviewCollapsed((prev) => !prev)}
            >
              {previewCollapsed ? 'Show' : 'Hide'}
            </Button>
          </Space>
        }
        style={{
          background: cssVar.bg.subtle,
          borderColor: colors.info[600]
        }}
      >
        {previewCollapsed ? (
          <Text type="secondary" style={{ fontSize: 12 }}>
            Preview hidden. Click "Show" to view details.
          </Text>
        ) : (
          <>
            <Alert
              type="info"
              showIcon
              icon={<InfoCircleOutlined />}
              message={customPayload ? "Preview based on custom test data" : "Preview based on sample event data"}
              description={
                <Space direction="vertical" size={4}>
                  <Text style={{ fontSize: 12 }}>
                    Actual scheduled time will vary based on real event data at runtime.
                    {!customPayload && " Click 'Edit' above to test with custom data."}
                  </Text>
                  {sampleApptDateTime && (
                    <Text style={{ fontSize: 12 }}>
                      <strong>Sample appointment:</strong> {sampleApptDateTime.format('MMM D, YYYY [at] h:mm A')}
                    </Text>
                  )}
                </Space>
              }
              style={{ marginBottom: 12 }}
            />

            <Row gutter={[16, 16]}>
              <Col xs={24} sm={12}>
                <Statistic
                  title="Calculated schedule time"
                  value={scheduledTime.format('MMM D, YYYY')}
                  valueStyle={{ fontSize: 16, color: colors.info[500] }}
                  prefix={<CalendarOutlined />}
                />
                <Text type="secondary" style={{ fontSize: 12 }}>
                  {scheduledTime.format('dddd')} at {scheduledTime.format('h:mm A')}
                </Text>
              </Col>
              <Col xs={24} sm={12}>
                <Statistic
                  title="Delay from sample time"
                  value={preview.result.delayFromNow || fromNow}
                  valueStyle={{ fontSize: 16, color: colors.success[500] }}
                  prefix={<ClockCircleOutlined />}
                />
                <Text type="secondary" style={{ fontSize: 12 }}>
                  {fromNow}
                </Text>
              </Col>
            </Row>

            <Collapse
              size="small"
              ghost
              items={[
                {
                  key: 'sample-data',
                  label: <Text type="secondary" style={{ fontSize: 12 }}>
                    {customPayload ? 'View custom test data used' : 'View sample event data used'}
                  </Text>,
                  children: (
                    <pre style={{
                      fontSize: 11,
                      background: cssVar.bg.surface,
                      padding: 8,
                      borderRadius: 4,
                      maxHeight: 200,
                      overflow: 'auto'
                    }}>
                      {JSON.stringify(customPayload || samplePayload, null, 2)}
                    </pre>
                  )
                }
              ]}
              style={{ marginTop: 12 }}
            />

            <Text type="secondary" style={{ fontSize: 11, display: 'block', marginTop: 8 }}>
              Script execution: {preview.executionTimeMs}ms
            </Text>
          </>
        )}

        <Modal
          title="Edit Sample Test Data"
          open={editModalOpen}
          onCancel={() => setEditModalOpen(false)}
          width={700}
          footer={
            <Space>
              <Button onClick={handleResetToDefault}>
                Reset to Default
              </Button>
              <Button onClick={() => setEditModalOpen(false)}>
                Cancel
              </Button>
              <Button type="primary" onClick={handleSaveCustomPayload}>
                Apply Custom Data
              </Button>
            </Space>
          }
        >
          <Space direction="vertical" size={12} style={{ width: '100%' }}>
            <Alert
              type="info"
              showIcon
              message="Edit the JSON payload below to test your scheduling script with custom data"
              description="Make sure the JSON is valid. The preview will update automatically when you apply."
            />
            <div
              style={{
                border: `1px solid ${cssVar.border.default}`,
                borderRadius: token.borderRadiusLG,
                overflow: 'hidden'
              }}
            >
              <Editor
                height="400px"
                language="json"
                value={editedPayloadText}
                onChange={(value) => setEditedPayloadText(value || '')}
                options={{
                  minimap: { enabled: false },
                  fontSize: 13,
                  lineNumbers: 'on',
                  wordWrap: 'on',
                  formatOnPaste: true,
                  formatOnType: true
                }}
                theme="vs-dark"
              />
            </div>
          </Space>
        </Modal>
      </Card>
    );
  }

  // RECURRING mode preview
  if (deliveryMode === 'RECURRING' && preview.result.firstOccurrenceDate) {
    const firstTime = dayjs(preview.result.firstOccurrenceDate);
    const fromNow = firstTime.fromNow();

    return (
      <Card
        size="small"
        title={
          <Space>
            <SyncOutlined style={{ color: colors.info[500] }} />
            <span>Recurring Schedule Preview</span>
          </Space>
        }
        extra={
          <Space size={8}>
            {customPayload && (
              <Tag color="purple">
                Custom Data
              </Tag>
            )}
            <Tag icon={<CheckCircleOutlined />} color="processing">
              {preview.result.maxOccurrences || '∞'} occurrences
            </Tag>
            <Button
              type="link"
              size="small"
              icon={<EditOutlined />}
              onClick={handleEditSampleData}
              style={{ padding: 0, height: 'auto' }}
            >
              Edit
            </Button>
            <Button
              type="text"
              size="small"
              icon={previewCollapsed ? <RightOutlined /> : <DownOutlined />}
              onClick={() => setPreviewCollapsed((prev) => !prev)}
            >
              {previewCollapsed ? 'Show' : 'Hide'}
            </Button>
          </Space>
        }
        style={{
          background: cssVar.bg.subtle,
          borderColor: colors.info[600]
        }}
      >
        {previewCollapsed ? (
          <Text type="secondary" style={{ fontSize: 12 }}>
            Preview hidden. Click "Show" to view details.
          </Text>
        ) : (
          <>
            <Row gutter={[16, 12]}>
              <Col xs={24} sm={12}>
                <Statistic
                  title="First occurrence"
                  value={firstTime.format('MMM D, YYYY')}
                  valueStyle={{ fontSize: 14, color: colors.info[500] }}
                  prefix={<CalendarOutlined />}
                />
                <Text type="secondary" style={{ fontSize: 12 }}>
                  {firstTime.format('dddd')} at {firstTime.format('h:mm A')} ({fromNow})
                </Text>
              </Col>
              <Col xs={24} sm={12}>
                <Statistic
                  title="Interval"
                  value={preview.result.intervalHuman || 'Unknown'}
                  valueStyle={{ fontSize: 14, color: colors.success[500] }}
                  prefix={<ClockCircleOutlined />}
                />
                {preview.result.intervalMs && (
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    Every {(preview.result.intervalMs / (1000 * 60 * 60)).toFixed(1)} hours
                  </Text>
                )}
              </Col>
              <Col xs={24} sm={12}>
                <Statistic
                  title="Total occurrences"
                  value={preview.result.maxOccurrences || '∞'}
                  valueStyle={{ fontSize: 14 }}
                />
              </Col>
              {preview.result.endDateFormatted && (
                <Col xs={24} sm={12}>
                  <Statistic
                    title="End date"
                    value={dayjs(preview.result.endDateFormatted).format('MMM D, YYYY')}
                    valueStyle={{ fontSize: 14 }}
                  />
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    {dayjs(preview.result.endDateFormatted).format('h:mm A')}
                  </Text>
                </Col>
              )}
            </Row>

            {preview.result.sampleOccurrences && preview.result.sampleOccurrences.length > 0 && (
              <div style={{ marginTop: 12 }}>
                <Button
                  type="link"
                  size="small"
                  icon={<UnorderedListOutlined />}
                  onClick={() => setShowNextRuns((prev) => !prev)}
                  style={{ padding: 0, height: 'auto' }}
                >
                  {showNextRuns ? 'Hide next 5 runs' : 'Show next 5 runs'}
                </Button>
                {showNextRuns && (
                  <div style={{ marginTop: 8 }}>
                    {preview.result.sampleOccurrences.map((occurrence) => (
                      <Space key={occurrence.occurrence} size={8} style={{ display: 'flex', marginBottom: 6 }}>
                        <Tag color="blue">#{occurrence.occurrence}</Tag>
                        <Text style={{ fontSize: 12 }}>
                          {dayjs(occurrence.scheduledFor).format('MMM D, YYYY [at] h:mm A')}
                        </Text>
                      </Space>
                    ))}
                  </div>
                )}
              </div>
            )}

            {preview.result.totalDuration && (
              <Alert
                type="info"
                showIcon
                message={`Total duration: ${preview.result.totalDuration}`}
                style={{ marginTop: 12, marginBottom: 0 }}
              />
            )}

            <Text type="secondary" style={{ fontSize: 11, display: 'block', marginTop: 12 }}>
              Execution time: {preview.executionTimeMs}ms
            </Text>
          </>
        )}

        <Modal
          title="Edit Sample Test Data"
          open={editModalOpen}
          onCancel={() => setEditModalOpen(false)}
          width={700}
          footer={
            <Space>
              <Button onClick={handleResetToDefault}>
                Reset to Default
              </Button>
              <Button onClick={() => setEditModalOpen(false)}>
                Cancel
              </Button>
              <Button type="primary" onClick={handleSaveCustomPayload}>
                Apply Custom Data
              </Button>
            </Space>
          }
        >
          <Space direction="vertical" size={12} style={{ width: '100%' }}>
            <Alert
              type="info"
              showIcon
              message="Edit the JSON payload below to test your scheduling script with custom data"
              description="Make sure the JSON is valid. The preview will update automatically when you apply."
            />
            <div
              style={{
                border: `1px solid ${cssVar.border.default}`,
                borderRadius: token.borderRadiusLG,
                overflow: 'hidden'
              }}
            >
              <Editor
                height="400px"
                language="json"
                value={editedPayloadText}
                onChange={(value) => setEditedPayloadText(value || '')}
                options={{
                  minimap: { enabled: false },
                  fontSize: 13,
                  lineNumbers: 'on',
                  wordWrap: 'on',
                  formatOnPaste: true,
                  formatOnType: true
                }}
                theme="vs-dark"
              />
            </div>
          </Space>
        </Modal>
      </Card>
    );
  }

  return null;
};
