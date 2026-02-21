# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Docker support with comprehensive containerization setup for both backend and frontend
- Biome code formatter for consistent code style and linting
- Intelligent token caching system for API integrations with automatic expiration detection
- Comprehensive token management test suite with extensive documentation
- Role-based access control (RBAC) system with permission guards and middleware
- AI configuration management endpoints and provider-agnostic AI service layer
- Audit logging system for tracking user activities and system changes
- User activity tracking and monitoring capabilities
- Memory monitoring service for production deployments
- Advanced analytics aggregation and daily reports scheduling
- Inbound integrations feature for webhook handling and event ingestion
- Comprehensive UI component library with shadcn/ui integration
- Dark mode support with complete design system tokens
- Enterprise-grade pagination system across all data routes
- Landing page and improved authentication UI/UX

### Changed
- Migrated from vulnerable vm2 package to custom secure VM wrapper implementation
- Improved pagination controls with better color consistency across UI
- Standardized transitions and animations using design tokens
- Enhanced UI/UX consistency with standardized borders and shadows
- Refactored worker.js into modular components (delivery engine, event processor, retry handler, pending deliveries worker)
- Updated event schemas with accurate sample payloads and missing fields
- Improved authentication context and tenant management in frontend
- Enhanced notification system with email and Slack channel support
- Updated dependencies to address security vulnerabilities

### Fixed
- Critical pagination and row selection issues in data tables
- Scheduling scripts for OP_VISIT_MODIFIED and PATIENT_REGISTERED events
- Hiding Activate button for integrations that are already active
- API configuration and improved error handling in integration routes

### Security
- **CRITICAL**: Replaced vulnerable vm2 package with secure VM wrapper to address CVE-2023-37466
- Implemented script security measures for user-defined transformation code
- Added permission-based access controls throughout the application
- Enhanced authentication middleware with improved token validation
- Implemented rate limiting for AI service endpoints
