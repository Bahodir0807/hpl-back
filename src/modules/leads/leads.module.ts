import { Module } from '@nestjs/common';
import { LeadWorkspaceController } from './lead-workspace.controller';
import { LeadVirtualStatusService } from './lead-virtual-status.service';
import { LeadWorkspaceService } from './lead-workspace.service';
import { LeadsController } from './leads.controller';
import { LeadsService } from './leads.service';

@Module({
  controllers: [LeadsController, LeadWorkspaceController],
  providers: [LeadsService, LeadVirtualStatusService, LeadWorkspaceService],
  exports: [LeadsService, LeadVirtualStatusService],
})
export class LeadsModule {}
