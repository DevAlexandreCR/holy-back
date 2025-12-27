-- Create user_saved_verses table to store bookmarked verses per user
CREATE TABLE `user_saved_verses` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `user_id` VARCHAR(191) NOT NULL,
    `library_verse_id` INTEGER NOT NULL,
    `version_id` INTEGER NOT NULL,
    `reference` VARCHAR(191) NOT NULL,
    `text` TEXT NOT NULL,
    `theme` VARCHAR(191) NOT NULL,
    `source` VARCHAR(191) NOT NULL DEFAULT 'daily_verse',
    `saved_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `user_saved_verses_user_id_library_verse_id_key`(`user_id`, `library_verse_id`),
    INDEX `user_saved_verses_user_id_saved_at_idx`(`user_id`, `saved_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Foreign keys
ALTER TABLE `user_saved_verses` ADD CONSTRAINT `user_saved_verses_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `user_saved_verses` ADD CONSTRAINT `user_saved_verses_library_verse_id_fkey` FOREIGN KEY (`library_verse_id`) REFERENCES `library_verses`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `user_saved_verses` ADD CONSTRAINT `user_saved_verses_version_id_fkey` FOREIGN KEY (`version_id`) REFERENCES `bible_versions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
