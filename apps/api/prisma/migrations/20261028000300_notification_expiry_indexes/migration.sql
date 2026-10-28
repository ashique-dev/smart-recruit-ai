-- Independent expiry scans must not walk the dispatch backlog.
CREATE INDEX "NotificationDelivery_expiry" ON "NotificationDelivery" ("payloadExpiresAt", id)
  WHERE status IN ('PENDING', 'SENDING', 'RETRY_WAIT');
CREATE INDEX "AuthNotificationDelivery_expiry" ON "AuthNotificationDelivery" ("payloadExpiresAt", id)
  WHERE status IN ('PENDING', 'SENDING', 'RETRY_WAIT');
