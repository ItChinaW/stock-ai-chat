-- CreateTable
CREATE TABLE "paper_trades" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "user_id" INTEGER NOT NULL DEFAULT 1,
    "symbol" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT '',
    "strategy_code" TEXT NOT NULL,
    "init_capital" REAL NOT NULL,
    "start_date" TEXT NOT NULL,
    "current_value" REAL,
    "total_pnl" REAL,
    "total_return" REAL,
    "in_position" BOOLEAN NOT NULL DEFAULT false,
    "entry_price" REAL,
    "entry_date" TEXT,
    "trade_count" INTEGER NOT NULL DEFAULT 0,
    "trades" TEXT NOT NULL DEFAULT '[]',
    "status" TEXT NOT NULL DEFAULT 'active',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "paper_trades_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
