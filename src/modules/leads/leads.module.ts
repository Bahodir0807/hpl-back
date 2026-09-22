import { Module } from '@nestjs/common';
import { LeadWorkspaceController } from './lead-workspace.controller';
import { LeadVirtualStatusService } from './lead-virtual-status.service';
import { LeadWorkspaceService } from './lead-workspace.service';
import { LeadCommercialQualificationService } from './lead-commercial-qualification.service';
import { LeadManagerCommercialNoteService } from './lead-manager-commercial-note.service';
import { LeadQualificationService } from './lead-qualification.service';
import { LeadEngineeringController } from './engineering/lead-engineering.controller';
import { LeadEngineeringService } from './engineering/lead-engineering.service';
import { FacadeCalculationController } from './engineering/facade/facade-calculation.controller';
import { FacadeCalculationService } from './engineering/facade/facade-calculation.service';
import { FacadeCommercialController } from './engineering/facade/facade-commercial.controller';
import { FacadeCommercialService } from './engineering/facade/facade-commercial.service';
import { FacadeMaterialOfferController } from './engineering/facade/facade-material-offer.controller';
import { FacadeMaterialOfferService } from './engineering/facade/facade-material-offer.service';
import { InstallationCalculationController } from './engineering/installation/installation-calculation.controller';
import { InstallationCalculationService } from './engineering/installation/installation-calculation.service';
import { InstallationCatalogController } from './engineering/installation/installation-catalog.controller';
import { InstallationCatalogService } from './engineering/installation/installation-catalog.service';
import { InstallationCommercialController } from './engineering/installation/installation-commercial.controller';
import { InstallationCommercialService } from './engineering/installation/installation-commercial.service';
import { LeadsController } from './leads.controller';
import { LeadsService } from './leads.service';
import { CalculationsModule } from '../../calculations/calculations.module';

@Module({
  imports: [CalculationsModule],
  controllers: [
    LeadEngineeringController,
    FacadeCalculationController,
    FacadeCommercialController,
    FacadeMaterialOfferController,
    InstallationCalculationController,
    InstallationCatalogController,
    InstallationCommercialController,
    LeadsController,
    LeadWorkspaceController,
  ],
  providers: [
    LeadsService,
    LeadQualificationService,
    LeadCommercialQualificationService,
    LeadManagerCommercialNoteService,
    LeadVirtualStatusService,
    LeadWorkspaceService,
    LeadEngineeringService,
    FacadeCalculationService,
    FacadeCommercialService,
    FacadeMaterialOfferService,
    InstallationCalculationService,
    InstallationCatalogService,
    InstallationCommercialService,
  ],
  exports: [
    LeadsService,
    LeadQualificationService,
    LeadCommercialQualificationService,
    LeadManagerCommercialNoteService,
    LeadVirtualStatusService,
    LeadEngineeringService,
    FacadeCalculationService,
    FacadeCommercialService,
    FacadeMaterialOfferService,
    InstallationCalculationService,
    InstallationCatalogService,
    InstallationCommercialService,
  ],
})
export class LeadsModule {}
