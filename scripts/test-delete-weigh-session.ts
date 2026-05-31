/**
 * Integration smoke test for deleteWeighSession (local DB).
 * Run: npx tsx scripts/test-delete-weigh-session.ts
 */
import { PrismaClient } from "@prisma/client";
import {
  deleteWeighSession,
  enterWeighSession,
  enterTare,
} from "../src/lib/services/truck.service";
import { ServiceError } from "../src/lib/services/errors";

const prisma = new PrismaClient();

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
  console.log(`  ✓ ${msg}`);
}

async function main() {
  console.log("\n── deleteWeighSession integration ──\n");

  const perm = await prisma.permission.findUnique({
    where: { code: "scale.delete_session" },
  });
  assert(perm != null, "permission scale.delete_session exists in DB");

  const rdp = await prisma.roleDefaultPermission.findFirst({
    where: {
      roleCode: "internal_loader",
      permission: { code: "scale.delete_session" },
    },
  });
  assert(rdp != null, "internal_loader has scale.delete_session default");

  const loader = await prisma.user.findFirst({
    where: { roleCode: "internal_loader", isActive: true },
    select: { id: true, username: true },
  });
  assert(loader != null, "active internal_loader user exists");
  const userId = loader!.id;
  console.log(`  (loader: ${loader!.username}, id=${userId})`);

  // Prefer OnScale/FirstWeigh with sessions; otherwise bootstrap one weigh session.
  let truck = await prisma.truckOperation.findFirst({
    where: {
      status: { in: ["FirstWeigh", "OnScale"] },
      sessions: { some: {} },
    },
    include: { sessions: { orderBy: { sessionNumber: "asc" } } },
  });

  if (!truck) {
    const base = await prisma.truckOperation.findFirst({
      where: { status: { in: ["Approved", "FirstWeigh"] } },
      orderBy: { id: "desc" },
      select: { id: true, status: true },
    });
    if (!base) {
      throw new Error("No open truck for test — run db:seed or demo:seed first");
    }
    if (base.status === "Approved") {
      await enterTare(base.id, 15000, userId);
    }
    await enterWeighSession(base.id, { weightTons: 1.5, sizeId: null }, userId);
    truck = await prisma.truckOperation.findUnique({
      where: { id: base.id },
      include: { sessions: { orderBy: { sessionNumber: "asc" } } },
    });
  }
  assert(truck != null && truck.sessions.length > 0, "truck with sessions ready");

  const truckId = truck!.id;
  const target = truck!.sessions[truck!.sessions.length - 1]!;
  const beforeCount = truck!.sessions.length;

  // Stale version → conflict
  let conflict = false;
  try {
    await deleteWeighSession(truckId, target.id, target.version + 999, userId);
  } catch (e) {
    conflict =
      e instanceof ServiceError && e.message.includes("مستخدم آخر");
  }
  assert(conflict, "stale expectedVersion rejected");

  const result = await deleteWeighSession(
    truckId,
    target.id,
    target.version,
    userId,
  );
  assert(
    result.truckStatus === "OnScale" || result.truckStatus === "FirstWeigh",
    `delete returned truckStatus=${result.truckStatus}`,
  );

  const afterSessions = await prisma.weighSession.count({
    where: { truckOperationId: truckId },
  });
  assert(afterSessions === beforeCount - 1, "session row removed from DB");

  const gone = await prisma.weighSession.findUnique({ where: { id: target.id } });
  assert(gone === null, "deleted session id no longer exists");

  const audit = await prisma.auditLog.findFirst({
    where: {
      entityType: "WeighSession",
      entityId: String(target.id),
      action: "delete",
    },
    orderBy: { createdAt: "desc" },
  });
  assert(audit != null, "audit log delete entry written");

  // Block after loading complete
  const frozen = await prisma.truckOperation.findFirst({
    where: { status: "LoadingComplete" },
    include: { sessions: true },
  });
  if (frozen && frozen.sessions.length > 0) {
    let blocked = false;
    try {
      await deleteWeighSession(
        frozen.id,
        frozen.sessions[0]!.id,
        frozen.sessions[0]!.version,
        userId,
      );
    } catch (e) {
      blocked =
        e instanceof ServiceError && e.message.includes("اكتمال التحميل");
    }
    assert(blocked, "delete blocked when status is LoadingComplete");
  } else {
    console.log("  ~ skip LoadingComplete block test (no truck in that state)");
  }

  // Last session → FirstWeigh
  const solo = await prisma.truckOperation.findFirst({
    where: { status: "OnScale" },
    include: { sessions: true },
  });
  if (solo && solo.sessions.length === 1) {
    const only = solo.sessions[0]!;
    const rev = await deleteWeighSession(
      solo.id,
      only.id,
      only.version,
      userId,
    );
    assert(rev.truckStatus === "FirstWeigh", "last session delete reverts to FirstWeigh");
    const st = await prisma.truckOperation.findUnique({
      where: { id: solo.id },
      select: { status: true },
    });
    assert(st?.status === "FirstWeigh", "DB status is FirstWeigh after last delete");
  } else {
    console.log("  ~ skip last-session revert test (no OnScale truck with exactly 1 session)");
  }

  console.log("\n✓ All integration checks passed.\n");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
