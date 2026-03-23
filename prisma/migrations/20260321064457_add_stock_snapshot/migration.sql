-- CreateTable
CREATE TABLE "stock_snapshots" (
    "code" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL DEFAULT '',
    "price" REAL NOT NULL DEFAULT 0,
    "changePct" REAL NOT NULL DEFAULT 0,
    "changeAmt" REAL NOT NULL DEFAULT 0,
    "volume" REAL NOT NULL DEFAULT 0,
    "amount" REAL NOT NULL DEFAULT 0,
    "amplitude" REAL NOT NULL DEFAULT 0,
    "high" REAL NOT NULL DEFAULT 0,
    "low" REAL NOT NULL DEFAULT 0,
    "open" REAL NOT NULL DEFAULT 0,
    "prevClose" REAL NOT NULL DEFAULT 0,
    "turnover" REAL NOT NULL DEFAULT 0,
    "pe" REAL NOT NULL DEFAULT 0,
    "pb" REAL NOT NULL DEFAULT 0,
    "marketCap" REAL NOT NULL DEFAULT 0,
    "floatCap" REAL NOT NULL DEFAULT 0,
    "updated_at" DATETIME NOT NULL
);
