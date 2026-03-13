# Integration Management Console

React + TypeScript console for managing bi-directional integrations, scheduled batch jobs, delivery logs, and system monitoring.

## Prerequisites
- Node 20+
- Running backend API (`/api/v1`) with a configured API key

## Quick Start
1. **Install dependencies**: `npm install`
2. **Configure `.env`** (copy from `.env.example`):
   - `VITE_API_BASE_URL` - Backend API URL (e.g., `http://localhost:3545/api/v1`)
   - `VITE_API_KEY` - API key matching `security.apiKey` in backend config
   - `VITE_APP_NAME` - Display name (optional, default: Integration Gateway)
3. **Run dev server**: `npm run dev`
4. **Build for production**: `npm run build`

## Architecture

### Tech Stack
- **Frontend**: React 18, TypeScript 5, Vite 5
- **UI Libraries**: Ant Design 5 + Shadcn/RadixUI + TailwindCSS
- **Routing**: React Router 6
- **State Management**: TanStack Query 5 (server state) + React Context (auth/org/theme)
- **Forms**: React Hook Form + @hookform/resolvers
- **HTTP Client**: Axios with interceptors (auth, token refresh, retry)
- **Code Editor**: Monaco Editor (SQL, JS, MongoDB queries)
- **Charts**: Recharts
- **Animations**: Framer Motion + GSAP
- **Flows**: ReactFlow (visual workflow builder)
- **Linting**: Biome (not ESLint/Prettier)

### Project Structure
```
frontend/
├── src/
│   ├── features/           # Feature modules
│   │   ├── dashboard/      # Analytics & monitoring
│   │   ├── integrations/   # OUTBOUND & INBOUND integrations
│   │   ├── scheduled-jobs/ # SCHEDULED batch jobs (NEW)
│   │   ├── logs/           # Delivery logs viewer
│   │   ├── dlq/            # Dead letter queue management
│   │   └── admin/          # Admin operations
│   ├── components/         # Shared components
│   ├── design-system/      # Design tokens & theme
│   ├── services/           # API client
│   └── utils/              # Utilities
├── docs/                   # Documentation
└── public/                 # Static assets
```

## Features

### 1. Dashboard
- **Real-time Metrics**: Success rate, latency, throughput
- **Analytics Charts**: Delivery trends, error analysis, performance
- **Integration Type Tabs**: Separate views for Outbound, Inbound, Scheduled
- **Quick Actions**: Jump to failed deliveries, configure integrations
- **Auto-refresh**: 30-second polling for live updates

### 2. Integrations

#### OUTBOUND (Event-Driven Webhooks)
- **Event-based delivery**: Push events from internal system to external APIs
- **Transformation**: SIMPLE field mapping or SCRIPT (JavaScript)
- **Scheduling**: IMMEDIATE, DELAYED (one-time), or RECURRING
- **Multi-action**: Sequential delivery to multiple endpoints
- **Authentication**: API Key, Bearer, Basic, OAuth2, Custom Headers
- **Rate limiting**: Per-integration rate limits with sliding window

#### INBOUND (Real-Time API Proxy)
- **Request proxying**: Client → Gateway → External API
- **Bi-directional transformation**: Request and response transformation
- **Authentication**: Inbound (from client) + Outbound (to external API)
- **Timeout handling**: Configurable timeouts with retry logic
- **Request Policy**: IP allowlist, browser origin allowlist, and per-integration rate limiting
- **Generic Routed Email**: Sender-profile based inbound email routing with default sender fallback

#### SCHEDULED (Time-Driven Batch Jobs) 🆕
- **Data source support**: SQL (MySQL), MongoDB (internal + external), Internal APIs
- **Flexible scheduling**: Cron expressions or fixed intervals
- **Variable substitution**: `{{config.orgId}}`, `{{date.today()}}`, `{{env.VAR}}`
- **Test before save**: Validate data source configuration with sample data preview
- **External MongoDB**: Connect to any MongoDB instance with connection string
- **Comprehensive logging**: Full execution trace (data fetched → transformed → delivered)

**Key Features**:
- ✅ **Visual Cron Builder**: Hourly, Daily, Weekly, Monthly presets with minute selection
- ✅ **Monaco Editor**: Syntax-highlighted SQL, MongoDB, JavaScript editors
- ✅ **Test Data Source**: Execute queries and preview sample data before saving
- ✅ **Smart Data Display**: Table view for structured data, JSON for complex nested data
- ✅ **Copy to Clipboard**: Copy sample data and queries
- ✅ **Error Troubleshooting**: Context-aware hints based on data source type

