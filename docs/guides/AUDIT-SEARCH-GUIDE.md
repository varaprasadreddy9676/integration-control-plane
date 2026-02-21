# Audit Log Full-Text Search Guide

## Overview

The audit system now supports **comprehensive full-text search** across all audit log fields, including nested objects like `changes` (before/after data) and `metadata`. This enables users to find any audit record by searching for any text content within the entire document.

## Features

### ✅ Searchable Fields

The search covers **all** audit log fields:

**Direct Fields:**
- `action` - Action type (e.g., "integration_created", "user_updated")
- `resourceType` - Resource type (e.g., "integration", "user", "template")
- `resourceId` - Resource identifier (IDs, names)
- `userEmail` - User who performed the action
- `userRole` - User's role (SUPER_ADMIN, ORG_ADMIN, etc.)
- `userId` - User identifier
- `ipAddress` - IP address of the request
- `errorMessage` - Error details (if action failed)
- `userAgent` - Browser/client information

**Nested Objects (Searchable via JSON content):**
- `changes.before` - Complete "before" state of modified data
- `changes.after` - Complete "after" state of modified data
- `metadata` - Additional context and details

### ✅ Performance Optimizations

**MongoDB Text Index:**
- Full-text index created on `searchableText` field
- Fast search even on millions of records
- Case-insensitive search
- Automatic fallback to regex if index unavailable

**Search Ranking:**
- Results ranked by relevance using MongoDB text score
- Most relevant matches appear first
- Secondary sort by timestamp (newest first)

### ✅ Organization Scoping

**Automatic Data Isolation:**
- ORG_ADMIN users automatically see only their org's audit logs
- SUPER_ADMIN/ADMIN can search across all organizations
- Org scoping enforced server-side (cannot be bypassed)

## Usage Examples

### Basic Search

**Find by user email:**
```
Search: john@example.com
```
Returns all actions performed by or affecting john@example.com

**Find by action type:**
```
Search: integration_created
```
Returns all integration creation events

**Find by resource ID:**
```
Search: 507f1f77bcf86cd799439011
```
Returns all actions affecting that specific resource

**Find by IP address:**
```
Search: 192.168.1.100
```
Returns all actions from that IP

### Advanced Search (Content in Changes)

**Find who changed an email address:**
```
Search: newemail@company.com
```
Searches inside `changes.before` and `changes.after` - finds when this email was set

**Find rate limit changes:**
```
Search: maxRequests
```
Finds all rate limit configuration changes

**Find specific integration name changes:**
```
Search: Payment Gateway
```
Finds all actions affecting integrations with "Payment Gateway" in the name

**Find error messages:**
```
Search: permission denied
```
Finds all failed actions with "permission denied" in error message

### Combined with Filters

**Search + Date Range:**
```
Search: user_updated
Date Range: 2024-01-01 to 2024-01-31
```
Finds all user updates in January 2024

**Search + Action Filter:**
```
Search: ratelimit
Action: integration_updated
```
Finds integration updates related to rate limits

**Search + Success Filter:**
```
Search: authentication
Success: false
```
Finds all failed authentication-related actions

## API Usage

### REST API

**Endpoint:** `GET /api/v1/admin/audit/logs`

**Query Parameters:**
```javascript
{
  search: "search term",      // Full-text search
  startDate: "2024-01-01",    // Optional date range
  endDate: "2024-12-31",      // Optional date range
  action: "user_created",     // Optional action filter
  resourceType: "user",       // Optional resource filter
  success: true,              // Optional success filter
  page: 1,                    // Pagination
  limit: 50                   // Results per page
}
```

