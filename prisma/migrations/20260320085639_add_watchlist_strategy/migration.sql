-- CreateTable
CREATE TABLE "watchlist" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT '',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "strategies" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_positions" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT '',
    "cost_price" REAL NOT NULL,
    "amount" REAL NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);
INSERT INTO "new_positions" ("amount", "code", "cost_price", "created_at", "id", "updated_at") SELECT "amount", "code", "cost_price", "created_at", "id", "updated_at" FROM "positions";
DROP TABLE "positions";
ALTER TABLE "new_positions" RENAME TO "positions";
CREATE TABLE "new_trade_logs" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "code" TEXT NOT NULL,
    "date" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ai_suggestion" TEXT NOT NULL,
    "user_action" TEXT NOT NULL,
    "pnl_after_action" REAL,
    "strategy_id" INTEGER,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "trade_logs_strategy_id_fkey" FOREIGN KEY ("strategy_id") REFERENCES "strategies" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_trade_logs" ("ai_suggestion", "code", "created_at", "date", "id", "pnl_after_action", "strategy_id", "user_action") SELECT "ai_suggestion", "code", "created_at", "date", "id", "pnl_after_action", "strategy_id", "user_action" FROM "trade_logs";
DROP TABLE "trade_logs";
ALTER TABLE "new_trade_logs" RENAME TO "trade_logs";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "watchlist_code_key" ON "watchlist"("code");