### 3. Delivery Logs
- **Advanced Filtering**: Status, date range, event type, integration
- **Full-text Search**: Search across payloads, responses, errors
- **Detailed View**: Complete request/response with headers
- **Execution Trace**: Step-by-step execution flow (especially for SCHEDULED jobs)
- **Curl Command**: Auto-generated curl for manual testing
- **Export**: Download logs as CSV/JSON
- **Pagination**: Efficient loading with infinite scroll

**Scheduled Job Execution Flow** (NEW):
- Timeline view showing:
  1. Data fetched from source (with expandable data preview)
  2. Data transformed (with expandable payload)
  3. HTTP request sent (with curl command, headers, body)
  4. Response received (with full response body)
- Error context showing which stage failed

### 4. Dead Letter Queue (DLQ)
- **Failed Delivery Management**: View and retry failed deliveries
- **Bulk Operations**: Retry up to 100 entries at once
- **Error Analysis**: Group by error category, integration
- **Auto-retry**: Exponential backoff with configurable max retries
- **Abandonment**: Mark entries as abandoned after max retries

### 5. Admin
- **Organization Management**: CRUD operations for orgs and org units
- **User Management**: Create users, assign roles, manage permissions
- **Storage Stats**: Database collection size and storage usage
- **Portal Embedding**: Generate magic links for iframe-embeddable webhook portal
- **Rate Limit Configuration**: Global and per-organization rate limits
- **Audit Logs**: Track all admin actions

### 6. Settings
- **Event Source Settings**: Configure MySQL, Kafka, and HTTP Push per org
- **MySQL Pool Settings**: Runtime-configurable connection pool limits
- **Sender Profiles**: Reusable mailbox/provider profiles for generic inbound email routing
- **Organization Context**: View current organization information
- **Admin Request Policy Tools**: Bulk request-policy / rate-limit operations

### 7. System Monitoring
- **System Status**: Worker health, adapter state, process lifecycle, sender-profile visibility
- **System Logs**: Application logs, access logs, and process-output tail
### 8. Additional Features
- **Integration Versioning**: Full version history with diff view
- **Lookup Tables**: Import/export via XLSX, reverse lookup, statistics
- **Integration Templates**: Reusable configs with one-click deploy
- **Visual Flow Builder**: Drag-and-drop workflow creation (ReactFlow)
- **Bulk Operations**: XLSX import/export, bulk enable/disable
- **Alert Center**: Categorized alerts with trends and statistics
- **Analytics**: Time-series performance metrics and event analytics
- **AI Assistant**: Chat interface with 4 AI provider support per org

## Integration Configuration UI

### CronBuilder Component 🔄
**Recent Improvements**:
- ✅ **Hourly Minute Selection**: Previously hardcoded to minute 0, now selectable (0-59)
- ✅ **Visual Presets**: Hourly, Daily, Weekly, Monthly with clear labels
- ✅ **Real-time Preview**: Shows next execution time
- ✅ **Timezone Support**: Select timezone for cron expression
- ✅ **English Translation**: Human-readable cron expression

**Location**: `src/features/scheduled-jobs/components/CronBuilder.tsx`

### Monaco Editor Integration 🔄
**Recent Fixes**:
- ✅ **Form Persistence**: Editors now properly sync with Ant Design Form
- ✅ **State Management**: Explicit value/onChange props for SQL, MongoDB, JavaScript editors
- ✅ **Auto-save**: Changes immediately reflected in form state
- ✅ **Syntax Highlighting**: SQL, JSON, JavaScript language support

**Implementation Pattern**:
```typescript
const [sqlQuery, setSqlQuery] = useState('');

<Editor
  language="sql"
  value={sqlQuery}
  onChange={(value) => {
    setSqlQuery(value || '');
    form.setFieldValue('sqlQuery', value || '');
  }}
/>
```

### Test Data Source Feature 🆕
**Comprehensive Validation**:
- ✅ **Pre-execution JSON Validation**: Validates MongoDB pipeline and API JSON before sending
- ✅ **Connection Testing**: Actually executes query/API call to verify connectivity
- ✅ **Sample Data Preview**: Returns up to 10 records with smart display
- ✅ **Error Handling**: User-friendly error messages with troubleshooting hints
- ✅ **Copy Functionality**: Copy sample data to clipboard
- ✅ **Re-test**: Test again without closing modal

