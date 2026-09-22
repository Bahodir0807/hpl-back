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
  ],
})
export class LeadsModule {}
