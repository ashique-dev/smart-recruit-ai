import type { IncomingMessage } from 'node:http';
import { IoAdapter } from '@nestjs/platform-socket.io';
import type { ServerOptions } from 'socket.io';
export class OriginSocketAdapter extends IoAdapter {
  constructor(app: ConstructorParameters<typeof IoAdapter>[0], private readonly origin: string) { super(app); }
  override createIOServer(port: number, options?: ServerOptions) {
    return super.createIOServer(port, {
      ...options,
      cors: { origin: this.origin, credentials: true },
      maxHttpBufferSize: 8192,
      allowRequest: (request: IncomingMessage, callback: (error: string | null | undefined, success: boolean) => void) => callback(null, request.headers.origin === this.origin),
    });
  }
}
