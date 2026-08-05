import { TaskComputedStatus, TaskStatus } from '@prisma/client';

export function calculateComputedStatus(
  dueDate: Date,
  status: TaskStatus,
  warningHours = 2,
  criticalHours = 24,
): TaskComputedStatus {
  if (status === TaskStatus.COMPLETED || status === TaskStatus.CANCELLED) {
    return TaskComputedStatus.ON_TIME;
  }

  const now = new Date();
  const dueTime = dueDate.getTime();
  const nowTime = now.getTime();
  const warningBoundary = nowTime + warningHours * 60 * 60 * 1000;
  const criticalBoundary = nowTime - criticalHours * 60 * 60 * 1000;

  if (dueTime < criticalBoundary) {
    return TaskComputedStatus.CRITICAL_OVERDUE;
  }

  if (dueTime < nowTime) {
    return TaskComputedStatus.OVERDUE;
  }

  if (dueTime <= warningBoundary) {
    return TaskComputedStatus.WARNING;
  }

  if (isSameLocalDate(dueDate, now)) {
    return TaskComputedStatus.TODAY;
  }

  return TaskComputedStatus.ON_TIME;
}

function isSameLocalDate(left: Date, right: Date): boolean {
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  );
}
