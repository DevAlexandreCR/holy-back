-- AlterTable
ALTER TABLE `devotional_notification_evaluation_daily_metrics` MODIFY `notification_type` ENUM('FOLLOWED_CREATOR_NEW_DEVOTIONAL', 'FEATURED_DEVOTIONAL', 'STREAK_AT_RISK', 'EDITOR_DEVOTIONAL_REVIEW_REQUIRED', 'AUTHOR_DEVOTIONAL_APPROVED', 'AUTHOR_DEVOTIONAL_RESTRICTED', 'DAILY_REMINDER', 'STREAK_MILESTONE', 'WINBACK') NOT NULL;

-- AlterTable
ALTER TABLE `devotional_notification_sends` MODIFY `type` ENUM('FOLLOWED_CREATOR_NEW_DEVOTIONAL', 'FEATURED_DEVOTIONAL', 'STREAK_AT_RISK', 'EDITOR_DEVOTIONAL_REVIEW_REQUIRED', 'AUTHOR_DEVOTIONAL_APPROVED', 'AUTHOR_DEVOTIONAL_RESTRICTED', 'DAILY_REMINDER', 'STREAK_MILESTONE', 'WINBACK') NOT NULL;

-- AlterTable
ALTER TABLE `notification_daily_metrics` MODIFY `notification_type` ENUM('FOLLOWED_CREATOR_NEW_DEVOTIONAL', 'FEATURED_DEVOTIONAL', 'STREAK_AT_RISK', 'EDITOR_DEVOTIONAL_REVIEW_REQUIRED', 'AUTHOR_DEVOTIONAL_APPROVED', 'AUTHOR_DEVOTIONAL_RESTRICTED', 'DAILY_REMINDER', 'STREAK_MILESTONE', 'WINBACK') NOT NULL;

-- AlterTable
ALTER TABLE `user_settings` ADD COLUMN `daily_reminder_hour` INTEGER NULL,
    ADD COLUMN `daily_reminder_notifications_enabled` BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN `streak_milestone_notifications_enabled` BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN `winback_notifications_enabled` BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE `user_streak_milestones` (
    `id` CHAR(36) NOT NULL,
    `user_id` CHAR(36) NOT NULL,
    `milestone` INTEGER NOT NULL,
    `achieved_date` VARCHAR(191) NOT NULL,
    `celebrated_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `user_streak_milestones_user_id_celebrated_at_idx`(`user_id`, `celebrated_at`),
    UNIQUE INDEX `user_streak_milestones_user_id_milestone_key`(`user_id`, `milestone`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `user_winback_states` (
    `user_id` CHAR(36) NOT NULL,
    `last_step_sent` INTEGER NOT NULL DEFAULT 0,
    `last_sent_at` DATETIME(3) NULL,
    `paused_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    PRIMARY KEY (`user_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `user_streak_milestones` ADD CONSTRAINT `user_streak_milestones_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user_winback_states` ADD CONSTRAINT `user_winback_states_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