**Example Request:**
```bash
curl -X GET "https://api.example.com/api/v1/admin/audit/logs?search=integration_updated&limit=100" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

**Response:**
```json
{
  "logs": [
    {
      "_id": "...",
      "timestamp": "2024-01-15T10:30:00Z",
      "action": "integration_updated",
      "resourceType": "integration",
      "resourceId": "507f1f77bcf86cd799439011",
      "userEmail": "admin@example.com",
      "userRole": "ORG_ADMIN",
      "changes": {
        "before": { "name": "Old Name", "isActive": true },
        "after": { "name": "New Name", "isActive": true }
      },
      "success": true,
      "score": 1.5  // Text search relevance score (only when searching)
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 50,
    "total": 150,
    "totalPages": 3
  }
}
```

## Migration

### For Existing Installations

If you have existing audit logs, run the migration script to make them searchable:

```bash
cd backend
node migrate-audit-search.js
```

**Migration Process:**
1. Processes existing audit logs in batches of 1000
2. Adds `searchableText` field to each record
3. Creates MongoDB text index
4. Shows progress and completion stats

**Expected Output:**
```
Starting audit log migration...
Found 15847 audit logs to migrate
Processed 1000/15847 (6%)
Processed 2000/15847 (13%)
...
Processed 15847/15847 (100%)

✓ Migration completed successfully
  - Total processed: 15847
  - Total updated: 15847
  - Duration: 12.34s

Creating text index on searchableText field...
✓ Text index created successfully

✓ Migration complete! Full-text search is now available on all audit logs.
```

### For New Installations

No migration needed. The `searchableText` field is automatically populated for all new audit logs.

## Performance Characteristics

### Search Speed

**With Text Index (Recommended):**
- Search across 1M records: ~50-200ms
- Search across 10M records: ~100-500ms
- Scales logarithmically with dataset size

**Without Text Index (Fallback):**
- Search across 1M records: ~2-5 seconds
- Search across 10M records: ~10-30 seconds
- Scales linearly with dataset size

### Storage Impact

**Additional Storage:**
- `searchableText` field adds ~500-2000 bytes per audit log
- Text index adds ~10-20% of collection size
- Example: 1M audit logs = ~500MB-2GB additional storage

### Optimization Tips

1. **Use date range filters** when possible to reduce search scope
2. **Be specific** with search terms (shorter = faster)
3. **Combine filters** to narrow results before searching
4. **Monitor index usage** using MongoDB profiler

## Troubleshooting

### Search Returns No Results

**Check:**
1. Date range filters not excluding data
2. Org scoping (ORG_ADMIN users only see their org)
3. Case sensitivity (search is case-insensitive)
4. Search term spelling

### Search is Slow

**Solutions:**
1. Verify text index exists: `db.audit_logs.getIndexes()`
2. Run migration script if not done
3. Add date range filter to reduce scope
4. Check MongoDB server load

### Text Index Creation Failed

**Error:** "Index build failed"

**Solution:**
```javascript
// Drop existing conflicting indexes
db.audit_logs.dropIndex("audit_fulltext_search")

// Recreate index
db.audit_logs.createIndex(
  { searchableText: "text" },
  { name: "audit_fulltext_search", background: true }
)
```

## Technical Details

### searchableText Field Structure

The `searchableText` field is a space-separated concatenation of all searchable content:

```javascript
searchableText = [
  action,
  resourceType,
  resourceId,
  userEmail,
  userRole,
  userId,
  ipAddress,
  errorMessage,
  userAgent,
  JSON.stringify(changes.before),
  JSON.stringify(changes.after),
  JSON.stringify(metadata)
].join(' ')
```

### MongoDB Text Search Operator

```javascript
// Primary search (uses text index)
db.audit_logs.find({
  $text: { $search: "search term" },
  orgId: 123  // Additional filters
})
.sort({ score: { $meta: "textScore" }, timestamp: -1 })
```

### Fallback Regex Search

If text index unavailable:

```javascript
db.audit_logs.find({
  $or: [
    { userEmail: { $regex: "search term", $options: "i" } },
    { action: { $regex: "search term", $options: "i" } },
    { resourceType: { $regex: "search term", $options: "i" } },
    { resourceId: { $regex: "search term", $options: "i" } },
    { errorMessage: { $regex: "search term", $options: "i" } },
    { ipAddress: { $regex: "search term", $options: "i" } },
    { userRole: { $regex: "search term", $options: "i" } },
    { userId: { $regex: "search term", $options: "i" } },
    { searchableText: { $regex: "search term", $options: "i" } }
  ],
  orgId: 123
})
```

## Security Considerations

✅ **Data Isolation:** ORG_ADMIN users cannot search other orgs' audit logs
✅ **No SQL Injection:** All search terms properly escaped by MongoDB
✅ **No Code Execution:** Search is text-only, no script execution
✅ **Rate Limiting:** Standard API rate limits apply to search endpoint
✅ **Audit Trail:** Search queries themselves can be logged if needed

## Future Enhancements

Potential improvements:
- Fuzzy search (typo tolerance)
- Search query suggestions
- Saved search filters
- Search history
- Advanced query syntax (AND, OR, NOT operators)
- Export search results directly
