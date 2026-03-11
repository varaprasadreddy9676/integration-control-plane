const { randomUUID } = require('crypto');

let queue = [
  {
    id: 1,
    entity_rid: 201,
    event_type: 'PATIENT_REGISTERED',
    payload: {
      patientRID: 9991,
      patientName: 'Queue Sample',
      appointmentDateTime: new Date().toISOString()
    }
  },
  {
    id: 2,
    entity_rid: 100,
    event_type: 'BILL_CREATED',
    payload: {
      billId: 'BILL-1001',
      patientRID: 8888,
      amount: 250
    }
  }
];

function take(limit = 5) {
  const items = queue.slice(0, limit);
  queue = queue.slice(limit);
  return items;
}

function push(event) {
  queue.push({ ...event, id: event.id || randomUUID() });
}

module.exports = { take, push };
