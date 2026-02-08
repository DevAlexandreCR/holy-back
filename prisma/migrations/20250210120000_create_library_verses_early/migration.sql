-- Ensure library_verses exists before user_saved_verses migration
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
