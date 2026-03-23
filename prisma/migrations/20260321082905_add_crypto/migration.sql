-- CreateTable
CREATE TABLE "crypto_bots" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "user_id" INTEGER NOT NULL DEFAULT 1,
    "symbol" TEXT NOT NULL,
    "strategy_code" TEXT NOT NULL,
    "params" TEXT NOT NULL DEFAULT '{}',
    "interval" TEXT NOT NULL DEFAULT '1d',
    "quote_qty" REAL NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'stopped',
    "in_position" BOOLEAN NOT NULL DEFAULT false,
    "entry_price" REAL,
    "entry_date" TEXT,
    "last_checked" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "crypto_bots_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "crypto_trades" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "bot_id" INTEGER NOT NULL,
    "symbol" TEXT NOT NULL,
    "side" TEXT NOT NULL,
    "price" REAL NOT NULL,
    "qty" REAL NOT NULL,
    "quote_qty" REAL NOT NULL,
    "order_id" TEXT NOT NULL DEFAULT '',
    "pnl" REAL,
    "pnl_pct" REAL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "crypto_trades_bot_id_fkey" FOREIGN KEY ("bot_id") REFERENCES "crypto_bots" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
