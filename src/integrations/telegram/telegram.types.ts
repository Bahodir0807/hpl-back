export type TelegramFormData = {
  name?: string;
  phone?: string;
  message?: string;
  panelTypePreference?: string;
  sourcePage?: string;
};

export function compactUuid(uuid: string): string {
  return uuid.replace(/-/g, '');
}

export function expandUuid(compact: string): string {
  if (compact.length !== 32) {
    throw new Error('Invalid compact UUID');
  }

  return `${compact.slice(0, 8)}-${compact.slice(8, 12)}-${compact.slice(12, 16)}-${compact.slice(16, 20)}-${compact.slice(20)}`;
}

export type ManagerListItem = {
  id: string;
  displayName: string;
};

export type TelegramAssignFallbackJob = {
  leadId: string;
};
