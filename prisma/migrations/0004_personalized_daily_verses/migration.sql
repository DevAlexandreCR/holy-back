-- Drop legacy/old tables if they exist
DROP TABLE IF EXISTS `user_verse_history`;
DROP TABLE IF EXISTS `cached_verses`;
DROP TABLE IF EXISTS `daily_verses`;
DROP TABLE IF EXISTS `verse_translations`;
DROP TABLE IF EXISTS `verse_seeds`;

-- CreateTable
CREATE TABLE `verse_seeds` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `seed_hash` VARCHAR(191) NOT NULL,
    `source_translation` VARCHAR(191) NOT NULL DEFAULT 'web',
    `reference` VARCHAR(191) NOT NULL,
    `reference_book` VARCHAR(191) NOT NULL,
    `reference_chapter` INTEGER NOT NULL,
    `reference_from_verse` INTEGER NOT NULL,
    `reference_to_verse` INTEGER NULL,
    `text_en` TEXT NOT NULL,
    `meta` JSON NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `verse_seeds_seed_hash_key`(`seed_hash`),
    INDEX `verse_seeds_source_translation_idx`(`source_translation`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `verse_translations` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `seed_id` INTEGER NOT NULL,
    `version_id` INTEGER NOT NULL,
    `translation_code` VARCHAR(191) NOT NULL,
    `text` TEXT NOT NULL,
    `meta` JSON NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `verse_translations_version_id_idx`(`version_id`),
    UNIQUE INDEX `verse_translations_seed_id_version_id_key`(`seed_id`, `version_id`),
    PRIMARY KEY (`id`),
    CONSTRAINT `verse_translations_seed_id_fkey` FOREIGN KEY (`seed_id`) REFERENCES `verse_seeds`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT `verse_translations_version_id_fkey` FOREIGN KEY (`version_id`) REFERENCES `bible_versions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `user_verse_history` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `user_id` VARCHAR(191) NOT NULL,
    `seed_id` INTEGER NOT NULL,
    `shown_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `user_verse_history_user_id_idx`(`user_id`),
    UNIQUE INDEX `user_verse_history_user_id_seed_id_key`(`user_id`, `seed_id`),
    PRIMARY KEY (`id`),
    CONSTRAINT `user_verse_history_seed_id_fkey` FOREIGN KEY (`seed_id`) REFERENCES `verse_seeds`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT `user_verse_history_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
