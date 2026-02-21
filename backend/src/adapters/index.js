/**
 * Event Source Adapters
 *
 * Export all event source adapters for easy importing
 */

const { EventSourceAdapter } = require('./EventSourceAdapter');
const { MysqlEventSource } = require('./MysqlEventSource');
// Note: KafkaEventSource is NOT exported because it requires 'kafkajs' package
// which is not in dependencies. Add kafkajs to package.json before enabling.
// const { KafkaEventSource } = require('./KafkaEventSource');

module.exports = {
  EventSourceAdapter,
  MysqlEventSource
  // KafkaEventSource - Uncomment when kafkajs dependency is added
};
