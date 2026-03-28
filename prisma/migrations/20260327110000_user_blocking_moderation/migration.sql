ALTER TABLE `users`
    ADD COLUMN `is_blocked` BOOLEAN NOT NULL DEFAULT false AFTER `role`,
    ADD COLUMN `blocked_reason` VARCHAR(500) NULL AFTER `is_blocked`,
    ADD COLUMN `blocked_by` CHAR(36) NULL AFTER `blocked_reason`,
    ADD COLUMN `blocked_at` DATETIME(3) NULL AFTER `blocked_by`,
    ADD COLUMN `unblocked_reason` VARCHAR(500) NULL AFTER `blocked_at`,
    ADD COLUMN `unblocked_by` CHAR(36) NULL AFTER `unblocked_reason`,
    ADD COLUMN `unblocked_at` DATETIME(3) NULL AFTER `unblocked_by`,
    ADD INDEX `users_is_blocked_idx`(`is_blocked`),
    ADD INDEX `users_blocked_by_idx`(`blocked_by`),
    ADD INDEX `users_unblocked_by_idx`(`unblocked_by`);

CREATE TABLE `user_moderation_actions` (
    `id` CHAR(36) NOT NULL,
    `user_id` CHAR(36) NOT NULL,
    `actor_id` CHAR(36) NULL,
    `action_type` ENUM('BLOCK', 'UNBLOCK') NOT NULL,
    `reason` VARCHAR(500) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `user_moderation_actions_user_id_created_at_idx`(`user_id`, `created_at`),
    INDEX `user_moderation_actions_actor_id_created_at_idx`(`actor_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `users`
    ADD CONSTRAINT `users_blocked_by_fkey` FOREIGN KEY (`blocked_by`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
    ADD CONSTRAINT `users_unblocked_by_fkey` FOREIGN KEY (`unblocked_by`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `user_moderation_actions`
    ADD CONSTRAINT `user_moderation_actions_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT `user_moderation_actions_actor_id_fkey` FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
