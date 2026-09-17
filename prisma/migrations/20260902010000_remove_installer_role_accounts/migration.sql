-- Remove the obsolete INSTALLER system role and every user assigned to it.
-- Installation business records remain. SET NULL references are preserved as
-- historical nulls; business rows with non-nullable user references are a
-- deliberate blocker instead of being deleted through a blanket cascade.

CREATE TEMP TABLE "_installer_role_removal_users" ON COMMIT DROP AS
SELECT DISTINCT u."id"
FROM "User" u
JOIN "UserRole" ur ON ur."userId" = u."id"
JOIN "Role" r ON r."id" = ur."roleId"
WHERE r."name"::text = 'INSTALLER';

DO $$
DECLARE
  installer_users bigint;
  installer_user_roles bigint;
  installer_sessions bigint;
  fk record;
  referenced_rows bigint;
BEGIN
  SELECT count(*) INTO installer_users
  FROM "_installer_role_removal_users";

  SELECT count(*) INTO installer_user_roles
  FROM "UserRole" ur
  WHERE ur."userId" IN (SELECT "id" FROM "_installer_role_removal_users");

  SELECT count(*) INTO installer_sessions
  FROM "Session" s
  WHERE s."userId" IN (SELECT "id" FROM "_installer_role_removal_users");

  RAISE NOTICE 'INSTALLER cleanup audit: users=%, UserRole=%, sessions=%',
    installer_users, installer_user_roles, installer_sessions;

  -- Only auth/disposable rows are explicitly deleted below. Any other
  -- CASCADE or restrictive business FK stops the migration before deletion.
  FOR fk IN
    SELECT
      ns.nspname AS schema_name,
      rel.relname AS table_name,
      att.attname AS column_name,
      con.conname AS constraint_name,
      con.confdeltype AS delete_type
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace ns ON ns.oid = rel.relnamespace
    JOIN pg_attribute att
      ON att.attrelid = rel.oid
     AND att.attnum = con.conkey[1]
    WHERE con.contype = 'f'
      AND con.confrelid = 'public."User"'::regclass
      AND ns.nspname = 'public'
  LOOP
    IF fk.delete_type = 'n' THEN
      CONTINUE;
    END IF;

    IF fk.delete_type = 'c'
       AND fk.table_name IN ('UserRole', 'UserPermission', 'Session',
                             'UserActivityLog', 'Notification') THEN
      CONTINUE;
    END IF;

    EXECUTE format(
      'SELECT count(*) FROM %I.%I WHERE %I IN (SELECT "id" FROM "_installer_role_removal_users")',
      fk.schema_name,
      fk.table_name,
      fk.column_name
    ) INTO referenced_rows;

    IF referenced_rows > 0 THEN
      RAISE EXCEPTION
        'INSTALLER cleanup blocked by business FK %.% (%), rows=%',
        fk.table_name, fk.column_name, fk.constraint_name, referenced_rows;
    END IF;
  END LOOP;
END $$;

-- Preserve all nullable historical/business references before deleting users.
DO $$
DECLARE
  fk record;
BEGIN
  FOR fk IN
    SELECT
      ns.nspname AS schema_name,
      rel.relname AS table_name,
      att.attname AS column_name
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace ns ON ns.oid = rel.relnamespace
    JOIN pg_attribute att
      ON att.attrelid = rel.oid
     AND att.attnum = con.conkey[1]
    WHERE con.contype = 'f'
      AND con.confrelid = 'public."User"'::regclass
      AND con.confdeltype = 'n'
      AND ns.nspname = 'public'
  LOOP
    EXECUTE format(
      'UPDATE %I.%I SET %I = NULL WHERE %I IN (SELECT "id" FROM "_installer_role_removal_users")',
      fk.schema_name,
      fk.table_name,
      fk.column_name,
      fk.column_name
    );
  END LOOP;
END $$;

-- Explicitly remove only auth, role-join, and disposable notification rows.
DELETE FROM "Session"
WHERE "userId" IN (SELECT "id" FROM "_installer_role_removal_users");

DELETE FROM "UserPermission"
WHERE "userId" IN (SELECT "id" FROM "_installer_role_removal_users");

DELETE FROM "UserRole"
WHERE "userId" IN (SELECT "id" FROM "_installer_role_removal_users");

DELETE FROM "UserActivityLog"
WHERE "userId" IN (SELECT "id" FROM "_installer_role_removal_users");

DELETE FROM "Notification"
WHERE "userId" IN (SELECT "id" FROM "_installer_role_removal_users");

DELETE FROM "User"
WHERE "id" IN (SELECT "id" FROM "_installer_role_removal_users");

DELETE FROM "RolePermission"
WHERE "roleId" IN (
  SELECT "id" FROM "Role" WHERE "name"::text = 'INSTALLER'
);

DELETE FROM "Role"
WHERE "name"::text = 'INSTALLER';

-- This permission is obsolete with the removed system role and has no
-- remaining role/user mappings after the deletes above.
DELETE FROM "UserPermission"
WHERE "permissionId" IN (
  SELECT "id" FROM "Permission" WHERE "slug" = 'installation:confirm_work'
);

DELETE FROM "Permission"
WHERE "slug" = 'installation:confirm_work';

CREATE TYPE "RoleName_new" AS ENUM (
  'ADMIN',
  'DIRECTOR',
  'HEAD',
  'MANAGER',
  'ACCOUNTANT',
  'STOREKEEPER'
);

ALTER TABLE "Role"
  ALTER COLUMN "name" TYPE "RoleName_new"
  USING ("name"::text::"RoleName_new");

DROP TYPE "RoleName";

ALTER TYPE "RoleName_new" RENAME TO "RoleName";
