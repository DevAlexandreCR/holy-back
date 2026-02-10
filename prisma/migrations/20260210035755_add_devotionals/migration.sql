-- CreateTable
CREATE TABLE `devotionals` (
    `id` CHAR(36) NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `content` JSON NOT NULL,
    `author_id` CHAR(36) NOT NULL,
    `status` ENUM('DRAFT', 'PUBLISHED', 'ARCHIVED') NOT NULL DEFAULT 'DRAFT',
    `cover_image_url` VARCHAR(191) NULL,
    `view_count` INTEGER NOT NULL DEFAULT 0,
    `published_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `devotionals_status_published_at_idx`(`status`, `published_at`),
    INDEX `devotionals_author_id_idx`(`author_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `devotional_verse_references` (
    `id` CHAR(36) NOT NULL,
    `devotional_id` CHAR(36) NOT NULL,
    `book` VARCHAR(191) NOT NULL,
    `chapter` INTEGER NOT NULL,
    `verse_start` INTEGER NOT NULL,
    `verse_end` INTEGER NULL,
    `is_primary` BOOLEAN NOT NULL DEFAULT false,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `devotional_verse_references_devotional_id_idx`(`devotional_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `devotional_likes` (
    `id` CHAR(36) NOT NULL,
    `devotional_id` CHAR(36) NOT NULL,
    `user_id` CHAR(36) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `devotional_likes_devotional_id_idx`(`devotional_id`),
    INDEX `devotional_likes_user_id_idx`(`user_id`),
    UNIQUE INDEX `devotional_likes_devotional_id_user_id_key`(`devotional_id`, `user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `devotional_comments` (
    `id` CHAR(36) NOT NULL,
    `devotional_id` CHAR(36) NOT NULL,
    `user_id` CHAR(36) NOT NULL,
    `content` TEXT NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `devotional_comments_devotional_id_idx`(`devotional_id`),
    INDEX `devotional_comments_user_id_idx`(`user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `devotional_views` (
    `id` CHAR(36) NOT NULL,
    `devotional_id` CHAR(36) NOT NULL,
    `user_id` CHAR(36) NOT NULL,
    `view_date` VARCHAR(191) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `devotional_views_devotional_id_idx`(`devotional_id`),
    INDEX `devotional_views_user_id_idx`(`user_id`),
    UNIQUE INDEX `devotional_views_devotional_id_user_id_view_date_key`(`devotional_id`, `user_id`, `view_date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `devotionals` ADD CONSTRAINT `devotionals_author_id_fkey` FOREIGN KEY (`author_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `devotional_verse_references` ADD CONSTRAINT `devotional_verse_references_devotional_id_fkey` FOREIGN KEY (`devotional_id`) REFERENCES `devotionals`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `devotional_likes` ADD CONSTRAINT `devotional_likes_devotional_id_fkey` FOREIGN KEY (`devotional_id`) REFERENCES `devotionals`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `devotional_likes` ADD CONSTRAINT `devotional_likes_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `devotional_comments` ADD CONSTRAINT `devotional_comments_devotional_id_fkey` FOREIGN KEY (`devotional_id`) REFERENCES `devotionals`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `devotional_comments` ADD CONSTRAINT `devotional_comments_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `devotional_views` ADD CONSTRAINT `devotional_views_devotional_id_fkey` FOREIGN KEY (`devotional_id`) REFERENCES `devotionals`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `devotional_views` ADD CONSTRAINT `devotional_views_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
