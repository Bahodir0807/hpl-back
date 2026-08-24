import { Prisma } from '@prisma/client';
import { areMaterialsDelivered } from './deal-completion.rules';
import type {
  InstallationActorSummary,
  InstallationJobDto,
} from './dto/installation-job.dto';

const actorSelect = Prisma.validator<Prisma.UserSelect>()({
  id: true,
  firstName: true,
  lastName: true,
});

export const installationJobInclude =
  Prisma.validator<Prisma.DealInstallationInclude>()({
    assessedBy: { select: actorSelect },
    startedBy: { select: actorSelect },
    installerConfirmedBy: { select: actorSelect },
    supervisorConfirmedBy: { select: actorSelect },
    deal: {
      select: {
        id: true,
        title: true,
        stage: true,
        completedAt: true,
        installationRequiredSnapshot: true,
        fulfillmentSource: true,
        client: {
          select: { id: true, name: true, phone: true },
        },
        projectObject: {
          select: { id: true, name: true, address: true },
        },
        order: {
          select: { id: true, status: true, deletedAt: true },
        },
        supplierOrders: {
          select: { status: true },
        },
      },
    },
  });

export type InstallationJobRecord = Prisma.DealInstallationGetPayload<{
  include: typeof installationJobInclude;
}>;

function toActor(
  user: { id: string; firstName: string; lastName: string } | null,
): InstallationActorSummary | null {
  if (!user) {
    return null;
  }

  return {
    id: user.id,
    firstName: user.firstName,
    lastName: user.lastName,
  };
}

export function mapInstallationJob(
  row: InstallationJobRecord,
): InstallationJobDto {
  const order =
    row.deal.order && row.deal.order.deletedAt == null ? row.deal.order : null;
  const supplierOrderStatuses = row.deal.supplierOrders.map(
    (orderRow) => orderRow.status,
  );

  return {
    id: row.id,
    dealId: row.dealId,
    status: row.status,
    expectedInstallationAt: row.expectedInstallationAt,
    expectedCompletionAt: row.expectedCompletionAt,
    assessmentComment: row.assessmentComment,
    workComment: row.workComment,
    assessedAt: row.assessedAt,
    assessedBy: toActor(row.assessedBy),
    startedAt: row.startedAt,
    startedBy: toActor(row.startedBy),
    installerConfirmedAt: row.installerConfirmedAt,
    installerConfirmedBy: toActor(row.installerConfirmedBy),
    supervisorConfirmedAt: row.supervisorConfirmedAt,
    supervisorConfirmedBy: toActor(row.supervisorConfirmedBy),
    completedAt: row.completedAt,
    installationRequiredSnapshot: row.deal.installationRequiredSnapshot,
    dealCompletedAt: row.deal.completedAt,
    deal: {
      id: row.deal.id,
      title: row.deal.title,
      stage: row.deal.stage,
      completedAt: row.deal.completedAt,
      installationRequiredSnapshot: row.deal.installationRequiredSnapshot,
      client: {
        id: row.deal.client.id,
        name: row.deal.client.name,
        phone: row.deal.client.phone,
      },
      projectObject: row.deal.projectObject
        ? {
            id: row.deal.projectObject.id,
            name: row.deal.projectObject.name,
            address: row.deal.projectObject.address,
          }
        : null,
    },
    delivery: {
      fulfillmentSource: row.deal.fulfillmentSource,
      materialsDelivered: areMaterialsDelivered({
        fulfillmentSource: row.deal.fulfillmentSource,
        orderStatus: order?.status,
        supplierOrderStatuses,
      }),
      orderStatus: order?.status ?? null,
      supplierOrderStatuses,
    },
  };
}
