/**
 * Production-safe RBAC sync.
 *
 * Reconciles `roles`, `permissions`, and `role_default_permissions` against
 * the source of truth in `prisma/rbac-source.ts`. Touches NO business data:
 * customers, contracts, sales orders, trucks, payments, users, sessions,
 * audit log are all left alone.
 *
 * Safe to run on production. Approved replacement for `npm run db:seed` when
 * the only thing changed is the permission catalog.
 *
 * USAGE
 *   npm run rbac:sync:dry          # preview changes, no writes
 *   npm run rbac:sync               # apply additions + updates, warn on stale
 *   npm run rbac:sync -- --delete-stale   # also delete rows that no longer
 *                                          # exist in rbac-source.ts
 *
 * STALE BEHAVIOR
 *   By default, rows that exist in DB but not in the source are kept and
 *   reported as warnings. Pass `--delete-stale` to remove them. Deletion is
 *   refused if a stale permission still has UserPermissionOverride or
 *   RoleDefaultPermission rows referencing it (no implicit cascade) — in
 *   that case the script prints the offending references and exits 1, so
 *   the operator can clean them up explicitly.
 *
 * NEVER DELETED
 *   Roles are never deleted by this script, even with `--delete-stale`,
 *   because the User.roleCode FK is strict and a wrong list in
 *   rbac-source.ts could lock real users out. Roles missing from the source
 *   are reported only.
 *
 * AUDIT
 *   A successful production run is a mutating action — append an entry to
 *   /opt/steel-erp/CHANGES.md per .cursor/rules/production-safety.mdc §11.
 */

import { Prisma, PrismaClient } from "@prisma/client";
import {
  RBAC_PERMISSIONS,
  RBAC_ROLES,
  RBAC_ROLE_PERMISSIONS,
} from "../prisma/rbac-source";

interface ParsedArgs {
  dryRun: boolean;
  deleteStale: boolean;
}

function parseArgs(argv: ReadonlyArray<string>): ParsedArgs {
  const out: ParsedArgs = { dryRun: false, deleteStale: false };
  for (const a of argv) {
    if (a === "--dry-run") out.dryRun = true;
    else if (a === "--delete-stale") out.deleteStale = true;
    else if (a === "--help" || a === "-h") {
      process.stdout.write(
        "Usage: tsx scripts/sync-rbac.ts [--dry-run] [--delete-stale]\n",
      );
      process.exit(0);
    } else {
      process.stderr.write(`Unknown argument: ${a}\n`);
      process.exit(2);
    }
  }
  return out;
}

