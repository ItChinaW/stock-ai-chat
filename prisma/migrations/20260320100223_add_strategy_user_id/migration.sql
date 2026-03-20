-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_strategies" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "user_id" INTEGER NOT NULL DEFAULT 1,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    CONSTRAINT "strategies_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_strategies" ("description", "id", "name") SELECT "description", "id", "name" FROM "strategies";
DROP TABLE "strategies";
ALTER TABLE "new_strategies" RENAME TO "strategies";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
