CREATE TABLE `devotional_audio_assets` (
    `id` CHAR(36) NOT NULL,
    `devotional_id` CHAR(36) NOT NULL,
    `voice` VARCHAR(64) NOT NULL,
    `model` VARCHAR(128) NOT NULL,
    `narration_hash` CHAR(64) NOT NULL,
    `status` ENUM('GENERATING', 'READY', 'FAILED') NOT NULL DEFAULT 'GENERATING',
    `segments` JSON NULL,
    `failure_code` VARCHAR(191) NULL,
    `failure_message` VARCHAR(500) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `completed_at` DATETIME(3) NULL,

    UNIQUE INDEX `devotional_audio_cache_key`(`devotional_id`, `voice`, `model`, `narration_hash`),
    INDEX `devotional_audio_assets_devotional_id_status_idx`(`devotional_id`, `status`),
    INDEX `devotional_audio_assets_status_updated_at_idx`(`status`, `updated_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `devotional_audio_assets`
    ADD CONSTRAINT `devotional_audio_assets_devotional_id_fkey`
    FOREIGN KEY (`devotional_id`) REFERENCES `devotionals`(`id`)
    ON DELETE CASCADE ON UPDATE CASCADE;
