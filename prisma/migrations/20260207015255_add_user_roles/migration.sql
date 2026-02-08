-- DropForeignKey
ALTER TABLE `user_verse_history` DROP FOREIGN KEY `user_verse_history_user_id_fkey`;

-- AlterTable
ALTER TABLE `user_verse_history` MODIFY `user_id` VARCHAR(191) NOT NULL;

-- AlterTable
ALTER TABLE `users` ADD COLUMN `role` ENUM('USER', 'EDITOR', 'LEAD', 'ADMIN') NOT NULL DEFAULT 'USER';

-- AddForeignKey
ALTER TABLE `user_verse_history` ADD CONSTRAINT `user_verse_history_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
