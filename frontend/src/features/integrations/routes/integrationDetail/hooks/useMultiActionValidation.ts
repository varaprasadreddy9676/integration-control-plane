import { useEffect } from 'react';
import type { FormInstance } from 'antd';

interface UseMultiActionValidationParams {
  form: FormInstance;
  actions: any[];
  setErrors: (errors: string[]) => void;
}

export const useMultiActionValidation = ({
  form,
  actions,
  setErrors
}: UseMultiActionValidationParams) => {
  useEffect(() => {
    const errors: string[] = [];
    const formActions = form.getFieldValue('actions');

    if (formActions && Array.isArray(formActions) && formActions.length > 0) {
      formActions.forEach((action: any, i: number) => {
        const actionName = action?.name || `Action ${i + 1}`;

        const actionMode = action?.transformationMode || 'SCRIPT';
        if (actionMode === 'SCRIPT') {
          const script = action?.transformation?.script;
          if (!script || !script.trim()) {
            errors.push(`${actionName}: Missing transformation script`);
          }
        }

        if (action?.targetUrl && !/^https?:\/\/.+/i.test(action.targetUrl)) {
          errors.push(`${actionName}: Invalid URL format`);
        }
      });
    }

    setErrors(errors);
  }, [actions, form, setErrors]);
};
