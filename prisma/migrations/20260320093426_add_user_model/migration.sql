-- CreateTable
CREATE TABLE "users" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL DEFAULT 'default',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_chat_sessions" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "user_id" INTEGER NOT NULL DEFAULT 1,
    "code" TEXT NOT NULL,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "chat_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_chat_sessions" ("code", "id", "updated_at") SELECT "code", "id", "updated_at" FROM "chat_sessions";
DROP TABLE "chat_sessions";
ALTER TABLE "new_chat_sessions" RENAME TO "chat_sessions";
CREATE UNIQUE INDEX "chat_sessions_user_id_code_key" ON "chat_sessions"("user_id", "code");
CREATE TABLE "new_positions" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "user_id" INTEGER NOT NULL DEFAULT 1,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT '',
    "cost_price" REAL NOT NULL,
    "amount" REAL NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "positions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_positions" ("amount", "code", "cost_price", "created_at", "id", "name", "updated_at") SELECT "amount", "code", "cost_price", "created_at", "id", "name", "updated_at" FROM "positions";
DROP TABLE "positions";
ALTER TABLE "new_positions" RENAME TO "positions";
CREATE TABLE "new_trade_logs" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "user_id" INTEGER NOT NULL DEFAULT 1,
    "code" TEXT NOT NULL,
    "date" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ai_suggestion" TEXT NOT NULL,
    "user_action" TEXT NOT NULL,
    "pnl_after_action" REAL,
    "strategy_id" INTEGER,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "trade_logs_strategy_id_fkey" FOREIGN KEY ("strategy_id") REFERENCES "strategies" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "trade_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_trade_logs" ("ai_suggestion", "code", "created_at", "date", "id", "pnl_after_action", "strategy_id", "user_action") SELECT "ai_suggestion", "code", "created_at", "date", "id", "pnl_after_action", "strategy_id", "user_action" FROM "trade_logs";
DROP TABLE "trade_logs";
ALTER TABLE "new_trade_logs" RENAME TO "trade_logs";
CREATE TABLE "new_watchlist" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "user_id" INTEGER NOT NULL DEFAULT 1,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT '',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "watchlist_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_watchlist" ("code", "created_at", "id", "name") SELECT "code", "created_at", "id", "name" FROM "watchlist";
DROP TABLE "watchlist";
ALTER TABLE "new_watchlist" RENAME TO "watchlist";
CREATE UNIQUE INDEX "watchlist_user_id_code_key" ON "watchlist"("user_id", "code");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
