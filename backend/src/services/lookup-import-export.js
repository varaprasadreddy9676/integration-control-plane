const XLSX = require('xlsx');
const { log } = require('../logger');

/**
 * Parse Excel/CSV file buffer to lookup entries
 * Supports both simple format (source_id, target_id) and detailed format (with metadata)
 */
function parseImportFile(buffer, type, orgId, orgUnitRid = null, importedFrom = 'import.xlsx') {
  try {
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(worksheet);

    if (rows.length === 0) {
      throw new Error('Import file is empty');
    }

    const lookups = [];
    const errors = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowNum = i + 2; // Excel rows start at 1, header is row 1

      try {
        // Required fields
        const sourceId = row.source_id || row.sourceId || row['Source ID'];
        const targetId = row.target_id || row.targetId || row['Target ID'];

        if (!sourceId || !targetId) {
          errors.push({
            row: rowNum,
            error: 'Missing required fields: source_id and target_id'
          });
          continue;
        }

        // Optional fields
        const sourceName = row.source_name || row.sourceName || row['Source Name'] || null;
        const targetName = row.target_name || row.targetName || row['Target Name'] || null;
        const description = row.description || row.Description || null;
        const category = row.category || row.Category || null;

        // Additional source metadata
        const sourceMetadata = {};
        if (row.source_supplier_code || row.sourceSupplierCode || row['Source Supplier Code']) {
          sourceMetadata.supplierCode = row.source_supplier_code || row.sourceSupplierCode || row['Source Supplier Code'];
        }
        if (row.source_supplier_name || row.sourceSupplierName || row['Source Supplier Name']) {
          sourceMetadata.supplierName = row.source_supplier_name || row.sourceSupplierName || row['Source Supplier Name'];
        }

        const lookup = {
          orgId,
          orgUnitRid,
          type,
          source: {
            id: String(sourceId).trim(),
            name: sourceName ? String(sourceName).trim() : null,
            ...sourceMetadata
          },
          target: {
            id: String(targetId).trim(),
            name: targetName ? String(targetName).trim() : null
          },
          description,
          category,
          importedFrom,
          importedAt: new Date()
        };

        lookups.push(lookup);
      } catch (err) {
        errors.push({
          row: rowNum,
          error: err.message
        });
      }
    }

    log('info', 'Import file parsed', {
      totalRows: rows.length,
      validLookups: lookups.length,
      errors: errors.length
    });

    return {
      lookups,
      errors,
      totalRows: rows.length
    };
  } catch (err) {
    throw new Error(`Failed to parse import file: ${err.message}`);
  }
}

/**
 * Generate Excel export from lookup entries
 */
function generateExportFile(lookups, format = 'xlsx') {
  try {
    // Transform lookups to flat structure for Excel
    const rows = lookups.map(lookup => ({
      'Source ID': lookup.source.id,
      'Source Name': lookup.source.name || '',
      'Source Supplier Code': lookup.source.supplierCode || '',
      'Source Supplier Name': lookup.source.supplierName || '',
      'Target ID': lookup.target.id,
      'Target Name': lookup.target.name || '',
      'Type': lookup.type,
      'Category': lookup.category || '',
      'Description': lookup.description || '',
      'Scope': (lookup.orgUnitRid ?? lookup.entityRid) ? `Org Unit ${lookup.orgUnitRid ?? lookup.entityRid}` : 'Parent',
      'Usage Count': lookup.usageCount || 0,
      'Last Used': lookup.lastUsedAt || '',
      'Active': lookup.isActive ? 'Yes' : 'No',
      'Created': lookup.createdAt || '',
      'Updated': lookup.updatedAt || ''
    }));

    // Create workbook
    const worksheet = XLSX.utils.json_to_sheet(rows);

    // Set column widths
    const colWidths = [
      { wch: 15 }, // Source ID
      { wch: 25 }, // Source Name
      { wch: 20 }, // Source Supplier Code
      { wch: 25 }, // Source Supplier Name
      { wch: 15 }, // Target ID
      { wch: 25 }, // Target Name
      { wch: 12 }, // Type
      { wch: 15 }, // Category
      { wch: 30 }, // Description
      { wch: 12 }, // Scope
      { wch: 12 }, // Usage Count
      { wch: 20 }, // Last Used
      { wch: 8 },  // Active
      { wch: 20 }, // Created
      { wch: 20 }  // Updated
    ];
    worksheet['!cols'] = colWidths;

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Lookups');

    // Generate buffer
    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: format });

    log('info', 'Export file generated', {
      format,
      rowCount: rows.length
    });

    return buffer;
  } catch (err) {
    throw new Error(`Failed to generate export file: ${err.message}`);
  }
}

/**
 * Generate CSV export from lookup entries (simpler format for quick import)
 */
function generateSimpleCSV(lookups) {
  try {
    const rows = lookups.map(lookup => ({
      source_id: lookup.source.id,
      target_id: lookup.target.id
    }));

    const worksheet = XLSX.utils.json_to_sheet(rows);
    const csv = XLSX.utils.sheet_to_csv(worksheet);

    log('info', 'Simple CSV generated', {
      rowCount: rows.length
    });

    return Buffer.from(csv, 'utf-8');
  } catch (err) {
    throw new Error(`Failed to generate CSV: ${err.message}`);
  }
}

/**
 * Generate import template (empty Excel file with headers)
 */
function generateImportTemplate() {
  const headers = [
    { 'Source ID': '', 'Target ID': '', 'Source Name': '', 'Target Name': '', 'Description': '', 'Category': '' }
  ];

  const worksheet = XLSX.utils.json_to_sheet(headers);

  // Set column widths
  worksheet['!cols'] = [
    { wch: 15 }, // Source ID
    { wch: 15 }, // Target ID
    { wch: 25 }, // Source Name
    { wch: 25 }, // Target Name
    { wch: 30 }, // Description
    { wch: 15 }  // Category
  ];

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Lookups');

  const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });

  return buffer;
}

module.exports = {
  parseImportFile,
  generateExportFile,
  generateSimpleCSV,
  generateImportTemplate
};
