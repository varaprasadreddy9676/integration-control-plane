import { describe, expect, it } from 'vitest';
import {
  getAdapterStatusPresentation,
  getEventSourceConfigurationPresentation,
  getWorkerStatusPresentation,
} from '../features/system-status/system-status-utils';

describe('system-status-utils', () => {
  it('keeps not_configured separate from error', () => {
    expect(getEventSourceConfigurationPresentation({ configured: false, state: 'not_configured' })).toMatchObject({
      label: 'Not Configured',
      color: 'blue',
    });
  });

  it('treats HTTP push not_applicable as neutral', () => {
    expect(getAdapterStatusPresentation({ connectionStatus: 'not_applicable' })).toMatchObject({
      label: 'Not Applicable',
      color: 'default',
    });
  });

  it('treats reconnecting adapters as warning instead of down', () => {
    expect(getAdapterStatusPresentation({ connectionStatus: 'reconnecting' })).toMatchObject({
      label: 'Reconnecting',
      color: 'orange',
    });
  });

  it('treats running but non-alive workers as stale', () => {
    expect(getWorkerStatusPresentation({ enabled: true, running: true, alive: false, status: 'stale' })).toMatchObject({
      label: 'Stale',
      color: 'orange',
    });
  });
});
