export type NotificationPreferenceSettings = {
  devotionalNotificationsEnabled: boolean
  followedCreatorNotificationsEnabled: boolean
  featuredDevotionalNotificationsEnabled: boolean
  streakRiskNotificationsEnabled: boolean
  authorModerationNotificationsEnabled: boolean
  editorReviewNotificationsEnabled: boolean
  socialActivityNotificationsEnabled: boolean
  commentNotificationsEnabled: boolean
  followNotificationsEnabled: boolean
  reactionNotificationsEnabled: boolean
}

export const formatNotificationPreferences = (
  settings: NotificationPreferenceSettings
) => ({
  devotional_notifications_enabled: settings.devotionalNotificationsEnabled,
  followed_creator_notifications_enabled:
    settings.followedCreatorNotificationsEnabled,
  featured_devotional_notifications_enabled:
    settings.featuredDevotionalNotificationsEnabled,
  streak_risk_notifications_enabled: settings.streakRiskNotificationsEnabled,
  author_moderation_notifications_enabled:
    settings.authorModerationNotificationsEnabled,
  editor_review_notifications_enabled:
    settings.editorReviewNotificationsEnabled,
  social_activity_notifications_enabled:
    settings.socialActivityNotificationsEnabled,
  comment_notifications_enabled: settings.commentNotificationsEnabled,
  follow_notifications_enabled: settings.followNotificationsEnabled,
  reaction_notifications_enabled: settings.reactionNotificationsEnabled,
})
