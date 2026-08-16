import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import type { CurrentUser as CurrentUserType } from '../../common/interfaces/current-user.interface';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CompleteTaskDto } from './dto/complete-task.dto';
import { CreateTaskDto } from './dto/create-task.dto';
import { FilterTaskDto } from './dto/filter-task.dto';
import { RescheduleTaskDto } from './dto/reschedule-task.dto';
import { TasksService } from './tasks.service';

@ApiTags('Tasks')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('tasks')
export class TasksController {
  constructor(private readonly tasksService: TasksService) {}

  @Post()
  @RequirePermissions('tasks:create')
  @ApiOperation({ summary: 'Create task' })
  @ApiResponse({ status: 201, description: 'Task created' })
  create(@Body() dto: CreateTaskDto, @CurrentUser() user: CurrentUserType) {
    return this.tasksService.create(dto, user);
  }

  @Get()
  @RequirePermissions('tasks:read')
  @ApiOperation({ summary: 'List tasks with filters and pagination' })
  @ApiResponse({ status: 200, description: 'Task list returned' })
  findAll(
    @Query() filterDto: FilterTaskDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.tasksService.findAll(filterDto, user.id, user.permissions);
  }

  @Get('my-day')
  @RequirePermissions('tasks:read')
  @ApiOperation({ summary: 'Get current user task dashboard for today' })
  @ApiResponse({ status: 200, description: 'My day task dashboard returned' })
  myDay(@CurrentUser() user: CurrentUserType) {
    return this.tasksService.getMyDay(user.id);
  }

  @Get(':id')
  @RequirePermissions('tasks:read')
  @ApiOperation({ summary: 'Get task card with reschedule history' })
  @ApiResponse({ status: 200, description: 'Task card returned' })
  @ApiResponse({ status: 404, description: 'Task not found' })
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.tasksService.findOne(id, user.id, user.permissions);
  }

  @Post(':id/complete')
  @RequirePermissions('tasks:update')
  @ApiOperation({ summary: 'Complete task with result' })
  @ApiResponse({ status: 201, description: 'Task completed' })
  @ApiResponse({ status: 400, description: 'Result is required' })
  @ApiResponse({ status: 404, description: 'Task not found' })
  complete(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CompleteTaskDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.tasksService.complete(id, dto, user);
  }

  @Patch(':id/complete')
  @RequirePermissions('tasks:update')
  @ApiOperation({ summary: 'Complete task with result' })
  @ApiResponse({ status: 200, description: 'Task completed' })
  @ApiResponse({ status: 400, description: 'Result is required' })
  @ApiResponse({ status: 404, description: 'Task not found' })
  completePatch(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CompleteTaskDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.tasksService.complete(id, dto, user);
  }

  @Post(':id/reschedule')
  @RequirePermissions('tasks:update')
  @ApiOperation({ summary: 'Reschedule task with reason' })
  @ApiResponse({ status: 201, description: 'Task rescheduled' })
  @ApiResponse({ status: 400, description: 'Reason is required' })
  @ApiResponse({ status: 404, description: 'Task not found' })
  reschedule(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RescheduleTaskDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.tasksService.reschedule(id, dto, user);
  }

  @Delete(':id')
  @RequirePermissions('tasks:delete')
  @ApiOperation({ summary: 'Cancel task' })
  @ApiResponse({ status: 200, description: 'Task cancelled' })
  @ApiResponse({ status: 404, description: 'Task not found' })
  cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.tasksService.cancel(id, user);
  }
}
