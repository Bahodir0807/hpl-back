import {
  DealStage,
  FulfillmentSource,
  InstallationStatus,
  OrderStatus,
  SupplierOrderStatus,
} from '@prisma/client';

export type InstallationActorSummary = {
  id: string;
  firstName: string;
  lastName: string;
};

export type InstallationJobClientDto = {
  id: string;
  name: string;
  phone: string | null;
};

export type InstallationJobProjectObjectDto = {
  id: string;
  name: string;
  address: string | null;
};

export type InstallationJobDealDto = {
  id: string;
  title: string;
  stage: DealStage;
  completedAt: Date | null;
  installationRequiredSnapshot: boolean | null;
  client: InstallationJobClientDto;
  projectObject: InstallationJobProjectObjectDto | null;
};

export type InstallationJobDeliveryDto = {
  fulfillmentSource: FulfillmentSource | null;
  materialsDelivered: boolean;
  orderStatus: OrderStatus | null;
  supplierOrderStatuses: SupplierOrderStatus[];
};

export type InstallationJobDto = {
  id: string;
  dealId: string;
  status: InstallationStatus;
  expectedInstallationAt: Date | null;
  expectedCompletionAt: Date | null;
  assessmentComment: string | null;
  workComment: string | null;
  assessedAt: Date | null;
  assessedBy: InstallationActorSummary | null;
  startedAt: Date | null;
  startedBy: InstallationActorSummary | null;
  installerConfirmedAt: Date | null;
  installerConfirmedBy: InstallationActorSummary | null;
  supervisorConfirmedAt: Date | null;
  supervisorConfirmedBy: InstallationActorSummary | null;
  completedAt: Date | null;
  installationRequiredSnapshot: boolean | null;
  dealCompletedAt: Date | null;
  deal: InstallationJobDealDto;
  delivery: InstallationJobDeliveryDto;
};

export type InstallationJobListDto = {
  items: InstallationJobDto[];
  total: number;
  page: number;
  limit: number;
};
