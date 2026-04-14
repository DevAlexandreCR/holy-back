CREATE TABLE `user_streaks` (
  `user_id` CHAR(36) NOT NULL,
  `current_streak` INTEGER NOT NULL DEFAULT 0,
  `longest_streak` INTEGER NOT NULL DEFAULT 0,
  `last_completed_date` VARCHAR(191) NULL,
  `streak_freeze_count` INTEGER NOT NULL DEFAULT 0,
  `freeze_progress_count` INTEGER NOT NULL DEFAULT 0,
  `last_gap_evaluated_date` VARCHAR(191) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,

  PRIMARY KEY (`user_id`),
  INDEX `user_streaks_current_streak_idx`(`current_streak`),
  INDEX `user_streaks_last_completed_date_idx`(`last_completed_date`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `user_streak_freeze_events` (
  `id` CHAR(36) NOT NULL,
  `user_id` CHAR(36) NOT NULL,
  `event_type` ENUM('GRANTED', 'GRANT_SKIPPED_AT_CAP', 'CONSUMED', 'RESET') NOT NULL,
  `amount` INTEGER NOT NULL,
  `balance_after` INTEGER NOT NULL,
  `reason` VARCHAR(191) NOT NULL,
  `metadata` JSON NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  PRIMARY KEY (`id`),
  INDEX `user_streak_freeze_events_user_id_created_at_idx`(`user_id`, `created_at`),
  INDEX `user_streak_freeze_events_event_type_created_at_idx`(`event_type`, `created_at`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `user_streaks`
  ADD CONSTRAINT `user_streaks_user_id_fkey`
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `user_streak_freeze_events`
  ADD CONSTRAINT `user_streak_freeze_events_user_id_fkey`
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
