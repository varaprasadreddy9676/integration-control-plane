import { App, Form } from 'antd';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useEffect } from 'react';
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { LifecyclePanelContent } from '../features/integrations/routes/integrationDetail/components/LifecyclePanel';

const { previewSubjectExtractionMock, previewLifecycleCancellationMock, previewConditionReleaseMock } = vi.hoisted(() => ({
  previewSubjectExtractionMock: vi.fn(),
  previewLifecycleCancellationMock: vi.fn(),
  previewConditionReleaseMock: vi.fn(),
}));

vi.mock('../features/integrations/components/MonacoEditorInput', () => ({
  MonacoEditorInput: ({ placeholder }: { placeholder?: string }) => <textarea aria-label="Extraction Script" placeholder={placeholder} />,
}));

vi.mock('../services/api', () => ({
  previewSubjectExtraction: previewSubjectExtractionMock,
  previewLifecycleCancellation: previewLifecycleCancellationMock,
  previewConditionRelease: previewConditionReleaseMock,
}));

const eventTypes = [
  { eventType: 'APPOINTMENT_CONFIRMATION' },
  { eventType: 'APPOINTMENT_CANCELLATION' },
  { eventType: 'BOOKING_CANCELLED' },
];

const token = {
  borderRadiusLG: 12,
  borderRadius: 8,
};

const colors = {
  primary: { 50: '#f5faff', 200: '#c7d7ff' },
  secondary: { 200: '#ffd79d' },
  neutral: { 300: '#d9d9d9' },
};

function LifecycleHarness({
  initialValues,
  samplePayload = '{}',
  integrationId = 'integration-1',
  deliveryModeValue = 'DELAYED',
}: {
  initialValues: Record<string, unknown>;
  samplePayload?: string;
  integrationId?: string;
  deliveryModeValue?: 'DELAYED' | 'WAIT_FOR_CONDITION';
}) {
  const [form] = Form.useForm();

  useEffect(() => {
    form.resetFields();
    form.setFieldsValue(initialValues);
  }, [form, initialValues]);

  return (
    <App>
      <Form form={form} initialValues={initialValues}>
        <LifecyclePanelContent
          form={form}
          eventTypes={eventTypes}
          samplePayload={samplePayload}
          currentEventType="APPOINTMENT_CONFIRMATION"
          integrationId={integrationId}
          deliveryModeValue={deliveryModeValue}
          spacing={{ 4: '16' }}
          token={token}
          colors={colors}
        />
      </Form>
    </App>
  );
}

describe('LifecyclePanelContent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows an error and skips preview calls when sample payload is invalid JSON', async () => {
    const user = userEvent.setup();

    render(
      <LifecycleHarness
        samplePayload="{"
        initialValues={{
          subjectExtractionMode: 'PATHS',
          subjectExtractionPaths: [{ key: 'appointment_id', paths: 'appt.apptRID' }],
          lifecycleRules: [],
        }}
      />
    );

    await user.click(screen.getByRole('button', { name: 'Preview Extracted Subject' }));

    expect(previewSubjectExtractionMock).not.toHaveBeenCalled();
    expect(await screen.findByText('Sample payload is not valid JSON')).toBeInTheDocument();
  });

  it('revalidates subject type when extraction config exists even if the field is untouched', async () => {
    render(
      <LifecycleHarness
        initialValues={{
          resourceType: '',
          subjectExtractionMode: 'PATHS',
          subjectExtractionPaths: [{ key: 'appointment_id', paths: 'appt.apptRID' }],
          lifecycleRules: [],
        }}
      />
    );

    expect(await screen.findByText('Subject type is required when extraction or lifecycle rules are configured')).toBeInTheDocument();
  });

  it('clears stale preview event selection when lifecycle rules are removed', async () => {
    const user = userEvent.setup();

    render(
      <LifecycleHarness
        initialValues={{
          resourceType: 'BOOKING',
          subjectExtractionMode: 'PATHS',
          subjectExtractionPaths: [{ key: 'booking_ref', paths: 'booking.id' }],
          lifecycleRules: [{ eventTypes: ['BOOKING_CANCELLED'], action: 'CANCEL_PENDING', matchKeys: ['booking_ref'] }],
        }}
      />
    );

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Preview Impact' })).toBeEnabled();
    });

    await user.click(screen.getByRole('button', { name: 'Remove lifecycle rule' }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Preview Impact' })).toBeDisabled();
    });

    expect(screen.getByText('Add a lifecycle rule first')).toBeInTheDocument();
  });

  it('switches to condition mode and disables held-impact preview when condition rules are removed', async () => {
    const user = userEvent.setup();

    render(
      <LifecycleHarness
        deliveryModeValue="WAIT_FOR_CONDITION"
        initialValues={{
          resourceType: 'GRN',
          subjectExtractionMode: 'PATHS',
          subjectExtractionPaths: [{ key: 'grn_id', paths: 'grn.id' }],
          conditionRules: [{ eventTypes: ['GRN_APPROVED'], action: 'RELEASE_HELD', matchKeys: ['grn_id'] }],
        }}
      />
    );

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Preview Held Impact' })).toBeEnabled();
    });

    expect(screen.getByText('Hold And Release Rules')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Remove condition rule' }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Preview Held Impact' })).toBeDisabled();
    });

    expect(screen.getByText('Add a condition rule first')).toBeInTheDocument();
  });
});
