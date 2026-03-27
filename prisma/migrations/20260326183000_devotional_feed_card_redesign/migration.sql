ALTER TABLE `devotionals`
  ADD COLUMN `computed_hook` VARCHAR(140) NOT NULL DEFAULT '' AFTER `content`,
  ADD COLUMN `optimized_preview_text` VARCHAR(160) NOT NULL DEFAULT '' AFTER `computed_hook`,
  ADD COLUMN `hook_source` ENUM(
    'CONTENT_OPENING',
    'TITLE_FALLBACK',
    'CONTENT_TRUNCATION'
  ) NOT NULL DEFAULT 'CONTENT_TRUNCATION' AFTER `optimized_preview_text`,
  ADD COLUMN `quality_gate_status` ENUM(
    'READY',
    'NEEDS_MORE_REFLECTION',
    'NEEDS_CLEARER_OPENING'
  ) NOT NULL DEFAULT 'READY' AFTER `hook_source`;
