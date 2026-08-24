import {
  LossReason,
  Prisma,
  RoleName,
  TaskPriority,
  TaskType,
} from '@prisma/client';

const RECOVERABLE_REASONS = new Set<LossReason>([
  LossReason.PRICE,
  LossReason.NO_STOCK,
  LossReason.LEAD_TIME,
]);

const RECOVERY_SLA_MS = 24 * 60 * 60 * 1000;

export async function createHeadRecoveryTasks(
  tx: Prisma.TransactionClient,
  input: {
    entityType: 'Lead' | 'Deal';
    entityId: string;
    title: string;
    reason: LossReason;
    actorId: string;
  },
): Promise<number> {
  if (!RECOVERABLE_REASONS.has(input.reason)) {
    return 0;
  }

  const relatedType = `${input.entityType}Recovery`;
  const heads = await tx.user.findMany({
    where: {
      isActive: true,
      roles: { some: { role: { name: RoleName.HEAD } } },
    },
    select: { id: true },
  });
  const existing = await tx.task.findMany({
    where: {
      relatedType,
      relatedId: input.entityId,
      assigneeId: { in: heads.map((head) => head.id) },
    },
    select: { assigneeId: true },
  });
  const existingAssignees = new Set(existing.map((task) => task.assigneeId));
  const dueDate = new Date(Date.now() + RECOVERY_SLA_MS);
  let created = 0;

  for (const head of heads) {
    if (existingAssignees.has(head.id)) {
      continue;
    }

    await tx.task.create({
      data: {
        title: `Recovery review: ${input.title}`,
        description: `${input.entityType} lost because of ${input.reason}`,
        type: TaskType.OTHER,
        priority: TaskPriority.HIGH,
        dueDate,
        originalDueDate: dueDate,
        assigneeId: head.id,
        createdById: input.actorId,
        relatedType,
        relatedId: input.entityId,
      },
    });
    created += 1;
  }

  if (created > 0) {
    await tx.auditLog.create({
      data: {
        userId: input.actorId,
        action: 'RECOVERY_TASKS_CREATED',
        entityType: input.entityType,
        entityId: input.entityId,
        newValue: {
          reason: input.reason,
          recipientRole: RoleName.HEAD,
          created,
        },
      },
    });
  }

  return created;
}
