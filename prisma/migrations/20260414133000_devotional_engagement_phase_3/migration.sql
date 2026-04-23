SET @add_streak_risk_notifications_enabled = (
  SELECT IF(
    EXISTS(
      SELECT 1
      FROM `information_schema`.`COLUMNS`
      WHERE `TABLE_SCHEMA` = DATABASE()
        AND `TABLE_NAME` = 'user_settings'
        AND `COLUMN_NAME` = 'streak_risk_notifications_enabled'
    ),
    'SELECT 1',
    'ALTER TABLE `user_settings` ADD COLUMN `streak_risk_notifications_enabled` BOOLEAN NOT NULL DEFAULT true AFTER `featured_devotional_notifications_enabled`'
  )
);

PREPARE add_streak_risk_notifications_enabled_stmt FROM @add_streak_risk_notifications_enabled;
EXECUTE add_streak_risk_notifications_enabled_stmt;
DEALLOCATE PREPARE add_streak_risk_notifications_enabled_stmt;

ALTER TABLE `devotional_notification_sends`
  MODIFY `type` ENUM(
    'FOLLOWED_CREATOR_NEW_DEVOTIONAL',
    'FEATURED_DEVOTIONAL',
    'STREAK_AT_RISK',
    'EDITOR_DEVOTIONAL_REVIEW_REQUIRED',
    'AUTHOR_DEVOTIONAL_APPROVED',
    'AUTHOR_DEVOTIONAL_RESTRICTED'
  ) NOT NULL;

CREATE TABLE IF NOT EXISTS `devotional_tags` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `name` VARCHAR(64) NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,

  UNIQUE INDEX `devotional_tags_name_key`(`name`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `devotional_tag_assignments` (
  `devotional_id` CHAR(36) NOT NULL,
  `tag_id` INTEGER NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  INDEX `devotional_tag_assignments_tag_id_idx`(`tag_id`),
  PRIMARY KEY (`devotional_id`, `tag_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `user_devotional_tag_affinity` (
  `user_id` CHAR(36) NOT NULL,
  `tag_id` INTEGER NOT NULL,
  `score` DOUBLE NOT NULL DEFAULT 0,
  `last_signal_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `last_decay_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,

  INDEX `user_devotional_tag_affinity_tag_id_score_idx`(`tag_id`, `score`),
  INDEX `user_devotional_tag_affinity_user_id_score_idx`(`user_id`, `score`),
  PRIMARY KEY (`user_id`, `tag_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `devotional_daily_feature_candidates` (
  `id` CHAR(36) NOT NULL,
  `local_date` VARCHAR(191) NOT NULL,
  `devotional_id` CHAR(36) NOT NULL,
  `base_score` DOUBLE NOT NULL DEFAULT 0,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,

  UNIQUE INDEX `devotional_daily_feature_candidates_local_date_devotional_id_key`(`local_date`, `devotional_id`),
  INDEX `devotional_daily_feature_candidates_local_date_base_score_idx`(`local_date`, `base_score`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `user_daily_featured_devotionals` (
  `user_id` CHAR(36) NOT NULL,
  `local_date` VARCHAR(191) NOT NULL,
  `devotional_id` CHAR(36) NOT NULL,
  `candidate_id` CHAR(36) NOT NULL,
  `selection_mode` ENUM('BASE_SCORE', 'BASE_SCORE_PLUS_AFFINITY') NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  INDEX `user_daily_featured_devotionals_devotional_id_idx`(`devotional_id`),
  INDEX `user_daily_featured_devotionals_candidate_id_idx`(`candidate_id`),
  PRIMARY KEY (`user_id`, `local_date`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `devotional_affinity_signal_events` (
  `id` CHAR(36) NOT NULL,
  `user_id` CHAR(36) NOT NULL,
  `devotional_id` CHAR(36) NOT NULL,
  `signal_type` ENUM('READ_COMPLETE', 'SAVE', 'SHARE') NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  UNIQUE INDEX `dev_aff_sig_evt_user_dev_sig_key`(`user_id`, `devotional_id`, `signal_type`),
  INDEX `devotional_affinity_signal_events_devotional_id_signal_type_idx`(`devotional_id`, `signal_type`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `devotional_tag_assignments`
  ADD CONSTRAINT `devotional_tag_assignments_devotional_id_fkey`
  FOREIGN KEY (`devotional_id`) REFERENCES `devotionals`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `devotional_tag_assignments_tag_id_fkey`
  FOREIGN KEY (`tag_id`) REFERENCES `devotional_tags`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `user_devotional_tag_affinity`
  ADD CONSTRAINT `user_devotional_tag_affinity_user_id_fkey`
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `user_devotional_tag_affinity_tag_id_fkey`
  FOREIGN KEY (`tag_id`) REFERENCES `devotional_tags`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `devotional_daily_feature_candidates`
  ADD CONSTRAINT `devotional_daily_feature_candidates_devotional_id_fkey`
  FOREIGN KEY (`devotional_id`) REFERENCES `devotionals`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `user_daily_featured_devotionals`
  ADD CONSTRAINT `user_daily_featured_devotionals_user_id_fkey`
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `user_daily_featured_devotionals_devotional_id_fkey`
  FOREIGN KEY (`devotional_id`) REFERENCES `devotionals`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `user_daily_featured_devotionals_candidate_id_fkey`
  FOREIGN KEY (`candidate_id`) REFERENCES `devotional_daily_feature_candidates`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `devotional_affinity_signal_events`
  ADD CONSTRAINT `devotional_affinity_signal_events_user_id_fkey`
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `devotional_affinity_signal_events_devotional_id_fkey`
  FOREIGN KEY (`devotional_id`) REFERENCES `devotionals`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

INSERT IGNORE INTO `devotional_tags` (`name`, `created_at`, `updated_at`)
VALUES
  ('esperanza', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
  ('ansiedad', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
  ('propósito', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
  ('disciplina', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
  ('fe', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
  ('trabajo', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
  ('relaciones', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3));
