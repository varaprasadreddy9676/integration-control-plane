import type { FormInstance } from 'antd';

export const buildPreviewContext = (form: FormInstance) => ({
  eventType: form.getFieldValue('eventType') ?? 'UNKNOWN',
  entityCode: form.getFieldValue('entityCode') ?? 'ENTITY',
  entityName: form.getFieldValue('entityName') ?? 'Entity'
});
