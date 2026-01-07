-- Add soft delete columns to users
ALTER TABLE `users`
  ADD COLUMN `deleted_at` DATETIME(3) NULL,
  ADD COLUMN `deleted_reason` VARCHAR(191) NULL;
