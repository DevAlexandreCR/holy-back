ALTER TABLE `user_streaks`
  ADD INDEX `user_streaks_current_streak_user_id_idx`(`current_streak`, `user_id`),
  ADD INDEX `user_streaks_last_completed_date_user_id_idx`(`last_completed_date`, `user_id`),
  ADD INDEX `user_streaks_last_gap_evaluated_date_user_id_idx`(`last_gap_evaluated_date`, `user_id`);

ALTER TABLE `user_streak_freeze_events`
  ADD INDEX `user_streak_freeze_events_user_id_event_type_created_at_idx`(`user_id`, `event_type`, `created_at`);

ALTER TABLE `devotional_tag_assignments`
  ADD INDEX `devotional_tag_assignments_tag_id_devotional_id_idx`(`tag_id`, `devotional_id`);

ALTER TABLE `devotional_daily_feature_candidates`
  ADD INDEX `devotional_daily_feature_candidates_local_date_updated_at_idx`(`local_date`, `updated_at`),
  ADD INDEX `devotional_daily_feature_candidates_devotional_id_local_date_idx`(`devotional_id`, `local_date`);

ALTER TABLE `user_daily_featured_devotionals`
  ADD INDEX `user_daily_featured_devotionals_local_date_selection_mode_idx`(`local_date`, `selection_mode`),
  ADD INDEX `user_daily_featured_devotionals_local_date_devotional_id_idx`(`local_date`, `devotional_id`);

ALTER TABLE `devotional_feed_events`
  ADD INDEX `devotional_feed_events_delivery_id_type_occurred_at_idx`(`delivery_id`, `type`, `occurred_at`);

ALTER TABLE `devotional_saves`
  ADD INDEX `devotional_saves_delivery_id_created_at_idx`(`delivery_id`, `created_at`);

ALTER TABLE `devotional_share_events`
  ADD INDEX `devotional_share_events_delivery_id_created_at_idx`(`delivery_id`, `created_at`);

ALTER TABLE `devotional_read_completions`
  ADD INDEX `devotional_read_completions_delivery_id_created_at_idx`(`delivery_id`, `created_at`);

ALTER TABLE `devotional_notification_sends`
  ADD INDEX `devotional_notification_sends_user_id_type_provider_accepted_at_idx`(`user_id`, `type`, `provider_accepted_at`),
  ADD INDEX `devotional_notification_sends_user_id_type_opened_at_idx`(`user_id`, `type`, `opened_at`);

CREATE TABLE `devotional_notification_evaluation_daily_metrics` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `date` VARCHAR(191) NOT NULL,
  `notification_type` ENUM(
    'FOLLOWED_CREATOR_NEW_DEVOTIONAL',
    'FEATURED_DEVOTIONAL',
    'STREAK_AT_RISK',
    'EDITOR_DEVOTIONAL_REVIEW_REQUIRED',
    'AUTHOR_DEVOTIONAL_APPROVED',
    'AUTHOR_DEVOTIONAL_RESTRICTED'
  ) NOT NULL,
  `evaluated_count` INTEGER NOT NULL DEFAULT 0,
  `eligible_count` INTEGER NOT NULL DEFAULT 0,
  `skipped_count` INTEGER NOT NULL DEFAULT 0,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,

  UNIQUE INDEX `devotional_notification_evaluation_daily_metrics_date_notification_type_key`(`date`, `notification_type`),
  INDEX `devotional_notification_evaluation_daily_metrics_notification_type_date_idx`(`notification_type`, `date`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `daily_featured_engagement_daily_metrics` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `date` VARCHAR(191) NOT NULL,
  `selection_mode` ENUM('BASE_SCORE', 'BASE_SCORE_PLUS_AFFINITY') NOT NULL,
  `locks_created` INTEGER NOT NULL DEFAULT 0,
  `selected_devotional_read_completes` INTEGER NOT NULL DEFAULT 0,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,

  UNIQUE INDEX `daily_featured_engagement_daily_metrics_date_selection_mode_key`(`date`, `selection_mode`),
  INDEX `daily_featured_engagement_daily_metrics_selection_mode_date_idx`(`selection_mode`, `date`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `devotional_tag_engagement_daily_metrics` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `date` VARCHAR(191) NOT NULL,
  `tag_id` INTEGER NOT NULL,
  `deliveries` INTEGER NOT NULL DEFAULT 0,
  `opens` INTEGER NOT NULL DEFAULT 0,
  `read_completes` INTEGER NOT NULL DEFAULT 0,
  `saves` INTEGER NOT NULL DEFAULT 0,
  `shares` INTEGER NOT NULL DEFAULT 0,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,

  UNIQUE INDEX `devotional_tag_engagement_daily_metrics_date_tag_id_key`(`date`, `tag_id`),
  INDEX `devotional_tag_engagement_daily_metrics_tag_id_date_idx`(`tag_id`, `date`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `devotional_tag_engagement_daily_metrics`
  ADD CONSTRAINT `devotional_tag_engagement_daily_metrics_tag_id_fkey`
  FOREIGN KEY (`tag_id`) REFERENCES `devotional_tags`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