**Error Handling**:
```
❌ Invalid MongoDB Pipeline JSON: Expected array, got object

💡 Common Issues:
• Verify MongoDB connection string format: mongodb://host:port
• Check database and collection names are correct
• Ensure aggregation pipeline is valid JSON array
```

**Location**: `src/features/scheduled-jobs/routes/ScheduledJobDetailRoute.tsx`

## API Integration

### API Client
**File**: `src/services/api.ts`

**Key Functions**:
- `getAllIntegrations()` - List all integrations (OUTBOUND, INBOUND, SCHEDULED)
- `getIntegrationById(id)` - Get integration details
- `createIntegration(data)` - Create integration
- `updateIntegration(id, data)` - Update integration
- `deleteIntegration(id)` - Delete integration
- `testSchedulingScript(id, payload)` - Test scheduling script
- `getAllScheduledJobs()` - List scheduled jobs
- `createScheduledJob(data)` - Create scheduled job
- `testDataSource(dataSource)` - Test data source configuration 🆕
- `getLogs(filters)` - Get delivery logs
- `getDashboardAnalytics(days)` - Get dashboard metrics

### Authentication
- **Header**: `X-API-Key: <api-key>`
- **Query Parameter**: `orgId=<org-id>` (multi-tenancy)

### Backend Endpoints
```
POST   /api/v1/auth/login                              # User login
GET    /api/v1/outbound-integrations                   # List OUTBOUND integrations
POST   /api/v1/outbound-integrations                   # Create OUTBOUND integration
GET    /api/v1/inbound-integrations                    # List INBOUND integrations
POST   /api/v1/inbound-integrations                    # Create INBOUND integration
GET    /api/v1/scheduled-jobs                          # List SCHEDULED jobs
POST   /api/v1/scheduled-jobs                          # Create SCHEDULED job
POST   /api/v1/scheduled-jobs/test-datasource          # Test data source (NEW)
POST   /api/v1/scheduled-jobs/:id/execute              # Manually execute job
GET    /api/v1/scheduled-jobs/:id/logs                 # Get execution logs
GET    /api/v1/logs                                    # List delivery logs
GET    /api/v1/logs/:id                                # Get log details
GET    /api/v1/dlq                                     # List DLQ entries
POST   /api/v1/dlq/retry                               # Retry failed deliveries
GET    /api/v1/dashboard                               # Dashboard analytics
GET    /api/v1/analytics/overview                      # Analytics overview
GET    /api/v1/analytics/timeseries                    # Time-series data
```

## Development

### Running Locally
```bash
# Install dependencies
npm install

# Start dev server (with HMR)
npm run dev

# Type checking
npx tsc -b --noEmit

# Linting
npm run lint

# Build for production
npm run build

# Preview production build
npm run preview
```

### Environment Variables
```bash
# .env (copy from .env.example)
VITE_API_BASE_URL=http://localhost:3545/api/v1
VITE_API_KEY=your-api-key
VITE_APP_NAME=Integration Gateway
VITE_APP_VERSION=2.0.0
```

### Code Style
- **TypeScript**: Strict mode enabled
- **Formatting + Linting**: Biome (not Prettier or ESLint) — run `npm run check:fix` to auto-fix
- **Naming**: camelCase for variables, PascalCase for components
- **Components**: Functional components with hooks
- **State Management**: TanStack Query for server state, useState/Context for local state

### Performance Optimizations
- **Code Splitting**: Route-based lazy loading
- **Memoization**: useMemo, useCallback for expensive computations
- **Debouncing**: 800ms debounce for real-time API calls
- **Virtual Scrolling**: For large log lists
- **Conditional Rendering**: Render only visible components

## Design System

### Enterprise UI Principles
1. **Clarity**: Information-dense without overwhelming
2. **Efficiency**: Minimize clicks, keyboard shortcuts
3. **Consistency**: Predictable patterns across features
4. **Professional**: Clean, semantic, minimal decoration
5. **Responsive**: Mobile-first, works on all screen sizes

### Design Tokens
**File**: `src/design-system/tokens.ts`

