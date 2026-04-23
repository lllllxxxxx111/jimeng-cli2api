/*
  Warnings:

  - You are about to drop the column `oauthDeviceCode` on the `JimengAccount` table. All the data in the column will be lost.
  - You are about to drop the column `oauthExpiresAt` on the `JimengAccount` table. All the data in the column will be lost.
  - You are about to drop the column `oauthUserCode` on the `JimengAccount` table. All the data in the column will be lost.
  - You are about to drop the column `oauthVerificationUri` on the `JimengAccount` table. All the data in the column will be lost.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_JimengAccount" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "homeDir" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'IDLE',
    "creditBalance" INTEGER NOT NULL DEFAULT 0,
    "lastChecked" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_JimengAccount" ("createdAt", "creditBalance", "homeDir", "id", "lastChecked", "name", "status", "updatedAt") SELECT "createdAt", "creditBalance", "homeDir", "id", "lastChecked", "name", "status", "updatedAt" FROM "JimengAccount";
DROP TABLE "JimengAccount";
ALTER TABLE "new_JimengAccount" RENAME TO "JimengAccount";
CREATE UNIQUE INDEX "JimengAccount_name_key" ON "JimengAccount"("name");
CREATE UNIQUE INDEX "JimengAccount_homeDir_key" ON "JimengAccount"("homeDir");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
