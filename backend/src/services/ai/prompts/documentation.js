/**
 * API documentation analysis prompt builder
 */

const { buildSystemContext } = require('./system-context');

/**
 * Analyze API documentation prompt
 */
async function buildDocumentationAnalysisPrompt(documentation, eventType) {
  const systemContext = buildSystemContext();

  return `${systemContext}

## YOUR TASK

Analyze this API documentation and generate a complete integration configuration for Integration Gateway.

**API DOCUMENTATION**:
\`\`\`
${documentation}
\`\`\`

**SOURCE EVENT TYPE**: ${eventType}

---

## WHAT YOU NEED TO EXTRACT

1. **Target URL** - The API endpoint URL
   - Extract exact URL from documentation
   - If URL has placeholders like {accountId}, keep them and note in "notes"

2. **HTTP Method** - GET, POST, PUT, PATCH, DELETE
   - Most APIs use POST for integrations
   - Check documentation carefully

3. **Authentication** - Determine auth type and extract config
   - **NONE**: No authentication
   - **API_KEY**: Look for "API Key", "X-API-Key", "apikey" in headers or query params
     - authConfig: { "key": "X-API-Key", "value": "{REPLACE}", "in": "header" }
   - **BEARER**: Look for "Bearer Token", "Authorization: Bearer"
     - authConfig: { "token": "{REPLACE_WITH_TOKEN}" }
   - **BASIC**: Look for "Basic Auth", "username/password"
     - authConfig: { "username": "admin", "password": "{REPLACE}" }
   - **CUSTOM_HEADERS**: Multiple custom headers (e.g., CleverTap, Twilio)
     - authConfig: { "headers": { "X-Account-Id": "{REPLACE}", "X-Auth-Token": "{REPLACE}" } }
   - **OAUTH2**: OAuth2 flow
     - authConfig: { "clientId": "{REPLACE}", "clientSecret": "{REPLACE}", "tokenUrl": "https://..." }

4. **Transformation Script** - Generate JavaScript that maps source system event to API payload
   - Use available source system event fields (patient, visit, appt, Bill)
   - Match API's expected payload structure
   - Use optional chaining and fallbacks
   - Keep under 40 lines

5. **Multi-Action** - Does API require multiple sequential calls?
   - Example: CleverTap requires profile upload + event upload (2 separate calls)
   - If yes, create actions array with separate transformations
   - If no, leave actions as empty array

6. **Confidence** - Rate your confidence 0-100
   - 90-100: Complete documentation, high confidence
   - 70-89: Good documentation, minor assumptions
   - 50-69: Partial documentation, significant assumptions
   - <50: Insufficient documentation

7. **Notes** - Important information for the user
   - What needs to be replaced (API keys, account IDs)
   - Any assumptions made
   - Important requirements or limitations

---

## OUTPUT FORMAT

Return ONLY valid JSON (no markdown, no code blocks). Use this exact structure:

\`\`\`json
{
  "targetUrl": "https://api.example.com/v1/endpoint",
  "httpMethod": "POST",
  "authType": "API_KEY",
  "authConfig": {
    "key": "X-API-Key",
    "value": "{REPLACE_WITH_YOUR_API_KEY}",
    "in": "header"
  },
  "transformationScript": "const name = payload.patient?.fullName || '';\\nconst phone = payload.patient?.phone || '';\\nreturn { customerName: name, contactNumber: phone };",
  "actions": [],
  "confidence": 85,
  "notes": "Replace {REPLACE_WITH_YOUR_API_KEY} with your actual API key from the provider dashboard. Phone numbers will be sent as-is without formatting."
}
\`\`\`

**For Multi-Action APIs** (e.g., CleverTap):
\`\`\`json
{
  "targetUrl": "https://in1.api.clevertap.com/1/upload",
  "httpMethod": "POST",
  "authType": "CUSTOM_HEADERS",
  "authConfig": {
    "headers": {
      "X-CleverTap-Account-Id": "{YOUR_ACCOUNT_ID}",
      "X-CleverTap-Passcode": "{YOUR_PASSCODE}",
      "Content-Type": "application/json"
    }
  },
  "actions": [
    {
      "name": "Upload Profile",
      "targetUrl": "https://in1.api.clevertap.com/1/upload",
      "transformationMode": "SCRIPT",
      "transformation": {
        "script": "const identity = payload.patient?.mrn?.documentNumber || payload.patient?.phone || '';\\nreturn { d: [{ identity, type: 'profile', profileData: { Name: payload.patient?.fullName || '' } }] };"
      }
    },
    {
      "name": "Upload Event",
      "targetUrl": "https://in1.api.clevertap.com/1/upload",
      "transformationMode": "SCRIPT",
      "transformation": {
        "script": "const identity = payload.patient?.mrn?.documentNumber || payload.patient?.phone || '';\\nreturn { d: [{ identity, type: 'event', evtName: 'Patient Registered', evtData: { date: payload.datetime } }] };"
      }
    }
  ],
  "confidence": 95,
  "notes": "CleverTap requires two sequential API calls: profile upload first, then event upload. Replace placeholder credentials in authConfig. Identity should use MRN when available, fall back to phone."
}
\`\`\`

NOW ANALYZE THE DOCUMENTATION AND GENERATE THE CONFIGURATION:`;
}

module.exports = {
  buildDocumentationAnalysisPrompt
};
