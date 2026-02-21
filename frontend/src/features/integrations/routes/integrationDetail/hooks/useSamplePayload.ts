import { useEffect, useRef } from 'react';

interface UseSamplePayloadParams {
  selectedEventType?: string;
  selectedEventTypeData?: { samplePayload?: any };
  setSampleInput: (value: string) => void;
}

export const useSamplePayload = ({
  selectedEventType,
  selectedEventTypeData,
  setSampleInput
}: UseSamplePayloadParams) => {
  const prevEventTypeRef = useRef<string | undefined>();

  useEffect(() => {
    if (selectedEventTypeData?.samplePayload && selectedEventType && selectedEventType !== prevEventTypeRef.current) {
      setSampleInput(JSON.stringify(selectedEventTypeData.samplePayload, null, 2));
      prevEventTypeRef.current = selectedEventType;
    }
  }, [selectedEventTypeData, selectedEventType, setSampleInput]);
};
