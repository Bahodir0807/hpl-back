import { Module } from '@nestjs/common';
import { LeadWorkspaceController } from './lead-workspace.controller';
import { LeadVirtualStatusService } from './lead-virtual-status.service';
import { LeadWorkspaceService } from './lead-workspace.service';
import { LeadCommercialQualificationService } from './lead-commercial-qualification.service';
import { LeadManagerCommercialNoteService } from './lead-manager-commercial-note.service';
import { LeadQualificationService } from './lead-qualification.service';
import { LeadEngineeringController } from './engineering/lead-engineering.controller';
import { LeadEngineeringService } from './engineering/lead-engineering.service';
import { LeadsController } from './leads.controller';
import { LeadsService } from './leads.service';
import { CalculationsModule } from '../../calculations/calculations.module';

@Module({
  imports: [CalculationsModule],
  controllers: [
    LeadEngineeringController,
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
  ],
  exports: [
    LeadsService,
    LeadQualificationService,
    LeadCommercialQualificationService,
    LeadManagerCommercialNoteService,
    LeadVirtualStatusService,
    LeadEngineeringService,
  ],
})
export class LeadsModule {}
