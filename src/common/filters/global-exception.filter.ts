import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { Request, Response } from 'express';

type ErrorResponseBody = {
  statusCode: number;
  timestamp: string;
  path: string;
  method: string;
  message: string | string[];
  errorCode?: string;
  requestId?: string;
  stack?: string;
};

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  constructor(
    private readonly configService: ConfigService<{ NODE_ENV: string }, true>,
  ) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      if (exception.code === 'P2002') {
        response.status(HttpStatus.CONFLICT).json({
          statusCode: HttpStatus.CONFLICT,
          message: 'Unique constraint violated',
          error: 'Conflict',
        });
        return;
      }

      if (exception.code === 'P2003') {
        response.status(HttpStatus.CONFLICT).json({
          statusCode: HttpStatus.CONFLICT,
          message:
            'This record is referenced by other data and cannot be deleted',
          error: 'Conflict',
        });
        return;
      }

      if (exception.code === 'P2025') {
        response.status(HttpStatus.NOT_FOUND).json({
          statusCode: HttpStatus.NOT_FOUND,
          message: 'Record not found',
          error: 'Not Found',
        });
        return;
      }
    }

    const isProduction =
      this.configService.get<string>('NODE_ENV') === 'production';

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    const errorResponse: ErrorResponseBody = {
      statusCode: status,
      timestamp: new Date().toISOString(),
      path: request.url,
      method: request.method,
      message: this.resolveMessage(exception),
      requestId: request.requestId,
      ...this.resolveErrorCode(exception),
    };

    if (!isProduction && exception instanceof Error) {
      errorResponse.stack = exception.stack;
    }

    const logLine = `[${request.requestId ?? 'no-request-id'}] ${request.method} ${request.url} ${status} — ${JSON.stringify(errorResponse.message)}`;

    // 4xx — ожидаемые клиентские ошибки (warn), 5xx — сбои сервера (error + stack)
    if (status >= 500) {
      this.logger.error(
        logLine,
        exception instanceof Error ? exception.stack : undefined,
      );
    } else {
      this.logger.warn(logLine);
    }

    response.status(status).json(errorResponse);
  }

  private resolveMessage(exception: unknown): string | string[] {
    if (!(exception instanceof HttpException)) {
      return 'Internal server error';
    }

    const response = exception.getResponse();

    if (typeof response === 'string') {
      return response;
    }

    if (
      typeof response === 'object' &&
      response !== null &&
      'message' in response
    ) {
      const message = response.message;

      if (typeof message === 'string') {
        return message;
      }

      if (Array.isArray(message)) {
        return message.filter(
          (entry): entry is string => typeof entry === 'string',
        );
      }
    }

    return exception.message;
  }

  private resolveErrorCode(
    exception: unknown,
  ): Pick<ErrorResponseBody, 'errorCode'> {
    if (!(exception instanceof HttpException)) {
      return {};
    }

    const response = exception.getResponse();

    if (
      typeof response === 'object' &&
      response !== null &&
      'errorCode' in response &&
      typeof response.errorCode === 'string'
    ) {
      return { errorCode: response.errorCode };
    }

    return {};
  }
}
