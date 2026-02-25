import type { FormInstance } from 'antd';

interface UseDeliveryModeSwitchParams {
  form: FormInstance;
  deliveryModeChoice: 'single' | 'multi';
  isMultiAction: boolean;
  transformationTab: 'SIMPLE' | 'SCRIPT';
  scriptValue: string;
  mappingState: { mappings: any[]; staticFields: any[] };
  setDeliveryModeChoice: (value: 'single' | 'multi') => void;
  setMultiActionMode: (value: boolean) => void;
  setActivePanels: (panels: string[]) => void;
  prevSingleConfigRef: React.MutableRefObject<{ targetUrl?: string; httpMethod?: string } | null>;
  prevSingleTransformRef: React.MutableRefObject<{ mode: 'SIMPLE' | 'SCRIPT'; script?: string; mappings?: any[]; staticFields?: any[] } | null>;
  modal: { confirm: (options: any) => void };
}

export const useDeliveryModeSwitch = ({
  form,
  deliveryModeChoice,
  isMultiAction,
  transformationTab,
  scriptValue,
  mappingState,
  setDeliveryModeChoice,
  setMultiActionMode,
  setActivePanels,
  prevSingleConfigRef,
  prevSingleTransformRef,
  modal
}: UseDeliveryModeSwitchParams) => {
  const handleSwitchMode = (mode: 'single' | 'multi') => {
    const current = deliveryModeChoice;
    if (mode === current) return;
    setDeliveryModeChoice(mode);
    if (mode === 'multi' && !isMultiAction) {
      const hasTransformation = transformationTab === 'SCRIPT'
        ? scriptValue && scriptValue.trim().length > 0
        : (mappingState.mappings.length > 0 || mappingState.staticFields.length > 0);

      const doSwitch = () => {
        const targetUrl = form.getFieldValue('targetUrl');
        const httpMethod = form.getFieldValue('httpMethod') || 'POST';
        prevSingleConfigRef.current = { targetUrl, httpMethod };
        prevSingleTransformRef.current = {
          mode: transformationTab,
          script: scriptValue,
          mappings: mappingState.mappings,
          staticFields: mappingState.staticFields
        };

        const action = {
          name: form.getFieldValue('name') ? `${form.getFieldValue('name')} Action` : 'Action 1',
          httpMethod,
          targetUrl: targetUrl || '',
          transformationMode: transformationTab,
          transformation: transformationTab === 'SCRIPT'
            ? { script: scriptValue }
            : { mappings: mappingState.mappings, staticFields: mappingState.staticFields }
        };
        form.setFieldsValue({ actions: [action] });
        setMultiActionMode(true);
        setActivePanels(['configuration', 'multiAction', 'authentication', 'delivery']);
      };

      if (hasTransformation) {
        modal.confirm({
          title: 'Switch to multi-action delivery?',
          content: 'Your current transformation will be moved to the first action. You can add more actions after switching.',
          okText: 'Switch to multi-action',
          cancelText: 'Cancel',
          onOk: doSwitch,
          onCancel: () => setDeliveryModeChoice(current)
        });
      } else {
        doSwitch();
      }
    }

    if (mode === 'single' && isMultiAction) {
      modal.confirm({
        title: 'Switch to single delivery?',
        content: 'Only the first action will be kept. Other actions will be removed.',
        okText: 'Switch',
        okButtonProps: { danger: true },
        cancelText: 'Cancel',
        onOk: () => {
          const firstAction = form.getFieldValue(['actions', 0]);
          if (firstAction) {
            // Restore single-action settings
            const singleTargetUrl = prevSingleConfigRef.current?.targetUrl || firstAction.targetUrl;
            const singleHttpMethod = prevSingleConfigRef.current?.httpMethod || firstAction.httpMethod;
            form.setFieldsValue({
              targetUrl: singleTargetUrl,
              httpMethod: singleHttpMethod,
              actions: []
            });
          } else {
            form.setFieldsValue({ actions: [] });
          }

          // Restore transformation if available
          if (prevSingleTransformRef.current) {
            const prev = prevSingleTransformRef.current;
            if (prev.mode === 'SCRIPT') {
              form.setFieldsValue({ transformation: { script: prev.script } });
            } else {
              form.setFieldsValue({
                transformation: {
                  mappings: prev.mappings || [],
                  staticFields: prev.staticFields || []
                }
              });
            }
          }

          setMultiActionMode(false);
          setActivePanels(['configuration', 'authentication', 'delivery', 'transformation']);
        },
        onCancel: () => setDeliveryModeChoice(current)
      });
    }
  };

  return { handleSwitchMode };
};
