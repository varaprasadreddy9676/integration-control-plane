import { validateSchedulingScript } from '../../../../../services/api';

interface ValidateSchedulingParams {
  script: string;
  deliveryMode?: 'IMMEDIATE' | 'DELAYED' | 'RECURRING';
  timezone: string;
  eventType?: string;
  setSchedulingScriptValidation: (value: { status: 'idle' | 'success' | 'error'; message?: string }) => void;
  setIsValidatingScript: (value: boolean) => void;
  messageApi: { success: (msg: string) => void; error: (msg: string) => void; warning?: (msg: string) => void };
}

export const validateScheduling = async ({
  script,
  deliveryMode,
  timezone,
  eventType,
  setSchedulingScriptValidation,
  setIsValidatingScript,
  messageApi
}: ValidateSchedulingParams) => {
  if (!script || !script.trim()) {
    setSchedulingScriptValidation({
      status: 'error',
      message: 'Script is empty. Please enter scheduling logic.'
    });
    messageApi.error('Script is empty');
    return;
  }

  if (!deliveryMode || deliveryMode === 'IMMEDIATE') {
    messageApi.error('Please select DELAYED or RECURRING delivery mode');
    return;
  }

  if (deliveryMode !== 'DELAYED' && deliveryMode !== 'RECURRING') {
    messageApi.error('Please select DELAYED or RECURRING delivery mode');
    return;
  }

  // Warn if no event type selected (validation will use generic sample data)
  if (!eventType && messageApi.warning) {
    messageApi.warning('No event type selected - using generic sample data for validation');
  }

  setIsValidatingScript(true);
  setSchedulingScriptValidation({ status: 'idle' });

  try {
    const result = await validateSchedulingScript({
      script,
      deliveryMode,
      timezone,
      eventType
    });

    if (result.success) {
      setSchedulingScriptValidation({
        status: 'success',
        message: result.message || 'Script validated successfully'
      });
      messageApi.success('Script validated successfully');
    } else {
      setSchedulingScriptValidation({
        status: 'error',
        message: result.error || 'Validation failed'
      });
      messageApi.error(`Validation failed: ${result.error}`);
    }
  } catch (err: any) {
    const errorMsg = err?.message || err?.error || 'Server validation failed';
    setSchedulingScriptValidation({
      status: 'error',
      message: errorMsg
    });
    messageApi.error(`Validation failed: ${errorMsg}`);
  } finally {
    setIsValidatingScript(false);
  }
};
