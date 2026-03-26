ALTER TABLE `user_settings`
  ADD COLUMN `author_moderation_notifications_enabled` BOOLEAN NOT NULL DEFAULT true AFTER `featured_devotional_notifications_enabled`,
  ADD COLUMN `editor_review_notifications_enabled` BOOLEAN NOT NULL DEFAULT true AFTER `author_moderation_notifications_enabled`;

ALTER TABLE `devotional_notification_sends`
  MODIFY COLUMN `type` ENUM(
    'FOLLOWED_CREATOR_NEW_DEVOTIONAL',
    'FEATURED_DEVOTIONAL',
    'EDITOR_DEVOTIONAL_REVIEW_REQUIRED',
    'AUTHOR_DEVOTIONAL_APPROVED',
    'AUTHOR_DEVOTIONAL_RESTRICTED'
  ) NOT NULL;

ALTER TABLE `notification_daily_metrics`
  MODIFY COLUMN `notification_type` ENUM(
    'FOLLOWED_CREATOR_NEW_DEVOTIONAL',
    'FEATURED_DEVOTIONAL',
    'EDITOR_DEVOTIONAL_REVIEW_REQUIRED',
    'AUTHOR_DEVOTIONAL_APPROVED',
    'AUTHOR_DEVOTIONAL_RESTRICTED'
  ) NOT NULL;
