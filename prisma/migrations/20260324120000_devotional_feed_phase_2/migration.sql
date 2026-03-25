ALTER TABLE `users`
  ADD COLUMN `handle` VARCHAR(30) NULL,
  ADD COLUMN `creator_bio` VARCHAR(280) NULL,
  ADD COLUMN `creator_avatar_url` VARCHAR(191) NULL,
  ADD COLUMN `creator_profile_updated_at` DATETIME(3) NULL,
  ADD COLUMN `followers_count` INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN `following_count` INTEGER NOT NULL DEFAULT 0;

CREATE UNIQUE INDEX `users_handle_key` ON `users`(`handle`);

CREATE TABLE `creator_avatar_assets` (
  `id` CHAR(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `user_id` CHAR(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `status` ENUM('PENDING', 'ATTACHABLE', 'REJECTED', 'USED', 'EXPIRED') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'PENDING',
  `image_moderation_status` ENUM('PENDING', 'APPROVED', 'REJECTED') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'PENDING',
  `moderation_result_raw` JSON NULL,
  `mime_type` VARCHAR(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `temp_path` VARCHAR(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `temp_url` VARCHAR(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `permanent_path` VARCHAR(191) COLLATE utf8mb4_unicode_ci NULL,
  `permanent_url` VARCHAR(191) COLLATE utf8mb4_unicode_ci NULL,
  `width` INTEGER NULL,
  `height` INTEGER NULL,
  `expires_at` DATETIME(3) NULL,
  `used_at` DATETIME(3) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  INDEX `creator_avatar_assets_user_id_status_idx`(`user_id`, `status`),
  INDEX `creator_avatar_assets_expires_at_idx`(`expires_at`),
  CONSTRAINT `creator_avatar_assets_user_id_fkey`
    FOREIGN KEY (`user_id`) REFERENCES `users`(`id`)
    ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `user_follows` (
  `id` CHAR(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `follower_id` CHAR(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `followed_id` CHAR(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `user_follows_follower_id_followed_id_key`(`follower_id`, `followed_id`),
  INDEX `user_follows_followed_id_created_at_idx`(`followed_id`, `created_at`),
  INDEX `user_follows_follower_id_created_at_idx`(`follower_id`, `created_at`),
  CONSTRAINT `user_follows_follower_id_fkey`
    FOREIGN KEY (`follower_id`) REFERENCES `users`(`id`)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `user_follows_followed_id_fkey`
    FOREIGN KEY (`followed_id`) REFERENCES `users`(`id`)
    ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `user_creator_affinity` (
  `id` CHAR(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `user_id` CHAR(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `creator_id` CHAR(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `score` DOUBLE NOT NULL DEFAULT 0,
  `last_signal_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `user_creator_affinity_user_id_creator_id_key`(`user_id`, `creator_id`),
  INDEX `user_creator_affinity_user_id_score_idx`(`user_id`, `score`),
  INDEX `user_creator_affinity_creator_id_last_signal_at_idx`(`creator_id`, `last_signal_at`),
  CONSTRAINT `user_creator_affinity_user_id_fkey`
    FOREIGN KEY (`user_id`) REFERENCES `users`(`id`)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `user_creator_affinity_creator_id_fkey`
    FOREIGN KEY (`creator_id`) REFERENCES `users`(`id`)
    ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
