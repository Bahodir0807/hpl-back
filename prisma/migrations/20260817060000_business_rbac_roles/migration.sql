-- BUSINESS PASS 4: replace RoleName enum.
-- PostgreSQL cannot drop a single enum value in-place, so this migration:
-- 1) removes obsolete OBSERVER role assignments (User rows are preserved)
-- 2) deletes the OBSERVER Role row
-- 3) recreates RoleName with DIRECTOR / ACCOUNTANT / INSTALLER and without OBSERVER
-- Existing ADMIN / HEAD / MANAGER / STOREKEEPER role rows keep their ids.

DELETE FROM "UserRole"
WHERE "roleId" IN (SELECT "id" FROM "Role" WHERE "name"::text = 'OBSERVER');

DELETE FROM "RolePermission"
WHERE "roleId" IN (SELECT "id" FROM "Role" WHERE "name"::text = 'OBSERVER');

DELETE FROM "Role" WHERE "name"::text = 'OBSERVER';

CREATE TYPE "RoleName_new" AS ENUM (
  'ADMIN',
  'DIRECTOR',
  'HEAD',
  'MANAGER',
  'ACCOUNTANT',
  'STOREKEEPER',
  'INSTALLER'
);

ALTER TABLE "Role"
  ALTER COLUMN "name" TYPE "RoleName_new"
  USING ("name"::text::"RoleName_new");

DROP TYPE "RoleName";

ALTER TYPE "RoleName_new" RENAME TO "RoleName";
