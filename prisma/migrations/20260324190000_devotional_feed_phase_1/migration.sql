CREATE TABLE `devotional_image_assets` (
    `id` CHAR(36) NOT NULL,
    `user_id` CHAR(36) NOT NULL,
    `status` ENUM('PENDING', 'ATTACHABLE', 'REJECTED', 'USED', 'EXPIRED') NOT NULL DEFAULT 'PENDING',
    `image_moderation_status` ENUM('PENDING', 'APPROVED', 'REJECTED') NOT NULL DEFAULT 'PENDING',
    `moderation_result_raw` JSON NULL,
    `mime_type` VARCHAR(191) NOT NULL,
    `temp_path` VARCHAR(191) NOT NULL,
    `temp_url` VARCHAR(191) NOT NULL,
    `permanent_path` VARCHAR(191) NULL,
    `permanent_url` VARCHAR(191) NULL,
    `width` INTEGER NULL,
    `height` INTEGER NULL,
    `expires_at` DATETIME(3) NULL,
    `used_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    INDEX `devotional_image_assets_user_id_status_idx`(`user_id`, `status`),
    INDEX `devotional_image_assets_expires_at_idx`(`expires_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `devotionals`
    CHANGE COLUMN `status` `legacy_status` ENUM('DRAFT', 'PUBLISHED', 'ARCHIVED') NOT NULL DEFAULT 'DRAFT',
    CHANGE COLUMN `cover_image_url` `image_url` VARCHAR(191) NULL,
    ADD COLUMN `publication_state` ENUM('DRAFT', 'PUBLISHED_LOW_REACH', 'TRENDING', 'FEATURED', 'ARCHIVED') NOT NULL DEFAULT 'DRAFT' AFTER `author_id`,
    ADD COLUMN `moderation_status` ENUM('CLEAR', 'UNDER_REVIEW', 'RESTRICTED') NOT NULL DEFAULT 'CLEAR' AFTER `publication_state`,
    ADD COLUMN `moderation_reason` VARCHAR(191) NULL AFTER `moderation_status`,
    ADD COLUMN `moderated_by` CHAR(36) NULL AFTER `moderation_reason`,
    ADD COLUMN `moderated_at` DATETIME(3) NULL AFTER `moderated_by`,
    ADD COLUMN `image_asset_id` CHAR(36) NULL AFTER `image_url`,
    ADD COLUMN `image_moderation_status` ENUM('PENDING', 'APPROVED', 'REJECTED') NOT NULL DEFAULT 'PENDING' AFTER `image_asset_id`,
    ADD COLUMN `image_moderation_result_raw` JSON NULL AFTER `image_moderation_status`,
    ADD COLUMN `ranking_score` DOUBLE NOT NULL DEFAULT 0 AFTER `view_count`,
    ADD COLUMN `last_scored_at` DATETIME(3) NULL AFTER `ranking_score`,
    ADD COLUMN `featured_until` DATETIME(3) NULL AFTER `last_scored_at`,
    ADD COLUMN `first_published_at` DATETIME(3) NULL AFTER `published_at`,
    ADD COLUMN `like_count` INTEGER NOT NULL DEFAULT 0 AFTER `first_published_at`,
    ADD COLUMN `comment_count` INTEGER NOT NULL DEFAULT 0 AFTER `like_count`,
    ADD COLUMN `share_count` INTEGER NOT NULL DEFAULT 0 AFTER `comment_count`,
    ADD COLUMN `save_count` INTEGER NOT NULL DEFAULT 0 AFTER `share_count`,
    ADD COLUMN `read_complete_count` INTEGER NOT NULL DEFAULT 0 AFTER `save_count`,
    ADD COLUMN `skip_count` INTEGER NOT NULL DEFAULT 0 AFTER `read_complete_count`,
    ADD COLUMN `report_count` INTEGER NOT NULL DEFAULT 0 AFTER `skip_count`,
    ADD COLUMN `impression_count` INTEGER NOT NULL DEFAULT 0 AFTER `report_count`,
    ADD COLUMN `unique_impression_count` INTEGER NOT NULL DEFAULT 0 AFTER `impression_count`;

UPDATE `devotionals`
SET
    `publication_state` = CASE
        WHEN `legacy_status` = 'DRAFT' THEN 'DRAFT'
        WHEN `legacy_status` = 'PUBLISHED' THEN 'PUBLISHED_LOW_REACH'
        ELSE 'ARCHIVED'
    END,
    `image_moderation_status` = CASE
        WHEN `image_url` IS NULL THEN 'PENDING'
        ELSE 'APPROVED'
    END,
    `first_published_at` = `published_at`,
    `like_count` = (
        SELECT COUNT(*)
        FROM `devotional_likes`
        WHERE `devotional_likes`.`devotional_id` = `devotionals`.`id`
    ),
    `comment_count` = (
        SELECT COUNT(*)
        FROM `devotional_comments`
        WHERE `devotional_comments`.`devotional_id` = `devotionals`.`id`
    );

ALTER TABLE `devotionals`
    DROP COLUMN `legacy_status`,
    ADD UNIQUE INDEX `devotionals_image_asset_id_key`(`image_asset_id`),
    ADD INDEX `devotions_feed_rank_idx`(`publication_state`, `moderation_status`, `ranking_score`, `last_scored_at`),
    ADD INDEX `devotions_pub_vis_idx`(`publication_state`, `moderation_status`, `published_at`),
    ADD INDEX `devotionals_moderated_by_idx`(`moderated_by`);

CREATE TABLE `devotional_feed_deliveries` (
    `id` CHAR(36) NOT NULL,
    `token` VARCHAR(191) NOT NULL,
    `devotional_id` CHAR(36) NOT NULL,
    `user_id` CHAR(36) NOT NULL,
    `ranking_score` DOUBLE NOT NULL DEFAULT 0,
    `delivered_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    UNIQUE INDEX `devotional_feed_deliveries_token_key`(`token`),
    INDEX `devotional_feed_deliveries_user_id_delivered_at_idx`(`user_id`, `delivered_at`),
    INDEX `devotional_feed_deliveries_devotional_id_delivered_at_idx`(`devotional_id`, `delivered_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `devotional_feed_events` (
    `id` CHAR(36) NOT NULL,
    `event_id` VARCHAR(191) NOT NULL,
    `devotional_id` CHAR(36) NOT NULL,
    `delivery_id` CHAR(36) NOT NULL,
    `user_id` CHAR(36) NOT NULL,
    `type` ENUM('IMPRESSION', 'OPEN') NOT NULL,
    `occurred_at` DATETIME(3) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    UNIQUE INDEX `devotional_feed_events_event_id_key`(`event_id`),
    INDEX `devotional_feed_events_devotional_id_type_occurred_at_idx`(`devotional_id`, `type`, `occurred_at`),
    INDEX `devotional_feed_events_user_id_occurred_at_idx`(`user_id`, `occurred_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `devotional_unique_impressions` (
    `id` CHAR(36) NOT NULL,
    `devotional_id` CHAR(36) NOT NULL,
    `user_id` CHAR(36) NOT NULL,
    `first_seen_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    UNIQUE INDEX `devotional_unique_impressions_devotional_id_user_id_key`(`devotional_id`, `user_id`),
    INDEX `devotional_unique_impressions_user_id_first_seen_at_idx`(`user_id`, `first_seen_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `devotional_saves` (
    `id` CHAR(36) NOT NULL,
    `devotional_id` CHAR(36) NOT NULL,
    `user_id` CHAR(36) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    UNIQUE INDEX `devotional_saves_devotional_id_user_id_key`(`devotional_id`, `user_id`),
    INDEX `devotional_saves_user_id_created_at_idx`(`user_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `devotional_share_events` (
    `id` CHAR(36) NOT NULL,
    `devotional_id` CHAR(36) NOT NULL,
    `user_id` CHAR(36) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    INDEX `devotional_share_events_devotional_id_created_at_idx`(`devotional_id`, `created_at`),
    INDEX `devotional_share_events_user_id_created_at_idx`(`user_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `devotional_read_completions` (
    `id` CHAR(36) NOT NULL,
    `devotional_id` CHAR(36) NOT NULL,
    `user_id` CHAR(36) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    UNIQUE INDEX `devotional_read_completions_devotional_id_user_id_key`(`devotional_id`, `user_id`),
    INDEX `devotional_read_completions_user_id_created_at_idx`(`user_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `devotional_reports` (
    `id` CHAR(36) NOT NULL,
    `devotional_id` CHAR(36) NOT NULL,
    `user_id` CHAR(36) NOT NULL,
    `reason` ENUM('INAPPROPRIATE', 'OFFENSIVE', 'SEXUAL', 'VIOLENCE', 'SPAM', 'INAPPROPRIATE_IMAGE', 'MISLEADING', 'OTHER') NOT NULL,
    `details` TEXT NULL,
    `status` ENUM('OPEN', 'DISMISSED') NOT NULL DEFAULT 'OPEN',
    `reviewed_by` CHAR(36) NULL,
    `reviewed_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    UNIQUE INDEX `devotional_reports_devotional_id_user_id_key`(`devotional_id`, `user_id`),
    INDEX `devotional_reports_status_created_at_idx`(`status`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `devotional_moderation_actions` (
    `id` CHAR(36) NOT NULL,
    `devotional_id` CHAR(36) NOT NULL,
    `actor_id` CHAR(36) NULL,
    `action_type` ENUM('AUTO_UNDER_REVIEW', 'RESTRICT', 'RESTORE', 'REMOVE_IMAGE', 'DISMISS_REPORT', 'PUBLISH_BLOCKED', 'IMAGE_REJECTED') NOT NULL,
    `reason` TEXT NULL,
    `metadata` JSON NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    INDEX `devotional_moderation_actions_devotional_id_created_at_idx`(`devotional_id`, `created_at`),
    INDEX `devotional_moderation_actions_actor_id_created_at_idx`(`actor_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `devotional_author_impression_daily` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `author_id` CHAR(36) NOT NULL,
    `date` VARCHAR(191) NOT NULL,
    `impressions` INTEGER NOT NULL DEFAULT 0,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    UNIQUE INDEX `devotional_author_impression_daily_author_id_date_key`(`author_id`, `date`),
    INDEX `devotional_author_impression_daily_date_idx`(`date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `devotionals`
    ADD CONSTRAINT `devotionals_moderated_by_fkey` FOREIGN KEY (`moderated_by`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
    ADD CONSTRAINT `devotionals_image_asset_id_fkey` FOREIGN KEY (`image_asset_id`) REFERENCES `devotional_image_assets`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `devotional_image_assets`
    ADD CONSTRAINT `devotional_image_assets_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `devotional_feed_deliveries`
    ADD CONSTRAINT `devotional_feed_deliveries_devotional_id_fkey` FOREIGN KEY (`devotional_id`) REFERENCES `devotionals`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT `devotional_feed_deliveries_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `devotional_feed_events`
    ADD CONSTRAINT `devotional_feed_events_devotional_id_fkey` FOREIGN KEY (`devotional_id`) REFERENCES `devotionals`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT `devotional_feed_events_delivery_id_fkey` FOREIGN KEY (`delivery_id`) REFERENCES `devotional_feed_deliveries`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT `devotional_feed_events_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `devotional_unique_impressions`
    ADD CONSTRAINT `devotional_unique_impressions_devotional_id_fkey` FOREIGN KEY (`devotional_id`) REFERENCES `devotionals`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT `devotional_unique_impressions_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `devotional_saves`
    ADD CONSTRAINT `devotional_saves_devotional_id_fkey` FOREIGN KEY (`devotional_id`) REFERENCES `devotionals`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT `devotional_saves_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `devotional_share_events`
    ADD CONSTRAINT `devotional_share_events_devotional_id_fkey` FOREIGN KEY (`devotional_id`) REFERENCES `devotionals`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT `devotional_share_events_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `devotional_read_completions`
    ADD CONSTRAINT `devotional_read_completions_devotional_id_fkey` FOREIGN KEY (`devotional_id`) REFERENCES `devotionals`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT `devotional_read_completions_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `devotional_reports`
    ADD CONSTRAINT `devotional_reports_devotional_id_fkey` FOREIGN KEY (`devotional_id`) REFERENCES `devotionals`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT `devotional_reports_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `devotional_moderation_actions`
    ADD CONSTRAINT `devotional_moderation_actions_devotional_id_fkey` FOREIGN KEY (`devotional_id`) REFERENCES `devotionals`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT `devotional_moderation_actions_actor_id_fkey` FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `devotional_author_impression_daily`
    ADD CONSTRAINT `devotional_author_impression_daily_author_id_fkey` FOREIGN KEY (`author_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
