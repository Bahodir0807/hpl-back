"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizePhone = normalizePhone;
function normalizePhone(phone) {
    const digits = phone.replace(/\D/g, '');
    if (digits.length === 11 && digits.startsWith('8')) {
        return `7${digits.slice(1)}`;
    }
    return digits;
}
//# sourceMappingURL=phone-normalizer.js.map