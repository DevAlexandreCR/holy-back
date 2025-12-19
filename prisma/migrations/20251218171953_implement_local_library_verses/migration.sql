-- CreateTable
CREATE TABLE IF NOT EXISTS `library_verses` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `book` VARCHAR(191) NOT NULL,
    `chapter` INTEGER NOT NULL,
    `verse_from` INTEGER NOT NULL,
    `verse_to` INTEGER NOT NULL,
    `theme` VARCHAR(191) NOT NULL,
    `reference_key` VARCHAR(191) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `library_verses_reference_key_key`(`reference_key`),
    INDEX `library_verses_book_idx`(`book`),
    UNIQUE INDEX `library_verses_book_chapter_verse_from_verse_to_key`(`book`, `chapter`, `verse_from`, `verse_to`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE IF NOT EXISTS `cached_verse_texts` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `library_verse_id` INTEGER NOT NULL,
    `version_id` INTEGER NOT NULL,
    `text` TEXT NOT NULL,
    `reference` VARCHAR(191) NOT NULL,
    `api_metadata` JSON NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `cached_verse_texts_version_id_idx`(`version_id`),
    INDEX `cached_verse_texts_created_at_idx`(`created_at`),
    UNIQUE INDEX `cached_verse_texts_library_verse_id_version_id_key`(`library_verse_id`, `version_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE IF NOT EXISTS `user_theme_preferences` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `user_id` VARCHAR(191) NOT NULL,
    `theme` VARCHAR(191) NOT NULL,
    `like_count` INTEGER NOT NULL DEFAULT 0,
    `share_count` INTEGER NOT NULL DEFAULT 0,
    `score` DOUBLE NOT NULL DEFAULT 0,
    `last_interaction` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `user_theme_preferences_user_id_score_idx`(`user_id`, `score`),
    UNIQUE INDEX `user_theme_preferences_user_id_theme_key`(`user_id`, `theme`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Drop foreign keys first
ALTER TABLE `verse_translations` DROP FOREIGN KEY `verse_translations_seed_id_fkey`;
ALTER TABLE `verse_translations` DROP FOREIGN KEY `verse_translations_version_id_fkey`;
ALTER TABLE `user_verse_history` DROP FOREIGN KEY `user_verse_history_seed_id_fkey`;
ALTER TABLE `user_verse_history` DROP FOREIGN KEY `user_verse_history_user_id_fkey`;

-- DropTable
DROP TABLE IF EXISTS `verse_translations`;

-- DropTable
DROP TABLE IF EXISTS `verse_seeds`;

-- AlterTable: Update user_verse_history
-- First, backup old data if needed (optional)
-- CREATE TABLE user_verse_history_backup AS SELECT * FROM user_verse_history;

-- Drop old user_verse_history and recreate
DROP TABLE IF EXISTS `user_verse_history`;

CREATE TABLE `user_verse_history` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `user_id` CHAR(36) NOT NULL,
    `library_verse_id` INTEGER NOT NULL,
    `version_id` INTEGER NOT NULL,
    `date` VARCHAR(191) NOT NULL,
    `shown_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `liked` BOOLEAN NOT NULL DEFAULT false,
    `liked_at` DATETIME(3) NULL,
    `shared` BOOLEAN NOT NULL DEFAULT false,
    `shared_at` DATETIME(3) NULL,

    INDEX `user_verse_history_user_id_idx`(`user_id`),
    INDEX `user_verse_history_shown_at_idx`(`shown_at`),
    INDEX `user_verse_history_user_id_liked_idx`(`user_id`, `liked`),
    INDEX `user_verse_history_user_id_shared_idx`(`user_id`, `shared`),
    UNIQUE INDEX `user_verse_history_user_id_library_verse_id_key`(`user_id`, `library_verse_id`),
    UNIQUE INDEX `user_verse_history_user_id_date_key`(`user_id`, `date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `cached_verse_texts` ADD CONSTRAINT `cached_verse_texts_library_verse_id_fkey` FOREIGN KEY (`library_verse_id`) REFERENCES `library_verses`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `cached_verse_texts` ADD CONSTRAINT `cached_verse_texts_version_id_fkey` FOREIGN KEY (`version_id`) REFERENCES `bible_versions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user_verse_history` ADD CONSTRAINT `user_verse_history_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user_verse_history` ADD CONSTRAINT `user_verse_history_library_verse_id_fkey` FOREIGN KEY (`library_verse_id`) REFERENCES `library_verses`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user_verse_history` ADD CONSTRAINT `user_verse_history_version_id_fkey` FOREIGN KEY (`version_id`) REFERENCES `bible_versions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user_theme_preferences` ADD CONSTRAINT `user_theme_preferences_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
