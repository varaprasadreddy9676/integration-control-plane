/**
 * AI Configuration Management CLI
 *
 * Usage:
 *   node src/scripts/manage-ai-config.js enable <entityParentRid>
 *   node src/scripts/manage-ai-config.js disable <entityParentRid>
 *   node src/scripts/manage-ai-config.js check <entityParentRid>
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
  node src/scripts/manage-ai-config.js <command> [entityParentRid]

Commands:
  enable <entityParentRid>   - Enable AI Assistant for entity
  disable <entityParentRid>  - Disable AI Assistant for entity
  check <entityParentRid>    - Check AI status for entity
  list                       - List all AI configurations

Examples:
  node src/scripts/manage-ai-config.js enable 100
  node src/scripts/manage-ai-config.js disable 200
  node src/scripts/manage-ai-config.js check 100
  node src/scripts/manage-ai-config.js list
`;

async function main() {
  const command = process.argv[2];
  const entityParentRid = parseInt(process.argv[3]);

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
        if (!entityParentRid) {
          console.error('Error: entityParentRid is required');
          console.log(USAGE);
          process.exit(1);
        }
        await aiConfig.enableAIForEntity(entityParentRid);
        console.log(`✓ AI Assistant ENABLED for entity ${entityParentRid}`);
        break;

      case 'disable':
        if (!entityParentRid) {
          console.error('Error: entityParentRid is required');
          console.log(USAGE);
          process.exit(1);
        }
        await aiConfig.disableAIForEntity(entityParentRid);
        console.log(`✓ AI Assistant DISABLED for entity ${entityParentRid}`);
        break;

      case 'check':
        if (!entityParentRid) {
          console.error('Error: entityParentRid is required');
          console.log(USAGE);
          process.exit(1);
        }
        const enabled = await aiConfig.isAIEnabledForEntity(entityParentRid);
        console.log(`Entity ${entityParentRid}: AI Assistant is ${enabled ? 'ENABLED' : 'DISABLED'}`);
        break;

      case 'list':
        const configs = await aiConfig.getAllAIConfigurations();
        if (configs.length === 0) {
          console.log('No entity-specific AI configurations found.');
          console.log('(AI is enabled by default for all entities unless explicitly disabled)');
        } else {
          console.log('Entity-Specific AI Configurations:');
          console.log('─'.repeat(50));
          configs.forEach((config) => {
            const status = config.aiEnabled ? '✓ ENABLED' : '✗ DISABLED';
            console.log(`Entity ${config.entityParentRid}: ${status}`);
          });
        }
        break;

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