/** Mask password and trim path/query so we can safely log which DB we're hitting. */
function describeDatabaseUrl(): string {
  const raw = process.env.DATABASE_URL ?? "";
  if (!raw) return "(DATABASE_URL not set)";
  try {
    const u = new URL(raw);
    const host = u.hostname || "?";
    const port = u.port || "5432";
    const db = u.pathname.replace(/^\//, "") || "?";
    const user = u.username || "?";
    return `${user}@${host}:${port}/${db}`;
  } catch {
    return "(unparseable)";
  }
}

interface ChangeSet {
  rolesToAdd: string[];
  rolesToUpdate: string[];
  rolesMissingFromSource: string[];
  permissionsToAdd: string[];
  permissionsToUpdate: { code: string; reason: string }[];
  permissionsStale: string[];
  rdpToAdd: { roleCode: string; permissionCode: string }[];
  rdpStale: { roleCode: string; permissionCode: string }[];
}

function emptyChangeSet(): ChangeSet {
  return {
    rolesToAdd: [],
    rolesToUpdate: [],
    rolesMissingFromSource: [],
    permissionsToAdd: [],
    permissionsToUpdate: [],
    permissionsStale: [],
    rdpToAdd: [],
    rdpStale: [],
  };
}

async function planChanges(prisma: PrismaClient): Promise<ChangeSet> {
  const cs = emptyChangeSet();

  // Roles --------------------------------------------------------
  const existingRoles = await prisma.role.findMany({
    select: { code: true, displayName: true },
  });
  const existingRoleByCode = new Map(existingRoles.map((r) => [r.code, r]));
  const sourceRoleCodes = new Set(RBAC_ROLES.map((r) => r.code));

  for (const r of RBAC_ROLES) {
    const existing = existingRoleByCode.get(r.code);
    if (!existing) {
      cs.rolesToAdd.push(r.code);
    } else if (existing.displayName !== r.displayName) {
      cs.rolesToUpdate.push(r.code);
    }
  }
  for (const r of existingRoles) {
    if (!sourceRoleCodes.has(r.code)) cs.rolesMissingFromSource.push(r.code);
  }

  // Permissions --------------------------------------------------
  const existingPerms = await prisma.permission.findMany({
    select: { code: true, displayName: true, module: true },
  });
  const existingPermByCode = new Map(existingPerms.map((p) => [p.code, p]));
  const sourcePermCodes = new Set(RBAC_PERMISSIONS.map((p) => p.code));

  for (const p of RBAC_PERMISSIONS) {
    const existing = existingPermByCode.get(p.code);
    if (!existing) {
      cs.permissionsToAdd.push(p.code);
    } else {
      const reasons: string[] = [];
      if (existing.displayName !== p.displayName) reasons.push("displayName");
      if (existing.module !== p.module) reasons.push("module");
      if (reasons.length > 0)
        cs.permissionsToUpdate.push({ code: p.code, reason: reasons.join(",") });
    }
  }
  for (const p of existingPerms) {
    if (!sourcePermCodes.has(p.code)) cs.permissionsStale.push(p.code);
  }

  // Role default permissions ------------------------------------
  // We only reconcile mappings for roles listed in RBAC_ROLE_PERMISSIONS.
  // Mappings belonging to other roles (e.g. `admin`, which is treated as
  // all-permissions at runtime) are left untouched.
  const managedRoleCodes = Object.keys(RBAC_ROLE_PERMISSIONS);
  const existingRdp = managedRoleCodes.length
    ? await prisma.roleDefaultPermission.findMany({
        where: { roleCode: { in: managedRoleCodes } },
        select: { roleCode: true, permissionCode: true },
      })
    : [];
  const existingRdpKey = new Set(
    existingRdp.map((r) => `${r.roleCode}::${r.permissionCode}`),
  );

  for (const [roleCode, permCodes] of Object.entries(RBAC_ROLE_PERMISSIONS)) {
    const desired = new Set(permCodes);
    for (const permCode of permCodes) {
      if (!existingRdpKey.has(`${roleCode}::${permCode}`))
        cs.rdpToAdd.push({ roleCode, permissionCode: permCode });
    }
    for (const r of existingRdp) {
      if (r.roleCode === roleCode && !desired.has(r.permissionCode))
        cs.rdpStale.push({ roleCode, permissionCode: r.permissionCode });
    }
  }

  return cs;
}

function printPlan(cs: ChangeSet, args: ParsedArgs) {
  const log = (s: string) => process.stdout.write(s + "\n");
  log("");
  log("──────── RBAC sync plan ────────");
  log(`Target DB: ${describeDatabaseUrl()}`);
  log(`Mode:      ${args.dryRun ? "DRY RUN (no writes)" : "APPLY"}`);
  log(`Stale:     ${args.deleteStale ? "DELETE" : "warn only"}`);
  log("");

  log("Roles");
  log(`  + add:     ${cs.rolesToAdd.length ? cs.rolesToAdd.join(", ") : "—"}`);
  log(`  ~ update:  ${cs.rolesToUpdate.length ? cs.rolesToUpdate.join(", ") : "—"}`);
  if (cs.rolesMissingFromSource.length) {
    log(
      `  ! missing from source (never auto-deleted): ${cs.rolesMissingFromSource.join(", ")}`,
    );
  } else {
    log("  ! missing from source: —");
  }
  log("");

  log("Permissions");
  log(
    `  + add:     ${cs.permissionsToAdd.length ? cs.permissionsToAdd.join(", ") : "—"}`,
  );
  if (cs.permissionsToUpdate.length) {
    log("  ~ update:");
    for (const p of cs.permissionsToUpdate) log(`      ${p.code}  (${p.reason})`);
  } else {
    log("  ~ update:  —");
  }
  if (cs.permissionsStale.length) {
    log(
      `  ! stale (${args.deleteStale ? "WILL DELETE" : "kept; rerun with --delete-stale to remove"}):`,
    );
    for (const code of cs.permissionsStale) log(`      ${code}`);
  } else {
    log("  ! stale:   —");
  }
  log("");

  log("Role-default permissions");
  if (cs.rdpToAdd.length) {
    log("  + add:");
    for (const m of cs.rdpToAdd) log(`      ${m.roleCode} → ${m.permissionCode}`);
  } else {
    log("  + add:     —");
  }
  if (cs.rdpStale.length) {
    log(
      `  ! stale (${args.deleteStale ? "WILL DELETE" : "kept; rerun with --delete-stale to remove"}):`,
    );
    for (const m of cs.rdpStale) log(`      ${m.roleCode} → ${m.permissionCode}`);
  } else {
    log("  ! stale:   —");
  }
  log("");
  log("──────────────────────────────");
  log("");
}

/**
 * Block deletion of a permission if anything in DB still references it.
 * Without this, we'd silently fall over a Prisma "Foreign key constraint
 * violated" mid-loop and leave a partially-applied state.
 */
async function assertPermissionsSafeToDelete(
  prisma: PrismaClient,
  codes: ReadonlyArray<string>,
): Promise<void> {
  if (!codes.length) return;
  const overrides = await prisma.userPermissionOverride.findMany({
    where: { permissionCode: { in: [...codes] } },
    select: { permissionCode: true, userId: true },
  });
  const defaults = await prisma.roleDefaultPermission.findMany({
    where: { permissionCode: { in: [...codes] } },
    select: { permissionCode: true, roleCode: true },
  });
  if (!overrides.length && !defaults.length) return;

  const lines: string[] = [
    "Cannot delete stale permissions — still referenced:",
  ];
  for (const o of overrides) {
    lines.push(
      `  permission '${o.permissionCode}' has UserPermissionOverride for user_id=${o.userId}`,
    );
  }
  for (const d of defaults) {
    lines.push(
      `  permission '${d.permissionCode}' still mapped to role '${d.roleCode}' (role_default_permissions)`,
    );
  }
  lines.push(
    "Resolve the references (revoke overrides, or remove the role mapping in rbac-source.ts and rerun) before retrying with --delete-stale.",
  );
  throw new Error(lines.join("\n"));
}

async function applyChanges(
  prisma: PrismaClient,
  cs: ChangeSet,
  args: ParsedArgs,
): Promise<void> {
  // Build the role + permission upserts. We do them outside the transaction
  // first so a single failed upsert can't leave RDP creates dangling on a
  // missing FK. Prisma upsert is itself a single statement.
  for (const r of RBAC_ROLES) {
    await prisma.role.upsert({
      where: { code: r.code },
      update: { displayName: r.displayName },
      create: r,
    });
  }
  for (const p of RBAC_PERMISSIONS) {
    await prisma.permission.upsert({
      where: { code: p.code },
      update: { displayName: p.displayName, module: p.module },
      create: p,
    });
  }

  // RDP: do the additions and (if requested) the deletions in one tx so the
  // role mapping is never observable in a half-applied state.
  await prisma.$transaction(async (tx) => {
    for (const m of cs.rdpToAdd) {
      await tx.roleDefaultPermission.upsert({
        where: {
          roleCode_permissionCode: {
            roleCode: m.roleCode,
            permissionCode: m.permissionCode,
          },
        },
        update: {},
        create: { roleCode: m.roleCode, permissionCode: m.permissionCode },
      });
    }
    if (args.deleteStale) {
      for (const m of cs.rdpStale) {
        await tx.roleDefaultPermission.delete({
          where: {
            roleCode_permissionCode: {
              roleCode: m.roleCode,
              permissionCode: m.permissionCode,
            },
          },
        });
      }
    }
  });

  // Stale permission deletion happens last and only after the safety check
  // confirms nothing references them. Anything we already deleted from RDP
  // above no longer counts, so we re-check inside this call.
  if (args.deleteStale && cs.permissionsStale.length) {
    await assertPermissionsSafeToDelete(prisma, cs.permissionsStale);
    await prisma.permission.deleteMany({
      where: { code: { in: cs.permissionsStale } },
    });
  }
}

function noChanges(cs: ChangeSet): boolean {
  return (
    cs.rolesToAdd.length === 0 &&
    cs.rolesToUpdate.length === 0 &&
    cs.permissionsToAdd.length === 0 &&
    cs.permissionsToUpdate.length === 0 &&
    cs.permissionsStale.length === 0 &&
    cs.rdpToAdd.length === 0 &&
    cs.rdpStale.length === 0
  );
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const prisma = new PrismaClient();

  try {
    const cs = await planChanges(prisma);
    printPlan(cs, args);

    if (noChanges(cs)) {
      process.stdout.write("Nothing to do. RBAC is already in sync.\n");
      return;
    }

    if (args.dryRun) {
      process.stdout.write("Dry run — no changes applied.\n");
      return;
    }

    await applyChanges(prisma, cs, args);

    const staleNote =
      !args.deleteStale && (cs.permissionsStale.length || cs.rdpStale.length)
        ? " (stale entries kept — rerun with --delete-stale to remove)"
        : "";
    process.stdout.write(`✓ RBAC sync complete${staleNote}.\n`);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      process.stderr.write(`Prisma error ${err.code}: ${err.message}\n`);
    } else if (err instanceof Error) {
      process.stderr.write(`${err.message}\n`);
    } else {
      process.stderr.write(String(err) + "\n");
    }
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

main();
