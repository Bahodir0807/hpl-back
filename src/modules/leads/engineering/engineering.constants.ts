export const ENGINEERING_PERMISSIONS = {
  READ: 'engineering:read',
  ASSIGN: 'engineering:assign',
  RETURN: 'engineering:return',
  COMPLETE: 'engineering:complete',
  UPDATE_TECHNICAL: 'engineering:update_technical',
} as const;

export const ENGINEERING_NOTIFICATION_TYPE = {
  ASSIGNED: 'engineering_assigned',
  RETURNED: 'engineering_returned',
  COMPLETED: 'engineering_completed',
} as const;

export const ENGINEERING_ASSIGNED_TITLE = 'Назначен инженерный лид';
export const ENGINEERING_RETURNED_TITLE = 'Инженер вернул лид на доработку';
export const ENGINEERING_COMPLETED_TITLE =
  'Инженер завершил первичную квалификацию';

export const ENGINEERING_TASK_PREFIX = 'Engineering qualification:';
export const ENGINEERING_TASK_SLA_MS = 24 * 60 * 60 * 1000;
