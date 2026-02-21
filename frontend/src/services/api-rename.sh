#!/bin/bash

# Rename parameter names
sed -i '' 's/webhookId/integrationId/g' api.ts

# Rename function names (in order of specificity to avoid partial replacements)
sed -i '' 's/bulkActivateWebhooks/bulkActivateIntegrations/g' api.ts
sed -i '' 's/bulkDeactivateWebhooks/bulkDeactivateIntegrations/g' api.ts
sed -i '' 's/bulkEnableWebhooks/bulkEnableIntegrations/g' api.ts
sed -i '' 's/bulkDisableWebhooks/bulkDisableIntegrations/g' api.ts
sed -i '' 's/bulkDeleteWebhooks/bulkDeleteIntegrations/g' api.ts
sed -i '' 's/bulkCreateWebhooks/bulkCreateIntegrations/g' api.ts
sed -i '' 's/bulkUpdateWebhooks/bulkUpdateIntegrations/g' api.ts
sed -i '' 's/rotateWebhookSecret/rotateIntegrationSecret/g' api.ts
sed -i '' 's/removeWebhookSecret/removeIntegrationSecret/g' api.ts
sed -i '' 's/exportWebhooks/exportIntegrations/g' api.ts
sed -i '' 's/importWebhooks/importIntegrations/g' api.ts
sed -i '' 's/getWebhookVersions/getIntegrationVersions/g' api.ts
sed -i '' 's/getWebhookVersion/getIntegrationVersion/g' api.ts
sed -i '' 's/createWebhookVersion/createIntegrationVersion/g' api.ts
sed -i '' 's/updateWebhookVersion/updateIntegrationVersion/g' api.ts
sed -i '' 's/deleteWebhookVersion/deleteIntegrationVersion/g' api.ts
sed -i '' 's/setDefaultWebhookVersion/setDefaultIntegrationVersion/g' api.ts
sed -i '' 's/activateWebhookVersion/activateIntegrationVersion/g' api.ts
sed -i '' 's/rollbackWebhookVersion/rollbackIntegrationVersion/g' api.ts
sed -i '' 's/compareWebhookVersions/compareIntegrationVersions/g' api.ts
sed -i '' 's/getWebhookCompatibilityMatrix/getIntegrationCompatibilityMatrix/g' api.ts
sed -i '' 's/createWebhookFromTemplate/createIntegrationFromTemplate/g' api.ts
sed -i '' 's/serializeWebhookInput/serializeIntegrationInput/g' api.ts
sed -i '' 's/getWebhookById/getIntegrationById/g' api.ts
sed -i '' 's/getWebhooks/getIntegrations/g' api.ts
sed -i '' 's/createWebhook/createIntegration/g' api.ts
sed -i '' 's/updateWebhook/updateIntegration/g' api.ts
sed -i '' 's/deleteWebhook/deleteIntegration/g' api.ts
sed -i '' 's/duplicateWebhook/duplicateIntegration/g' api.ts
sed -i '' 's/testWebhook/testIntegration/g' api.ts
sed -i '' 's/deleteScheduledIntegration/deleteScheduledIntegration/g' api.ts
sed -i '' 's/bulkDeleteScheduledIntegrations/bulkDeleteScheduledIntegrations/g' api.ts

echo "Renaming complete"
