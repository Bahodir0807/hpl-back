import { HttpException, HttpStatus } from '@nestjs/common';

export type BusinessErrorBody = {
  statusCode: number;
  errorCode: string;
  message: string;
};

export class BusinessException extends HttpException {
  constructor(
    status: HttpStatus,
    errorCode: string,
    message: string,
  ) {
    super(
      {
        statusCode: status,
        errorCode,
        message,
      } satisfies BusinessErrorBody,
      status,
    );
  }
}
