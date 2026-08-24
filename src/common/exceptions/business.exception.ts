import { HttpException, HttpStatus } from '@nestjs/common';

export type BusinessErrorBody = {
  statusCode: number;
  errorCode: string;
  message: string;
  details?: Record<string, unknown>;
};

export class BusinessException extends HttpException {
  constructor(
    status: HttpStatus,
    errorCode: string,
    message: string,
    details?: Record<string, unknown>,
  ) {
    super(
      {
        statusCode: status,
        errorCode,
        message,
        ...(details ? { details } : {}),
      } satisfies BusinessErrorBody,
      status,
    );
  }
}
