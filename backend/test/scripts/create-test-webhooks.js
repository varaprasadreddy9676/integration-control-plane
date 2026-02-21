const http = require('http');
const fs = require('fs');

const API_KEY = 'mdcs_dev_key_1f4a';

async function createWebhook(configFile) {
  const config = JSON.parse(fs.readFileSync(configFile, 'utf8'));

  return new Promise((resolve, reject) => {
    const data = JSON.stringify(config);

    const options = {
      hostname: 'localhost',
      port: 4000,
      path: '/api/v1/webhooks?entityParentRid=33',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': API_KEY,
        'Content-Length': data.length
      }
    };

    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => {
        const response = JSON.parse(body);
        if (res.statusCode === 201) {
          console.log(`✅ Created: ${config.name}`);
          console.log(`   ID: ${response.id}`);
          console.log(`   Mode: ${config.transformationMode}`);
          resolve(response);
        } else {
          console.log(`❌ Failed: ${config.name}`);
          console.log(`   Error:`, response);
          reject(response);
        }
      });
    });

    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function main() {
  console.log('\n📋 Creating 3 webhooks for advanced scenario testing...\n');

  const webhook1 = await createWebhook('/tmp/webhook_script_transform.json');
  const webhook2 = await createWebhook('/tmp/webhook_simple_transform.json');
  const webhook3 = await createWebhook('/tmp/webhook_raw_forward.json');

  console.log('\n✅ All 3 webhooks created successfully!');
  console.log('\n📌 Webhook Summary:');
  console.log('   1. SCRIPT Transformation - CRM Integration');
  console.log('      • Transforms patient data with JavaScript');
  console.log('      • Calculates age and age group');
  console.log('      • Adds priority flags');
  console.log('      • Target: https://httpbin.org/post\n');
  console.log('   2. SIMPLE Transformation - Analytics System');
  console.log('      • Maps fields (patientRID → patient_id, etc.)');
  console.log('      • Adds static metadata fields');
  console.log('      • Target: https://httpbin.org/anything/analytics\n');
  console.log('   3. Raw Data Forwarder - Data Lake');
  console.log('      • Forwards original payload');
  console.log('      • Adds ingestion timestamp');
  console.log('      • Target: https://httpbin.org/anything/datalake\n');

  return { webhook1, webhook2, webhook3 };
}

main().catch(console.error);
