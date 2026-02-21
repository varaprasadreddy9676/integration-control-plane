/**
 * Event Import Service
 *
 * Handles parsing of CSV, Excel, and JSON files for bulk event import
 */

const XLSX = require('xlsx');

/**
 * Parse uploaded file into events array
 * @param {Object} file - Multer file object with buffer and originalname
 * @returns {Object} { events: Array, errors: Array }
 */
async function parseImportFile(file) {
  const ext = file.originalname.split('.').pop().toLowerCase();

  if (ext === 'json') {
    return parseJSON(file.buffer);
  } else if (['csv', 'xlsx', 'xls'].includes(ext)) {
    return parseSpreadsheet(file.buffer);
  } else {
    throw new Error('Unsupported file format');
  }
}

/**
 * Parse JSON buffer into events array
 * @param {Buffer} buffer - File buffer
 * @returns {Object} { events: Array, errors: Array }
 */
function parseJSON(buffer) {
  try {
    const data = JSON.parse(buffer.toString('utf-8'));
    let events = [];

    if (data.events && Array.isArray(data.events)) {
      events = data.events;
    } else if (Array.isArray(data)) {
      events = data;
    } else {
      throw new Error('JSON must contain an "events" array or be an array');
    }

    return { events, errors: [] };
  } catch (error) {
    throw new Error(`Invalid JSON: ${error.message}`);
  }
}

/**
 * Parse CSV/Excel spreadsheet into events array
 * @param {Buffer} buffer - File buffer
 * @returns {Object} { events: Array, errors: Array }
 */
function parseSpreadsheet(buffer) {
  try {
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(worksheet);

    const events = [];
    const errors = [];

    rows.forEach((row, i) => {
      const rowNum = i + 2; // Excel row number (accounting for header)

      try {
        // Flexible column name matching (camelCase, snake_case, PascalCase)
        const eventType = row.eventType || row.event_type || row.EventType;
        const orgId = parseInt(
          row.orgId || row.org_id || row.OrgId,
          10
        );
        const payloadRaw = row.payload || row.Payload;

        // Validate required fields
        if (!eventType || !orgId || !payloadRaw) {
          errors.push({
            row: rowNum,
            error: 'Missing required fields: eventType, orgId, payload'
          });
          return;
        }

        // Validate orgId is a valid number
        if (isNaN(orgId)) {
          errors.push({
            row: rowNum,
            error: 'orgId must be a valid number'
          });
          return;
        }

        // Parse payload (JSON string or object)
        let payload;
        try {
          payload = typeof payloadRaw === 'string'
            ? JSON.parse(payloadRaw)
            : payloadRaw;
        } catch (e) {
          errors.push({
            row: rowNum,
            error: `Invalid payload JSON: ${e.message}`
          });
          return;
        }

        // Build event object
        events.push({
          eventType,
          orgId,
          payload,
          source: row.source || row.Source || 'BULK_IMPORT',
          sourceId: row.sourceId || row.source_id || row.SourceId
        });

      } catch (error) {
        errors.push({
          row: rowNum,
          error: error.message
        });
      }
    });

    return { events, errors };
  } catch (error) {
    throw new Error(`Failed to parse spreadsheet: ${error.message}`);
  }
}

/**
 * Generate import template file in specified format
 * @param {String} format - 'csv', 'xlsx', or 'json'
 * @returns {Buffer} File buffer
 */
function generateImportTemplate(format) {
  const sampleData = [
    {
      eventType: 'APPOINTMENT_SCHEDULED',
      orgId: 12345,
      payload: JSON.stringify({
        patientRid: 100,
        doctorId: 50,
        appointmentDate: '2024-03-20',
        clinicId: 5
      }),
      source: 'BULK_IMPORT',
      sourceId: 'optional-tracking-id'
    },
    {
      eventType: 'LAB_RESULT',
      orgId: 12345,
      payload: JSON.stringify({
        patientRid: 100,
        testId: 200,
        status: 'COMPLETED',
        resultDate: '2024-03-21'
      }),
      source: 'BULK_IMPORT',
      sourceId: 'optional-tracking-id-2'
    }
  ];

  if (format === 'json') {
    // Generate JSON template with example events
    const jsonTemplate = {
      events: sampleData.map(item => ({
        ...item,
        payload: JSON.parse(item.payload) // Convert payload back to object for JSON
      }))
    };
    return Buffer.from(JSON.stringify(jsonTemplate, null, 2));
  }

  // Generate spreadsheet template
  const ws = XLSX.utils.json_to_sheet(sampleData);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Events');

  return XLSX.write(wb, {
    type: 'buffer',
    bookType: format === 'csv' ? 'csv' : 'xlsx'
  });
}

module.exports = {
  parseImportFile,
  generateImportTemplate
};