**Colors**:
- Primary: Blue (#4070f4)
- Success: Green (#10b981)
- Error: Red (#ef4444)
- Warning: Amber (#f59e0b)
- Neutral: Gray scale

**Spacing**: 8px base unit (4, 8, 12, 16, 24, 32, 48, 64)

**Typography**: System fonts, 4 sizes (xs, sm, base, lg)

### Component Patterns
- **Tables**: First-class citizen for data display
- **Forms**: Progressive disclosure, tab-based organization
- **Cards**: Semantic grouping with minimal decoration
- **Modals**: For confirmation, details, bulk actions
- **Alerts**: Contextual feedback (success, error, warning, info)

## Testing

### Manual Testing Checklist

**Scheduled Jobs**:
- [ ] Create job with SQL data source → Test data source → View sample data
- [ ] Create job with external MongoDB → Test connection → Verify connectivity
- [ ] Create job with API data source → Test endpoint → Check response
- [ ] Edit SQL query in Monaco Editor → Verify persistence after save
- [ ] Select hourly schedule with minute 30 → Verify cron expression
- [ ] Execute job manually → View execution log → Check execution flow
- [ ] View log details → Expand data fetched → Copy to clipboard

**Integrations**:
- [ ] Create OUTBOUND integration → Test transformation → Verify output
- [ ] Create INBOUND integration → Test request/response transform
- [ ] Edit integration → Change auth type → Save → Verify persistence

**Logs**:
- [ ] Filter by status, date range, integration
- [ ] Search across payloads
- [ ] View log detail → Check curl command → Copy and test manually
- [ ] For SCHEDULED logs, verify execution flow timeline

## Troubleshooting

### Common Issues

**Monaco Editor not saving**:
- Ensure `value` and `onChange` props are set
- Check form field name matches `setFieldValue` call
- Verify useEffect populates initial value

**Test Data Source failing**:
- Check backend is running
- Verify API endpoint: `POST /scheduled-jobs/test-datasource`
- Check network tab for error response
- Validate JSON syntax for MongoDB pipeline/API headers

**Cron Builder not showing minute selection**:
- Ensure frequency is set to "hourly"
- Check TimePicker format prop is set correctly
- Verify cron expression updates on change

**Form not submitting**:
- Check browser console for validation errors
- Verify all required fields are filled
- Check network tab for 400/500 errors

### Debug Mode
```typescript
// Enable React Query devtools
import { ReactQueryDevtools } from '@tanstack/react-query-devtools'

<ReactQueryDevtools initialIsOpen={false} />
```

## Documentation

- [SCHEDULED_JOBS.md](../SCHEDULED_JOBS.md) - Complete scheduled jobs documentation
- [ARCHITECTURE.md](../ARCHITECTURE.md) - System architecture overview
- [SCHEDULING-UI-IMPLEMENTATION.md](./SCHEDULING-UI-IMPLEMENTATION.md) - Scheduling UI features
- [DATA_SOURCE_EXECUTOR.md](../backend/docs/DATA_SOURCE_EXECUTOR.md) - Data source executor technical doc

## Contributing

### Pull Request Process
1. Create feature branch from `main`
2. Make changes with clear commit messages
3. Run `npx tsc -b --noEmit` and `npm run lint`
4. Test manually (see Testing section)
5. Create PR with description of changes
6. Request review from team

### Commit Message Format
```
feat: add test data source feature
fix: monaco editor not persisting values
docs: update README with recent changes
refactor: extract cron builder to separate component
```

## Recent Updates

### Version 2.1.0 (Latest)
- ✅ **SCHEDULED Jobs Feature**: Complete E2E implementation
- ✅ **Test Data Source**: Pre-validation with sample data preview
- ✅ **External MongoDB Support**: Connect to any MongoDB instance
- ✅ **CronBuilder Improvements**: Hourly minute selection
- ✅ **Monaco Editor Fixes**: Proper form persistence
- ✅ **Enhanced Logging**: Full execution trace with curl commands
- ✅ **Smart Data Display**: Table view for structured data
- ✅ **Error Handling**: Context-aware troubleshooting hints

### Version 2.0.0
- ✅ **Dashboard Tabs**: Separate views for Outbound, Inbound, Scheduled
- ✅ **INBOUND Integrations**: Complete UI implementation
- ✅ **Real-time Analytics**: Live charts and metrics
- ✅ **DLQ Management**: Bulk retry operations

## License

[GNU Affero General Public License v3.0](../LICENSE)

## Support

For questions or issues:
- Create GitHub issue with detailed description
- Include browser console errors
- Attach screenshots if UI issue
- Provide steps to reproduce
