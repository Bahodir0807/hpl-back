"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.calculateComputedStatus = calculateComputedStatus;
const client_1 = require("@prisma/client");
function calculateComputedStatus(dueDate, status, warningHours = 2, criticalHours = 24) {
    if (status === client_1.TaskStatus.COMPLETED || status === client_1.TaskStatus.CANCELLED) {
        return client_1.TaskComputedStatus.ON_TIME;
    }
    const now = new Date();
    const dueTime = dueDate.getTime();
    const nowTime = now.getTime();
    const warningBoundary = nowTime + warningHours * 60 * 60 * 1000;
    const criticalBoundary = nowTime - criticalHours * 60 * 60 * 1000;
    if (dueTime < criticalBoundary) {
        return client_1.TaskComputedStatus.CRITICAL_OVERDUE;
    }
    if (dueTime < nowTime) {
        return client_1.TaskComputedStatus.OVERDUE;
    }
    if (dueTime <= warningBoundary) {
        return client_1.TaskComputedStatus.WARNING;
    }
    if (isSameLocalDate(dueDate, now)) {
        return client_1.TaskComputedStatus.TODAY;
    }
    return client_1.TaskComputedStatus.ON_TIME;
}
function isSameLocalDate(left, right) {
    return (left.getFullYear() === right.getFullYear() &&
        left.getMonth() === right.getMonth() &&
        left.getDate() === right.getDate());
}
//# sourceMappingURL=task-status-calculator.js.map