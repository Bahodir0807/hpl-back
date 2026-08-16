import { Module } from '@nestjs/common';
import { LeadWorkspaceController } from './lead-workspace.controller';
import { LeadVirtualStatusService } from './lead-virtual-status.service';
import { LeadWorkspaceService } from './lead-workspace.service';
import { LeadCommercialQualificationService } from './lead-commercial-qualification.service';
import { LeadQualificationService } from './lead-qualification.service';
import { LeadsController } from './leads.controller';
import { LeadsService } from './leads.service';

@Module({
  controllers: [LeadsController, LeadWorkspaceController],
  providers: [
    LeadsService,
    LeadQualificationService,
    LeadCommercialQualificationService,
    LeadVirtualStatusService,
    LeadWorkspaceService,
  ],
  exports: [
    LeadsService,
    LeadQualificationService,
    LeadCommercialQualificationService,
    LeadVirtualStatusService,
  ],
})
export class LeadsModule {}
