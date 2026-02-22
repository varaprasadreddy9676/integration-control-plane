/**
 * AI Configuration Management CLI
 *
 * Usage:
 *   node src/scripts/manage-ai-config.js enable <orgId>
 *   node src/scripts/manage-ai-config.js disable <orgId>
 *   node src/scripts/manage-ai-config.js check <orgId>
 *   node src/scripts/manage-ai-config.js list
 *
 * Examples:
 *   node src/scripts/manage-ai-config.js enable 100
 *   node src/scripts/manage-ai-config.js disable 200
 *   node src/scripts/manage-ai-config.js check 100
 *   node src/scripts/manage-ai-config.js list
 */

const mongodb = require('../mongodb');
const aiConfig = require('../data/ai-config');

const USAGE = `
AI Configuration Management CLI

Usage:
  node src/scripts/manage-ai-config.js <command> [orgId]

Commands:
  enable <orgId>   - Enable AI Assistant for org
  disable <orgId>  - Disable AI Assistant for org
  check <orgId>    - Check AI status for org
  list                       - List all AI configurations

Examples:
  node src/scripts/manage-ai-config.js enable 100
  node src/scripts/manage-ai-config.js disable 200
  node src/scripts/manage-ai-config.js check 100
  node src/scripts/manage-ai-config.js list
`;

async function main() {
  const command = process.argv[2];
  const orgId = parseInt(process.argv[3], 10);

  if (!command) {
    console.log(USAGE);
    process.exit(0);
  }

  try {
    // Connect to MongoDB
    await mongodb.connect();
    console.log('✓ Connected to MongoDB\n');

    switch (command) {
      case 'enable':
        if (!orgId) {
          console.error('Error: orgId is required');
          console.log(USAGE);
          process.exit(1);
        }
        await aiConfig.enableAIForEntity(orgId);
        console.log(`✓ AI Assistant ENABLED for org ${orgId}`);
        break;

      case 'disable':
        if (!orgId) {
          console.error('Error: orgId is required');
          console.log(USAGE);
          process.exit(1);
        }
        await aiConfig.disableAIForEntity(orgId);
        console.log(`✓ AI Assistant DISABLED for org ${orgId}`);
        break;

      case 'check': {
        if (!orgId) {
          console.error('Error: orgId is required');
          console.log(USAGE);
          process.exit(1);
        }
        const enabled = await aiConfig.isAIEnabledForEntity(orgId);
        console.log(`Org ${orgId}: AI Assistant is ${enabled ? 'ENABLED' : 'DISABLED'}`);
        break;
      }

      case 'list': {
        const configs = await aiConfig.getAllAIConfigurations();
        if (configs.length === 0) {
          console.log('No org-specific AI configurations found.');
          console.log('(AI is enabled by default for all orgs unless explicitly disabled)');
        } else {
          console.log('Org-Specific AI Configurations:');
          console.log('─'.repeat(50));
          configs.forEach((config) => {
            const status = config.aiEnabled ? '✓ ENABLED' : '✗ DISABLED';
            console.log(`Org ${config.orgId}: ${status}`);
          });
        }
        break;
      }

      default:
        console.error(`Error: Unknown command '${command}'`);
        console.log(USAGE);
        process.exit(1);
    }

    process.exit(0);
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

main();
