const { MongoClient } = require('mongodb');

const uri = process.env.TEST_MONGODB_URI || 'mongodb://localhost:27017/integration_gateway';

async function checkConnections() {
  try {
    const client = new MongoClient(uri);
    await client.connect();
    const db = client.db('admin');
    
    const serverStatus = await db.command({ serverStatus: 1 });
    const currentConnections = serverStatus.connections;
    
    console.log('MongoDB Connection Stats:');
    console.log('- Current:', currentConnections.current);
    console.log('- Available:', currentConnections.available);
    console.log('- Total Created:', currentConnections.totalCreated);
    console.log('');
    
    const activeConns = await db.command({ currentOp: true });
    console.log('Active Operations:', activeConns.inprog.length);
    
    await client.close();
  } catch (error) {
    console.error('Error:', error.message);
  }
}

checkConnections();
