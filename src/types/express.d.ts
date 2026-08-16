declare global {
  namespace Express {
    interface Request {
      requestId?: string;
      serviceAccount?: {
        id: string;
        name: string;
        permissions: unknown;
        isActive: boolean;
        tokenHash: string;
        lastUsedAt: Date | null;
        createdAt: Date;
        updatedAt: Date;
      };
    }
  }
}

export {};
