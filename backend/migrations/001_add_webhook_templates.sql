-- Migration: Add webhook_templates table
-- Version: 1.1.0
-- Description: Add support for custom user-created webhook templates

CREATE TABLE IF NOT EXISTS webhook_templates (
  id INT AUTO_INCREMENT PRIMARY KEY,
  entity_rid INT NOT NULL COMMENT 'Entity that owns this template',
  name VARCHAR(255) NOT NULL COMMENT 'Template name',
  description TEXT DEFAULT NULL COMMENT 'Template description',
  category VARCHAR(50) NOT NULL COMMENT 'Template category (EHR, PMS, etc.)',
  event_type JSON NOT NULL COMMENT 'Array of event types this template handles',
  target_url VARCHAR(500) NOT NULL COMMENT 'Default target URL',
  http_method VARCHAR(10) NOT NULL DEFAULT 'POST' COMMENT 'HTTP method',
  auth_type VARCHAR(50) NOT NULL DEFAULT 'NONE' COMMENT 'Authentication type',
  auth_config JSON DEFAULT NULL COMMENT 'Authentication configuration',
  headers JSON DEFAULT NULL COMMENT 'Default HTTP headers',
  timeout_ms INT NOT NULL DEFAULT 10000 COMMENT 'Request timeout in milliseconds',
  retry_count INT NOT NULL DEFAULT 3 COMMENT 'Default retry count',
  transformation_mode ENUM('SIMPLE', 'SCRIPT') NOT NULL DEFAULT 'SIMPLE' COMMENT 'Transformation mode',
  transformation JSON DEFAULT NULL COMMENT 'Transformation configuration',
  is_active BOOLEAN NOT NULL DEFAULT TRUE COMMENT 'Template active status',
  metadata JSON DEFAULT NULL COMMENT 'Additional template metadata',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT 'Creation timestamp',
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT 'Last modification timestamp',

  -- Indexes
  INDEX idx_entity_rid (entity_rid),
  INDEX idx_category (category),
  INDEX idx_is_active (is_active),
  INDEX idx_entity_category (entity_rid, category)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Custom webhook templates';
