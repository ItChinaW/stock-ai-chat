-- AlterTable
ALTER TABLE "backtests" ADD COLUMN "avg_hold_days" REAL;
ALTER TABLE "backtests" ADD COLUMN "avg_loss" REAL;
ALTER TABLE "backtests" ADD COLUMN "avg_win" REAL;
ALTER TABLE "backtests" ADD COLUMN "calmar" REAL;
ALTER TABLE "backtests" ADD COLUMN "profit_factor" REAL;
ALTER TABLE "backtests" ADD COLUMN "sortino" REAL;
ALTER TABLE "backtests" ADD COLUMN "total_pnl" REAL;
