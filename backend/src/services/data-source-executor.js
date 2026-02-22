const { getConnection } = require('../db');
const mysql = require('mysql2/promise');
const { getDb } = require('../mongodb');
const axios = require('axios');
const { log } = require('../logger');
const { MongoClient } = require('mongodb');

/**
 * Data Source Executor Service
 * Executes queries against SQL, MongoDB, or API data sources
 * with variable substitution support
 */

/**
 * Variable substitution helpers
 */
const getVariableValue = (variable, context) => {
  // Config variables: {{config.orgId}}
  if (variable.startsWith('config.')) {
    const key = variable.substring(7);
    return context.config[key];
  }

  // Date helpers: {{date.today()}}, {{date.yesterday()}}
  if (variable.startsWith('date.')) {
    const func = variable.substring(5);
    const now = new Date();

    switch (func) {
      case 'today()':
        return now.toISOString().split('T')[0];
      case 'yesterday()': {
        const yesterday = new Date(now);
        yesterday.setDate(yesterday.getDate() - 1);
        return yesterday.toISOString().split('T')[0];
      }
      case 'todayStart()':
        return new Date(now.setHours(0, 0, 0, 0)).toISOString();
      case 'todayEnd()':
        return new Date(now.setHours(23, 59, 59, 999)).toISOString();
      case 'now()':
        return now.toISOString();
      case 'timestamp()':
        return now.getTime();
      default:
        return variable;
    }
  }

  // Environment variables: {{env.VAR_NAME}}
  if (variable.startsWith('env.')) {
    const key = variable.substring(4);
    return process.env[key];
  }

  return variable;
};

/**
 * Replace variables in a string
 * Supports: {{config.key}}, {{date.today()}}, {{env.VAR}}
 */
const replaceVariables = (str, context) => {
  if (typeof str !== 'string') return str;

  return str.replace(/\{\{([^}]+)\}\}/g, (match, variable) => {
    const value = getVariableValue(variable.trim(), context);
    return value !== undefined ? value : match;
  });
};

/**
 * Execute SQL query with variable substitution
 */
const buildSqlConnectionOptions = (dataSourceConfig, context) => {
  const hostRaw = dataSourceConfig.host || dataSourceConfig.hostname;
  if (!hostRaw) return null;

  const host = replaceVariables(String(hostRaw), context);
  const port =
    dataSourceConfig.port !== undefined && dataSourceConfig.port !== null
      ? Number(replaceVariables(String(dataSourceConfig.port), context))
      : undefined;
  const userRaw = dataSourceConfig.username || dataSourceConfig.user;
  const user = userRaw ? replaceVariables(String(userRaw), context) : undefined;
  const password = dataSourceConfig.password ? replaceVariables(String(dataSourceConfig.password), context) : undefined;
  const database = dataSourceConfig.database ? replaceVariables(String(dataSourceConfig.database), context) : undefined;

  return {
    host,
    ...(port ? { port } : {}),
    ...(user ? { user } : {}),
    ...(password ? { password } : {}),
    ...(database ? { database } : {}),
  };
};

const executeSqlQuery = async (dataSourceConfig, context) => {
  let connection;
  let closeConnection = async () => {};
  const externalConnectionOptions = buildSqlConnectionOptions(dataSourceConfig, context);
  const isExternal = !!dataSourceConfig.connectionString || !!externalConnectionOptions;

  try {
    if (isExternal) {
      if (dataSourceConfig.connectionString) {
        const connectionString = replaceVariables(dataSourceConfig.connectionString, context);
        connection = await mysql.createConnection(connectionString);
      } else {
        connection = await mysql.createConnection(externalConnectionOptions);
      }
      closeConnection = async () => {
        try {
          await connection.end();
        } catch (err) {
          log('warn', 'Failed to close external SQL connection', { error: err.message });
        }
      };
    } else {
      connection = await getConnection();
      closeConnection = async () => {
        try {
          if (typeof connection.release === 'function') {
            connection.release();
          }
        } catch (err) {
          log('warn', 'Failed to release SQL connection', { error: err.message });
        }
      };
    }

    // Replace variables in query
    const query = replaceVariables(dataSourceConfig.query, context);

    const orgId = context.config.orgId;
    log('info', 'Executing SQL query', {
      query: `${query.substring(0, 100)}...`,
      orgId,
      isExternal,
    });

    const [rows] = await connection.query(query);

    log('info', 'SQL query executed successfully', {
      rowCount: rows.length,
      orgId,
      isExternal,
    });

    return rows;
  } catch (error) {
    log('error', 'SQL query execution failed', {
      error: error.message,
      query: `${dataSourceConfig.query.substring(0, 100)}...`,
      isExternal,
    });
    throw new Error(`SQL query failed: ${error.message}`);
  } finally {
    await closeConnection();
  }
};

/**
 * Execute MongoDB aggregation with variable substitution
 * Supports both internal DB (no connectionString) and external MongoDB (with connectionString)
 */
