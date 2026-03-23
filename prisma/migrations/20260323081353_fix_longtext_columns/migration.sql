-- AlterTable
ALTER TABLE `backtests` MODIFY `equity_curve` LONGTEXT NULL,
    MODIFY `trades` LONGTEXT NULL,
    MODIFY `error_msg` TEXT NULL;

-- AlterTable
ALTER TABLE `paper_trades` MODIFY `trades` LONGTEXT NULL;
