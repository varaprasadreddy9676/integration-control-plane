-- Migration: Add Qikchat WhatsApp template
-- Description: Template for sending WhatsApp notifications via Qikchat when bills are created

INSERT INTO webhook_templates (
  entity_rid,
  name,
  description,
  category,
  event_type,
  target_url,
  http_method,
  auth_type,
  auth_config,
  headers,
  timeout_ms,
  retry_count,
  transformation_mode,
  transformation,
  is_active,
  metadata
) VALUES (
  1,  -- Change this to your entity_rid
  'Qikchat WhatsApp - Bill Created',
  'Send WhatsApp notification via Qikchat when a bill is created. Sends bill PDF and details to patient.',
  'Notifications',
  JSON_ARRAY('BILL_CREATED'),
  'https://api.qikchat.in/v1/messages',
  'POST',
  'API_KEY',
  JSON_OBJECT(
    'headerName', 'QIKCHAT-API-KEY',
    'apiKey', 'U0eF-FJ8b-IVHx'
  ),
  NULL,
  30000,
  3,
  'SCRIPT',
  JSON_OBJECT(
    'script', 'function transform(payload, context) {\n  const patientName = payload.patient_name || payload.patientName || \"Patient\";\n  const billNumber = payload.bill_number || payload.billNumber || payload.billId || \"N/A\";\n  const billAmount = payload.bill_amount || payload.amount || payload.totalAmount || \"0\";\n  const patientPhone = payload.patient_phone || payload.patientPhone || payload.phone || \"919533322607\";\n  const pdfLink = payload.pdf_url || payload.pdfUrl || \"https://medicsprime.in/medics-notification/files/\" + (payload.file_hash || \"bill\") + \".pdf\";\n  const pdfFilename = \"Bill_\" + billNumber + \".pdf\";\n  return {\n    to_contact: patientPhone,\n    type: \"template\",\n    template: {\n      name: \"bill_created_attachment\",\n      language: \"en\",\n      components: [\n        {\n          type: \"header\",\n          parameters: [\n            {\n              type: \"document\",\n              document: {\n                link: pdfLink,\n                filename: pdfFilename\n              }\n            }\n          ]\n        },\n        {\n          type: \"body\",\n          parameters: [\n            { type: \"text\", text: patientName },\n            { type: \"text\", text: billNumber },\n            { type: \"text\", text: String(billAmount) }\n          ]\n        }\n      ]\n    }\n  };\n}'
  ),
  TRUE,
  JSON_OBJECT(
    'vendor', 'Qikchat',
    'templateName', 'bill_created_attachment',
    'requiredFields', JSON_ARRAY('patient_name', 'bill_number', 'bill_amount', 'patient_phone', 'pdf_url')
  )
);
