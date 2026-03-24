-- AlterTable
ALTER TABLE `chat_messages` MODIFY `content` TEXT NOT NULL;

-- AlterTable
ALTER TABLE `strategies` MODIFY `description` TEXT NOT NULL;

-- AlterTable
ALTER TABLE `trade_logs` MODIFY `ai_suggestion` TEXT NOT NULL;
