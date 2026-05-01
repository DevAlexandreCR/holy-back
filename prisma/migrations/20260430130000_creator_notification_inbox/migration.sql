ALTER TABLE `user_settings`
  ADD COLUMN `social_activity_notifications_enabled` BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN `comment_notifications_enabled` BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN `follow_notifications_enabled` BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN `reaction_notifications_enabled` BOOLEAN NOT NULL DEFAULT true;

CREATE TABLE `notification_inbox_items` (
  `id` CHAR(36) NOT NULL,
  `recipient_user_id` CHAR(36) NOT NULL,
  `type` ENUM(
    'DEVOTIONAL_LIKE',
    'DEVOTIONAL_COMMENT',
    'DEVOTIONAL_SHARE',
    'NEW_FOLLOWER'
  ) NOT NULL,
  `actor_user_id` CHAR(36) NULL,
  `devotional_id` CHAR(36) NULL,
  `comment_id` CHAR(36) NULL,
  `title` VARCHAR(191) NOT NULL,
  `body` VARCHAR(500) NOT NULL,
  `image_url` TEXT NULL,
  `aggregate_count` INTEGER NOT NULL DEFAULT 1,
  `aggregation_key` VARCHAR(191) NULL,
  `window_started_at` DATETIME(3) NULL,
  `window_ends_at` DATETIME(3) NULL,
  `is_read` BOOLEAN NOT NULL DEFAULT false,
  `read_at` DATETIME(3) NULL,
  `opened_at` DATETIME(3) NULL,
  `last_pushed_at` DATETIME(3) NULL,
  `metadata` JSON NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,

  PRIMARY KEY (`id`),
  INDEX `notif_inbox_recipient_read_created_idx`(`recipient_user_id`, `is_read`, `created_at`),
  INDEX `notif_inbox_recipient_type_created_idx`(`recipient_user_id`, `type`, `created_at`),
  INDEX `notif_inbox_agg_window_idx`(`aggregation_key`, `window_ends_at`),
  INDEX `notif_inbox_window_push_idx`(`window_ends_at`, `last_pushed_at`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `notification_inbox_actor_events` (
  `id` CHAR(36) NOT NULL,
  `inbox_item_id` CHAR(36) NOT NULL,
  `actor_user_id` CHAR(36) NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  PRIMARY KEY (`id`),
  UNIQUE INDEX `notif_inbox_actor_event_item_actor_key`(`inbox_item_id`, `actor_user_id`),
  INDEX `notif_inbox_actor_event_actor_created_idx`(`actor_user_id`, `created_at`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `notification_inbox_push_deliveries` (
  `id` CHAR(36) NOT NULL,
  `inbox_item_id` CHAR(36) NOT NULL,
  `recipient_user_id` CHAR(36) NOT NULL,
  `device_token_id` CHAR(36) NOT NULL,
  `title` VARCHAR(191) NOT NULL,
  `body` VARCHAR(500) NOT NULL,
  `provider_message_id` VARCHAR(191) NULL,
  `sent_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `provider_accepted_at` DATETIME(3) NULL,
  `failed_at` DATETIME(3) NULL,
  `failure_code` VARCHAR(191) NULL,
  `token_deactivated_at` DATETIME(3) NULL,
  `payload` JSON NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,

  PRIMARY KEY (`id`),
  INDEX `notif_inbox_push_item_sent_idx`(`inbox_item_id`, `sent_at`),
  INDEX `notif_inbox_push_recipient_sent_idx`(`recipient_user_id`, `sent_at`),
  INDEX `notif_inbox_push_device_sent_idx`(`device_token_id`, `sent_at`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `notification_inbox_items`
  ADD CONSTRAINT `notification_inbox_items_recipient_user_id_fkey`
  FOREIGN KEY (`recipient_user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `notification_inbox_items_actor_user_id_fkey`
  FOREIGN KEY (`actor_user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `notification_inbox_items_devotional_id_fkey`
  FOREIGN KEY (`devotional_id`) REFERENCES `devotionals`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `notification_inbox_items_comment_id_fkey`
  FOREIGN KEY (`comment_id`) REFERENCES `devotional_comments`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `notification_inbox_actor_events`
  ADD CONSTRAINT `notification_inbox_actor_events_inbox_item_id_fkey`
  FOREIGN KEY (`inbox_item_id`) REFERENCES `notification_inbox_items`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `notification_inbox_actor_events_actor_user_id_fkey`
  FOREIGN KEY (`actor_user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `notification_inbox_push_deliveries`
  ADD CONSTRAINT `notification_inbox_push_deliveries_inbox_item_id_fkey`
  FOREIGN KEY (`inbox_item_id`) REFERENCES `notification_inbox_items`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `notification_inbox_push_deliveries_recipient_user_id_fkey`
  FOREIGN KEY (`recipient_user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `notification_inbox_push_deliveries_device_token_id_fkey`
  FOREIGN KEY (`device_token_id`) REFERENCES `device_tokens`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
