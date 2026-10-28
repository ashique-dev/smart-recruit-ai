import { ArgumentsHost, Catch, ExceptionFilter, HttpException } from '@nestjs/common';
import type { Response } from 'express';
import { randomUUID } from 'node:crypto';
@Catch()
export class SafeErrors implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost) {
    const response=host.switchToHttp().getResponse<Response>();
    const status=error instanceof HttpException?error.getStatus():500;
    const body=error instanceof HttpException?error.getResponse():null;
    const message=typeof body==='string'?body:body && typeof body==='object' && 'message' in body?body.message:'INTERNAL_ERROR';
    const requestId=response.getHeader('X-Request-ID') || randomUUID();
    // Unknown exceptions may contain Prisma arguments, email addresses or credentials.
    // Never forward or log their message/stack/body.
    response.status(status).json({statusCode:status,message,requestId});
  }
}
