-- CreateTable
CREATE TABLE `users` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(191) NOT NULL DEFAULT 'default',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `positions` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `user_id` INTEGER NOT NULL DEFAULT 1,
    `code` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL DEFAULT '',
    `cost_price` DOUBLE NOT NULL,
    `amount` DOUBLE NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `watchlist` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `user_id` INTEGER NOT NULL DEFAULT 1,
    `code` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL DEFAULT '',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `watchlist_user_id_code_key`(`user_id`, `code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `strategies` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `user_id` INTEGER NOT NULL DEFAULT 1,
    `name` VARCHAR(191) NOT NULL,
    `description` VARCHAR(191) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `trade_logs` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `user_id` INTEGER NOT NULL DEFAULT 1,
    `code` VARCHAR(191) NOT NULL,
    `date` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `ai_suggestion` VARCHAR(191) NOT NULL,
    `user_action` VARCHAR(191) NOT NULL,
    `pnl_after_action` DOUBLE NULL,
    `strategy_id` INTEGER NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `backtests` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `user_id` INTEGER NOT NULL DEFAULT 1,
    `name` VARCHAR(191) NOT NULL,
    `symbol` VARCHAR(191) NOT NULL,
    `strategy_code` VARCHAR(191) NOT NULL,
    `params` VARCHAR(191) NOT NULL DEFAULT '{}',
    `start_date` VARCHAR(191) NOT NULL,
    `end_date` VARCHAR(191) NOT NULL,
    `init_capital` DOUBLE NOT NULL DEFAULT 100000,
    `mode` VARCHAR(191) NOT NULL DEFAULT 'compound',
    `total_return` DOUBLE NULL,
    `total_pnl` DOUBLE NULL,
    `annual_return` DOUBLE NULL,
    `max_drawdown` DOUBLE NULL,
    `trade_count` INTEGER NULL,
    `win_rate` DOUBLE NULL,
    `sharpe` DOUBLE NULL,
    `sortino` DOUBLE NULL,
    `calmar` DOUBLE NULL,
    `avg_hold_days` DOUBLE NULL,
    `avg_win` DOUBLE NULL,
    `avg_loss` DOUBLE NULL,
    `profit_factor` DOUBLE NULL,
    `equity_curve` VARCHAR(191) NULL,
    `trades` VARCHAR(191) NULL DEFAULT '[]',
    `status` VARCHAR(191) NOT NULL DEFAULT 'pending',
    `error_msg` VARCHAR(191) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `chat_sessions` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `user_id` INTEGER NOT NULL DEFAULT 1,
    `code` VARCHAR(191) NOT NULL,
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `chat_sessions_user_id_code_key`(`user_id`, `code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `chat_messages` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `session_id` INTEGER NOT NULL,
    `role` VARCHAR(191) NOT NULL,
    `content` VARCHAR(191) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `paper_trades` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `user_id` INTEGER NOT NULL DEFAULT 1,
    `symbol` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL DEFAULT '',
    `strategy_code` VARCHAR(191) NOT NULL,
    `init_capital` DOUBLE NOT NULL,
    `start_date` VARCHAR(191) NOT NULL,
    `current_value` DOUBLE NULL,
    `total_pnl` DOUBLE NULL,
    `total_return` DOUBLE NULL,
    `in_position` BOOLEAN NOT NULL DEFAULT false,
    `entry_price` DOUBLE NULL,
    `entry_date` VARCHAR(191) NULL,
    `trade_count` INTEGER NOT NULL DEFAULT 0,
    `trades` VARCHAR(191) NOT NULL DEFAULT '[]',
    `status` VARCHAR(191) NOT NULL DEFAULT 'active',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `crypto_bots` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `user_id` INTEGER NOT NULL DEFAULT 1,
    `symbol` VARCHAR(191) NOT NULL,
    `strategy_code` VARCHAR(191) NOT NULL,
    `params` VARCHAR(191) NOT NULL DEFAULT '{}',
    `interval` VARCHAR(191) NOT NULL DEFAULT '1d',
    `quote_qty` DOUBLE NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'stopped',
    `in_position` BOOLEAN NOT NULL DEFAULT false,
    `entry_price` DOUBLE NULL,
    `entry_date` VARCHAR(191) NULL,
    `last_checked` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `crypto_trades` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `bot_id` INTEGER NOT NULL,
    `symbol` VARCHAR(191) NOT NULL,
    `side` VARCHAR(191) NOT NULL,
    `price` DOUBLE NOT NULL,
    `qty` DOUBLE NOT NULL,
    `quote_qty` DOUBLE NOT NULL,
    `order_id` VARCHAR(191) NOT NULL DEFAULT '',
    `pnl` DOUBLE NULL,
    `pnl_pct` DOUBLE NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `stock_snapshots` (
    `code` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL DEFAULT '',
    `price` DOUBLE NOT NULL DEFAULT 0,
    `changePct` DOUBLE NOT NULL DEFAULT 0,
    `changeAmt` DOUBLE NOT NULL DEFAULT 0,
    `volume` DOUBLE NOT NULL DEFAULT 0,
    `amount` DOUBLE NOT NULL DEFAULT 0,
    `amplitude` DOUBLE NOT NULL DEFAULT 0,
    `high` DOUBLE NOT NULL DEFAULT 0,
    `low` DOUBLE NOT NULL DEFAULT 0,
    `open` DOUBLE NOT NULL DEFAULT 0,
    `prevClose` DOUBLE NOT NULL DEFAULT 0,
    `turnover` DOUBLE NOT NULL DEFAULT 0,
    `pe` DOUBLE NOT NULL DEFAULT 0,
    `pb` DOUBLE NOT NULL DEFAULT 0,
    `marketCap` DOUBLE NOT NULL DEFAULT 0,
    `floatCap` DOUBLE NOT NULL DEFAULT 0,
    `updated_at` DATETIME(3) NOT NULL,

    PRIMARY KEY (`code`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `positions` ADD CONSTRAINT `positions_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `watchlist` ADD CONSTRAINT `watchlist_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `strategies` ADD CONSTRAINT `strategies_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `trade_logs` ADD CONSTRAINT `trade_logs_strategy_id_fkey` FOREIGN KEY (`strategy_id`) REFERENCES `strategies`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `trade_logs` ADD CONSTRAINT `trade_logs_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `backtests` ADD CONSTRAINT `backtests_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `chat_sessions` ADD CONSTRAINT `chat_sessions_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `chat_messages` ADD CONSTRAINT `chat_messages_session_id_fkey` FOREIGN KEY (`session_id`) REFERENCES `chat_sessions`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `paper_trades` ADD CONSTRAINT `paper_trades_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `crypto_bots` ADD CONSTRAINT `crypto_bots_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `crypto_trades` ADD CONSTRAINT `crypto_trades_bot_id_fkey` FOREIGN KEY (`bot_id`) REFERENCES `crypto_bots`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