const executeMongoQuery = async (dataSourceConfig, context) => {
  let client = null;
  let db;

  try {
    // Check if external MongoDB connection string is provided
    if (dataSourceConfig.connectionString) {
      // External MongoDB connection
      const connectionString = replaceVariables(dataSourceConfig.connectionString, context);
      const databaseName = dataSourceConfig.database || 'test';

      log('info', 'Connecting to external MongoDB', {
        database: databaseName,
        orgId: context.config.orgId,
      });

      client = new MongoClient(connectionString, {
        serverSelectionTimeoutMS: 5000,
        socketTimeoutMS: 30000,
      });

      await client.connect();
      db = client.db(databaseName);
    } else {
      // Use application's internal MongoDB
      db = await getDb();
    }

    // Replace variables in pipeline (parse as JSON, replace, stringify)
    let pipeline = JSON.parse(JSON.stringify(dataSourceConfig.pipeline));

    // Recursively replace variables in pipeline
    const replaceInObject = (obj) => {
      if (Array.isArray(obj)) {
        return obj.map(replaceInObject);
      } else if (typeof obj === 'object' && obj !== null) {
        const result = {};
        for (const key in obj) {
          result[key] = replaceInObject(obj[key]);
        }
        return result;
      } else if (typeof obj === 'string') {
        return replaceVariables(obj, context);
      }
      return obj;
    };

    pipeline = replaceInObject(pipeline);

    log('info', 'Executing MongoDB aggregation', {
      collection: dataSourceConfig.collection,
      database: dataSourceConfig.database || 'internal',
      stages: pipeline.length,
      isExternal: !!dataSourceConfig.connectionString,
      orgId: context.config.orgId,
    });

    const collection = db.collection(dataSourceConfig.collection);
    const results = await collection.aggregate(pipeline).toArray();

    log('info', 'MongoDB aggregation executed successfully', {
      resultCount: results.length,
      orgId: context.config.orgId,
    });

    return results;
  } catch (error) {
    log('error', 'MongoDB aggregation failed', {
      error: error.message,
      collection: dataSourceConfig.collection,
      database: dataSourceConfig.database,
      isExternal: !!dataSourceConfig.connectionString,
    });
    throw new Error(`MongoDB query failed: ${error.message}`);
  } finally {
    // Close external connection if opened
    if (client) {
      try {
        await client.close();
      } catch (err) {
        log('warn', 'Failed to close MongoDB connection', { error: err.message });
      }
    }
  }
};

/**
 * Execute API call with variable substitution
 */
const executeApiCall = async (dataSourceConfig, context) => {
  try {
    // Replace variables in URL and body
    const url = replaceVariables(dataSourceConfig.url, context);
    const method = dataSourceConfig.method || 'GET';

    const requestConfig = {
      method,
      url,
      headers: dataSourceConfig.headers || {},
      timeout: 30000,
    };

    // Replace variables in headers
    for (const key in requestConfig.headers) {
      requestConfig.headers[key] = replaceVariables(requestConfig.headers[key], context);
    }

    // Add body for POST/PUT
    if (dataSourceConfig.body && ['POST', 'PUT', 'PATCH'].includes(method)) {
      const body = JSON.parse(JSON.stringify(dataSourceConfig.body));

      // Recursively replace variables
      const replaceInObject = (obj) => {
        if (Array.isArray(obj)) {
          return obj.map(replaceInObject);
        } else if (typeof obj === 'object' && obj !== null) {
          const result = {};
          for (const key in obj) {
            result[key] = replaceInObject(obj[key]);
          }
          return result;
        } else if (typeof obj === 'string') {
          return replaceVariables(obj, context);
        }
        return obj;
      };

      requestConfig.data = replaceInObject(body);
    }

    log('info', 'Executing API call', {
      url,
      method,
      orgId: context.config.orgId,
    });

    const response = await axios(requestConfig);

    log('info', 'API call executed successfully', {
      url,
      status: response.status,
      orgId: context.config.orgId,
    });

    return response.data;
  } catch (error) {
    log('error', 'API call failed', {
      error: error.message,
      url: dataSourceConfig.url,
    });
    throw new Error(`API call failed: ${error.message}`);
  }
};

/**
 * Main executor function
 * Routes to appropriate handler based on data source type
 */
const executeDataSource = async (dataSourceConfig, integrationConfig) => {
  const context = {
    config: {
      orgId: integrationConfig.orgId,
      integrationId: integrationConfig._id,
      integrationName: integrationConfig.name,
    },
  };

  switch (dataSourceConfig.type) {
    case 'SQL':
      return await executeSqlQuery(dataSourceConfig, context);

    case 'MONGODB':
      return await executeMongoQuery(dataSourceConfig, context);

    case 'API':
      return await executeApiCall(dataSourceConfig, context);

    default:
      throw new Error(`Unsupported data source type: ${dataSourceConfig.type}`);
  }
};

module.exports = {
  executeDataSource,
  replaceVariables, // Export for testing
};
