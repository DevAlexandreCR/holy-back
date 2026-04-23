-- AlterTable
ALTER TABLE `users`
  ADD COLUMN `is_system_managed` BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN `suppress_creator_notifications` BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX `users_is_system_managed_idx`
  ON `users`(`is_system_managed`);

CREATE INDEX `users_suppress_creator_notifications_idx`
  ON `users`(`suppress_creator_notifications`);

-- AlterTable
ALTER TABLE `devotionals`
  ADD COLUMN `generation_source` ENUM('USER_AUTHORED', 'HOLYVERSO_AUTOMATED') NOT NULL DEFAULT 'USER_AUTHORED',
  ADD COLUMN `generation_metadata` JSON NULL;

CREATE INDEX `devotionals_generation_source_published_at_idx`
  ON `devotionals`(`generation_source`, `published_at`);

-- CreateTable
CREATE TABLE `holyverso_generation_batches` (
  `id` CHAR(36) NOT NULL,
  `local_date` VARCHAR(191) NOT NULL,
  `author_id` CHAR(36) NOT NULL,
  `target_count` INTEGER NOT NULL DEFAULT 5,
  `published_count` INTEGER NOT NULL DEFAULT 0,
  `status` ENUM('PLANNED', 'IN_PROGRESS', 'COMPLETED', 'PARTIAL', 'FAILED') NOT NULL DEFAULT 'PLANNED',
  `started_at` DATETIME(3) NULL,
  `completed_at` DATETIME(3) NULL,
  `metadata` JSON NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,

  PRIMARY KEY (`id`),
  UNIQUE INDEX `holyverso_generation_batches_local_date_author_id_key`(`local_date`, `author_id`),
  INDEX `holyverso_generation_batches_author_id_local_date_idx`(`author_id`, `local_date`),
  INDEX `holyverso_generation_batches_status_local_date_idx`(`status`, `local_date`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `holyverso_generation_slots` (
  `id` CHAR(36) NOT NULL,
  `batch_id` CHAR(36) NOT NULL,
  `slot_index` INTEGER NOT NULL,
  `scheduled_for` DATETIME(3) NOT NULL,
  `topic_key` VARCHAR(64) NOT NULL,
  `style_key` VARCHAR(64) NOT NULL,
  `status` ENUM('PLANNED', 'PROCESSING', 'RETRY_PENDING', 'PUBLISHED', 'FAILED') NOT NULL DEFAULT 'PLANNED',
  `retry_count` INTEGER NOT NULL DEFAULT 0,
  `devotional_id` CHAR(36) NULL,
  `failure_code` VARCHAR(191) NULL,
  `metadata` JSON NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,

  PRIMARY KEY (`id`),
  UNIQUE INDEX `holyverso_generation_slots_batch_id_slot_index_key`(`batch_id`, `slot_index`),
  INDEX `holyverso_generation_slots_status_scheduled_for_idx`(`status`, `scheduled_for`),
  INDEX `holyverso_generation_slots_topic_key_scheduled_for_idx`(`topic_key`, `scheduled_for`),
  INDEX `holyverso_generation_slots_devotional_id_idx`(`devotional_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `holyverso_generation_batches`
  ADD CONSTRAINT `holyverso_generation_batches_author_id_fkey`
  FOREIGN KEY (`author_id`) REFERENCES `users`(`id`)
  ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `holyverso_generation_slots`
  ADD CONSTRAINT `holyverso_generation_slots_batch_id_fkey`
  FOREIGN KEY (`batch_id`) REFERENCES `holyverso_generation_batches`(`id`)
  ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `holyverso_generation_slots`
  ADD CONSTRAINT `holyverso_generation_slots_devotional_id_fkey`
  FOREIGN KEY (`devotional_id`) REFERENCES `devotionals`(`id`)
  ON DELETE SET NULL ON UPDATE CASCADE;
