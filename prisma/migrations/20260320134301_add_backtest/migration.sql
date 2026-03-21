-- CreateTable
CREATE TABLE "backtests" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "user_id" INTEGER NOT NULL DEFAULT 1,
    "name" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "strategy_code" TEXT NOT NULL,
    "params" TEXT NOT NULL DEFAULT '{}',
    "start_date" TEXT NOT NULL,
    "end_date" TEXT NOT NULL,
    "init_capital" REAL NOT NULL DEFAULT 100000,
    "mode" TEXT NOT NULL DEFAULT 'compound',
    "total_return" REAL,
    "annual_return" REAL,
    "max_drawdown" REAL,
    "trade_count" INTEGER,
    "win_rate" REAL,
    "sharpe" REAL,
    "equity_curve" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "error_msg" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "backtests_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
