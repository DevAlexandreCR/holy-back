CREATE TABLE `web_outbound_clicks` (
  `id` CHAR(36) NOT NULL,
  `target` VARCHAR(64) NOT NULL,
  `target_platform` VARCHAR(32) NOT NULL,
  `destination_url` TEXT NOT NULL,
  `cta_placement` VARCHAR(191) NULL,
  `entry_context` VARCHAR(191) NOT NULL DEFAULT 'home',
  `lp_variant` VARCHAR(191) NOT NULL DEFAULT 'emotional',
  `landing_session_id` VARCHAR(191) NULL,
  `utm_source` VARCHAR(191) NULL,
  `utm_medium` VARCHAR(191) NULL,
  `utm_campaign` VARCHAR(191) NULL,
  `utm_content` VARCHAR(191) NULL,
  `share_token` VARCHAR(191) NULL,
  `referer` TEXT NULL,
  `user_agent` TEXT NULL,
  `ip_address` VARCHAR(191) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  PRIMARY KEY (`id`),
  INDEX `web_outbound_clicks_target_created_at_idx`(`target`, `created_at`),
  INDEX `web_outbound_clicks_entry_context_created_at_idx`(`entry_context`, `created_at`),
  INDEX `web_outbound_clicks_share_token_created_at_idx`(`share_token`, `created_at`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
