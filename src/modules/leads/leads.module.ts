import { Module } from '@nestjs/common';
import { LeadWorkspaceController } from './lead-workspace.controller';
import { LeadVirtualStatusService } from './lead-virtual-status.service';
import { LeadWorkspaceService } from './lead-workspace.service';
import { LeadQualificationService } from './lead-qualification.service';
import { LeadsController } from './leads.controller';
import { LeadsService } from './leads.service';

@Module({
  controllers: [LeadsController, LeadWorkspaceController],
  providers: [
    LeadsService,
    LeadQualificationService,
    LeadVirtualStatusService,
    LeadWorkspaceService,
  ],
  exports: [LeadsService, LeadQualificationService, LeadVirtualStatusService],
})
export class LeadsModule {}
