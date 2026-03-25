-- DropIndex
DROP INDEX `devotionals_status_published_at_idx` ON `devotionals`;

-- AlterTable
ALTER TABLE `devotional_feed_deliveries`
  ADD COLUMN `feed_mode` VARCHAR(191) NULL,
  ADD COLUMN `recommendation_reason` VARCHAR(191) NULL;

UPDATE `devotional_feed_deliveries`
SET `feed_mode` = 'for_you'
WHERE `feed_mode` IS NULL;

ALTER TABLE `devotional_feed_deliveries`
  MODIFY `feed_mode` VARCHAR(191) NOT NULL;

-- AlterTable
ALTER TABLE `devotional_read_completions`
  ADD COLUMN `delivery_id` CHAR(36) NULL;

-- AlterTable
ALTER TABLE `devotional_reports`
  ADD COLUMN `delivery_id` CHAR(36) NULL;

-- AlterTable
ALTER TABLE `devotional_saves`
  ADD COLUMN `delivery_id` CHAR(36) NULL;

-- AlterTable
ALTER TABLE `devotional_share_events`
  ADD COLUMN `delivery_id` CHAR(36) NULL;

-- AlterTable
ALTER TABLE `user_settings`
  ADD COLUMN `devotional_notifications_enabled` BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN `featured_devotional_notifications_enabled` BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN `followed_creator_notifications_enabled` BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE `device_tokens` (
  `id` CHAR(36) NOT NULL,
  `user_id` CHAR(36) NOT NULL,
  `token` VARCHAR(191) NOT NULL,
  `platform` ENUM('ANDROID', 'IOS') NOT NULL,
  `os_permission_status` ENUM('AUTHORIZED', 'PROVISIONAL', 'DENIED', 'NOT_DETERMINED') NOT NULL,
  `is_active` BOOLEAN NOT NULL DEFAULT true,
  `last_seen_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `last_permission_synced_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,

  UNIQUE INDEX `device_tokens_token_key`(`token`),
  INDEX `device_tokens_user_id_is_active_idx`(`user_id`, `is_active`),
  INDEX `device_tokens_os_permission_status_is_active_idx`(`os_permission_status`, `is_active`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `devotional_notification_sends` (
  `id` CHAR(36) NOT NULL,
  `devotional_id` CHAR(36) NOT NULL,
  `user_id` CHAR(36) NOT NULL,
  `device_token_id` CHAR(36) NOT NULL,
  `type` ENUM('FOLLOWED_CREATOR_NEW_DEVOTIONAL', 'FEATURED_DEVOTIONAL') NOT NULL,
  `title` VARCHAR(191) NOT NULL,
  `body` VARCHAR(191) NOT NULL,
  `image_url` VARCHAR(191) NULL,
  `provider_message_id` VARCHAR(191) NULL,
  `sent_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `provider_accepted_at` DATETIME(3) NULL,
  `opened_at` DATETIME(3) NULL,
  `failed_at` DATETIME(3) NULL,
  `failure_code` VARCHAR(191) NULL,
  `token_deactivated_at` DATETIME(3) NULL,
  `payload` JSON NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,

  INDEX `devotional_notification_sends_type_sent_at_idx`(`type`, `sent_at`),
  INDEX `devotional_notification_sends_user_id_type_sent_at_idx`(`user_id`, `type`, `sent_at`),
  INDEX `devotional_notification_sends_device_token_id_sent_at_idx`(`device_token_id`, `sent_at`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `app_session_events` (
  `id` CHAR(36) NOT NULL,
  `user_id` CHAR(36) NOT NULL,
  `device_id` VARCHAR(191) NULL,
  `occurred_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  INDEX `app_session_events_user_id_occurred_at_idx`(`user_id`, `occurred_at`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `devotional_state_transition_events` (
  `id` CHAR(36) NOT NULL,
  `devotional_id` CHAR(36) NOT NULL,
  `from_publication_state` ENUM('DRAFT', 'PUBLISHED_LOW_REACH', 'TRENDING', 'FEATURED', 'ARCHIVED') NULL,
  `to_publication_state` ENUM('DRAFT', 'PUBLISHED_LOW_REACH', 'TRENDING', 'FEATURED', 'ARCHIVED') NOT NULL,
  `source` ENUM('PUBLISH', 'RANKING', 'OWNER_ARCHIVE', 'MODERATION', 'RESTORE') NOT NULL,
  `metadata` JSON NULL,
  `occurred_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  INDEX `devotional_state_transition_events_devotional_id_occurred_at_idx`(`devotional_id`, `occurred_at`),
  INDEX `devotional_state_transition_events_to_publication_state_occu_idx`(`to_publication_state`, `occurred_at`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `devotional_share_attribution_sources` (
  `id` CHAR(36) NOT NULL,
  `token` VARCHAR(191) NOT NULL,
  `devotional_id` CHAR(36) NOT NULL,
  `sharer_user_id` CHAR(36) NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  UNIQUE INDEX `devotional_share_attribution_sources_token_key`(`token`),
  INDEX `devotional_share_attribution_sources_devotional_id_created_a_idx`(`devotional_id`, `created_at`),
  INDEX `devotional_share_attribution_sources_sharer_user_id_created__idx`(`sharer_user_id`, `created_at`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `devotional_share_attribution_events` (
  `id` CHAR(36) NOT NULL,
  `source_id` CHAR(36) NOT NULL,
  `type` ENUM('LINK_OPEN', 'APP_OPEN', 'INSTALL_DETECTED', 'REGISTRATION', 'FIRST_DEVOTIONAL_OPEN', 'FIRST_READ_COMPLETE') NOT NULL,
  `user_id` CHAR(36) NULL,
  `device_id` VARCHAR(191) NULL,
  `dedup_key` VARCHAR(191) NULL,
  `metadata` JSON NULL,
  `occurred_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  INDEX `devotional_share_attribution_events_type_occurred_at_idx`(`type`, `occurred_at`),
  INDEX `devotional_share_attribution_events_user_id_type_occurred_at_idx`(`user_id`, `type`, `occurred_at`),
  UNIQUE INDEX `devotional_share_attribution_events_source_id_type_dedup_key_key`(`source_id`, `type`, `dedup_key`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `devotional_daily_metrics` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `date` VARCHAR(191) NOT NULL,
  `devotional_id` CHAR(36) NOT NULL,
  `impressions` INTEGER NOT NULL DEFAULT 0,
  `unique_impressions` INTEGER NOT NULL DEFAULT 0,
  `opens` INTEGER NOT NULL DEFAULT 0,
  `read_completes` INTEGER NOT NULL DEFAULT 0,
  `likes` INTEGER NOT NULL DEFAULT 0,
  `comments` INTEGER NOT NULL DEFAULT 0,
  `saves` INTEGER NOT NULL DEFAULT 0,
  `shares` INTEGER NOT NULL DEFAULT 0,
  `reports` INTEGER NOT NULL DEFAULT 0,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,

  INDEX `devotional_daily_metrics_devotional_id_date_idx`(`devotional_id`, `date`),
  UNIQUE INDEX `devotional_daily_metrics_date_devotional_id_key`(`date`, `devotional_id`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `creator_daily_metrics` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `date` VARCHAR(191) NOT NULL,
  `creator_id` CHAR(36) NOT NULL,
  `published_devotionals` INTEGER NOT NULL DEFAULT 0,
  `impressions` INTEGER NOT NULL DEFAULT 0,
  `unique_impressions` INTEGER NOT NULL DEFAULT 0,
  `opens` INTEGER NOT NULL DEFAULT 0,
  `read_completes` INTEGER NOT NULL DEFAULT 0,
  `saves` INTEGER NOT NULL DEFAULT 0,
  `shares` INTEGER NOT NULL DEFAULT 0,
  `new_followers` INTEGER NOT NULL DEFAULT 0,
  `followers_total_snapshot` INTEGER NOT NULL DEFAULT 0,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,

  INDEX `creator_daily_metrics_creator_id_date_idx`(`creator_id`, `date`),
  UNIQUE INDEX `creator_daily_metrics_date_creator_id_key`(`date`, `creator_id`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `feed_daily_metrics` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `date` VARCHAR(191) NOT NULL,
  `feed_mode` VARCHAR(191) NOT NULL,
  `impressions` INTEGER NOT NULL DEFAULT 0,
  `unique_impressions` INTEGER NOT NULL DEFAULT 0,
  `opens` INTEGER NOT NULL DEFAULT 0,
  `read_completes` INTEGER NOT NULL DEFAULT 0,
  `saves` INTEGER NOT NULL DEFAULT 0,
  `shares` INTEGER NOT NULL DEFAULT 0,
  `reports` INTEGER NOT NULL DEFAULT 0,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,

  INDEX `feed_daily_metrics_feed_mode_date_idx`(`feed_mode`, `date`),
  UNIQUE INDEX `feed_daily_metrics_date_feed_mode_key`(`date`, `feed_mode`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `for_you_reason_daily_metrics` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `date` VARCHAR(191) NOT NULL,
  `recommendation_reason` VARCHAR(191) NOT NULL,
  `impressions` INTEGER NOT NULL DEFAULT 0,
  `unique_impressions` INTEGER NOT NULL DEFAULT 0,
  `opens` INTEGER NOT NULL DEFAULT 0,
  `read_completes` INTEGER NOT NULL DEFAULT 0,
  `saves` INTEGER NOT NULL DEFAULT 0,
  `shares` INTEGER NOT NULL DEFAULT 0,
  `reports` INTEGER NOT NULL DEFAULT 0,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,

  INDEX `for_you_reason_daily_metrics_recommendation_reason_date_idx`(`recommendation_reason`, `date`),
  UNIQUE INDEX `for_you_reason_daily_metrics_date_recommendation_reason_key`(`date`, `recommendation_reason`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `user_activity_daily_metrics` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `date` VARCHAR(191) NOT NULL,
  `user_id` CHAR(36) NOT NULL,
  `sessions` INTEGER NOT NULL DEFAULT 0,
  `had_devotional_activity` BOOLEAN NOT NULL DEFAULT false,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,

  INDEX `user_activity_daily_metrics_user_id_date_idx`(`user_id`, `date`),
  UNIQUE INDEX `user_activity_daily_metrics_date_user_id_key`(`date`, `user_id`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `share_attribution_daily_metrics` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `date` VARCHAR(191) NOT NULL,
  `link_opens` INTEGER NOT NULL DEFAULT 0,
  `app_opens` INTEGER NOT NULL DEFAULT 0,
  `installs_detected` INTEGER NOT NULL DEFAULT 0,
  `registrations_attributed` INTEGER NOT NULL DEFAULT 0,
  `first_devotional_opens` INTEGER NOT NULL DEFAULT 0,
  `first_read_completes` INTEGER NOT NULL DEFAULT 0,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,

  UNIQUE INDEX `share_attribution_daily_metrics_date_key`(`date`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `notification_daily_metrics` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `date` VARCHAR(191) NOT NULL,
  `notification_type` ENUM('FOLLOWED_CREATOR_NEW_DEVOTIONAL', 'FEATURED_DEVOTIONAL') NOT NULL,
  `sent` INTEGER NOT NULL DEFAULT 0,
  `provider_accepted` INTEGER NOT NULL DEFAULT 0,
  `opened` INTEGER NOT NULL DEFAULT 0,
  `failed` INTEGER NOT NULL DEFAULT 0,
  `token_deactivated` INTEGER NOT NULL DEFAULT 0,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,

  INDEX `notification_daily_metrics_notification_type_date_idx`(`notification_type`, `date`),
  UNIQUE INDEX `notification_daily_metrics_date_notification_type_key`(`date`, `notification_type`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `devotional_feed_deliveries_feed_mode_delivered_at_idx`
ON `devotional_feed_deliveries`(`feed_mode`, `delivered_at`);

-- CreateIndex
CREATE INDEX `devotional_read_completions_delivery_id_idx`
ON `devotional_read_completions`(`delivery_id`);

-- CreateIndex
CREATE INDEX `devotional_reports_delivery_id_idx`
ON `devotional_reports`(`delivery_id`);

-- CreateIndex
CREATE INDEX `devotional_saves_delivery_id_idx`
ON `devotional_saves`(`delivery_id`);

-- CreateIndex
CREATE INDEX `devotional_share_events_delivery_id_idx`
ON `devotional_share_events`(`delivery_id`);

-- AddForeignKey
ALTER TABLE `devotional_saves`
  ADD CONSTRAINT `devotional_saves_delivery_id_fkey`
  FOREIGN KEY (`delivery_id`) REFERENCES `devotional_feed_deliveries`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `devotional_share_events`
  ADD CONSTRAINT `devotional_share_events_delivery_id_fkey`
  FOREIGN KEY (`delivery_id`) REFERENCES `devotional_feed_deliveries`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `devotional_read_completions`
  ADD CONSTRAINT `devotional_read_completions_delivery_id_fkey`
  FOREIGN KEY (`delivery_id`) REFERENCES `devotional_feed_deliveries`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `devotional_reports`
  ADD CONSTRAINT `devotional_reports_delivery_id_fkey`
  FOREIGN KEY (`delivery_id`) REFERENCES `devotional_feed_deliveries`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `device_tokens`
  ADD CONSTRAINT `device_tokens_user_id_fkey`
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `devotional_notification_sends`
  ADD CONSTRAINT `devotional_notification_sends_devotional_id_fkey`
  FOREIGN KEY (`devotional_id`) REFERENCES `devotionals`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `devotional_notification_sends`
  ADD CONSTRAINT `devotional_notification_sends_user_id_fkey`
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `devotional_notification_sends`
  ADD CONSTRAINT `devotional_notification_sends_device_token_id_fkey`
  FOREIGN KEY (`device_token_id`) REFERENCES `device_tokens`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `app_session_events`
  ADD CONSTRAINT `app_session_events_user_id_fkey`
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `devotional_state_transition_events`
  ADD CONSTRAINT `devotional_state_transition_events_devotional_id_fkey`
  FOREIGN KEY (`devotional_id`) REFERENCES `devotionals`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `devotional_share_attribution_sources`
  ADD CONSTRAINT `devotional_share_attribution_sources_devotional_id_fkey`
  FOREIGN KEY (`devotional_id`) REFERENCES `devotionals`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `devotional_share_attribution_sources`
  ADD CONSTRAINT `devotional_share_attribution_sources_sharer_user_id_fkey`
  FOREIGN KEY (`sharer_user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `devotional_share_attribution_events`
  ADD CONSTRAINT `devotional_share_attribution_events_source_id_fkey`
  FOREIGN KEY (`source_id`) REFERENCES `devotional_share_attribution_sources`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `devotional_share_attribution_events`
  ADD CONSTRAINT `devotional_share_attribution_events_user_id_fkey`
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `devotional_daily_metrics`
  ADD CONSTRAINT `devotional_daily_metrics_devotional_id_fkey`
  FOREIGN KEY (`devotional_id`) REFERENCES `devotionals`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `creator_daily_metrics`
  ADD CONSTRAINT `creator_daily_metrics_creator_id_fkey`
  FOREIGN KEY (`creator_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user_activity_daily_metrics`
  ADD CONSTRAINT `user_activity_daily_metrics_user_id_fkey`
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
