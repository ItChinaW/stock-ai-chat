/*
  Warnings:

  - You are about to drop the column `avg_price` on the `positions` table. All the data in the column will be lost.
  - You are about to drop the column `name` on the `positions` table. All the data in the column will be lost.
  - Added the required column `cost_price` to the `positions` table without a default value. This is not possible if the table is not empty.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_positions" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "code" TEXT NOT NULL,
    "cost_price" REAL NOT NULL,
    "amount" REAL NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);
INSERT INTO "new_positions" ("amount", "code", "created_at", "id", "updated_at") SELECT "amount", "code", "created_at", "id", "updated_at" FROM "positions";
DROP TABLE "positions";
ALTER TABLE "new_positions" RENAME TO "positions";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
