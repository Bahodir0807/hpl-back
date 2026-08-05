import { TasksService } from './tasks.service';
export declare class TasksCronService {
    private readonly tasksService;
    private readonly logger;
    constructor(tasksService: TasksService);
    escalateCriticalOverdues(): Promise<void>;
}
