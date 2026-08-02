-- D1 Migration v7: seed the 'admin' Role and grant it to the existing admin
-- User account.
--
-- WHY: Role and UserRole are verified EMPTY (0 rows) in production. Role
-- resolution (src/lib/db/users.ts:resolveUserRole) treats a user with no
-- UserRole row as "collector", never "admin". Without this seed, the
-- existing admin account would be locked out of every /admin/* page and the
-- admin proxy the moment role-based session claims ship (this change's
-- Phase 1/2), because middleware.ts gates /admin on payload.role === "admin".
--
-- IDEMPOTENT: safe to run multiple times — both INSERTs are guarded by
-- NOT EXISTS checks, matching the existing 0006 migration's style.
--
-- NOT EXECUTED BY THIS CHANGE. This file is committed as a reviewable,
-- idempotent artifact only. Running it against the real D1 database is a
-- separate, explicitly user-authorized step outside this change (hard
-- constraint: this change must never write to the production database).
--
-- The target email is the one account that exists in production, verified by
-- live query: exactly one User row, rodrigopianto2005@gmail.com, created
-- 2026-06-14. It is written literally rather than left as a placeholder,
-- because a lockout-prevention migration that silently matches zero rows is
-- worse than no migration at all.

INSERT INTO Role (id, name)
SELECT 'role_admin', 'admin'
WHERE NOT EXISTS (SELECT 1 FROM Role WHERE name = 'admin');

-- roleId is resolved by name rather than hardcoded, so this still links
-- correctly if an 'admin' Role already exists under a different id.
INSERT INTO UserRole (id, userId, roleId)
SELECT 'userrole_admin_seed', User.id, (SELECT id FROM Role WHERE name = 'admin')
FROM User
WHERE User.email = 'rodrigopianto2005@gmail.com'
  AND NOT EXISTS (
    SELECT 1 FROM UserRole
    WHERE UserRole.userId = User.id
      AND UserRole.roleId = (SELECT id FROM Role WHERE name = 'admin')
  );
