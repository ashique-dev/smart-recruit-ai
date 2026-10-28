import { WebSocketGateway } from '@nestjs/websockets';
// Transport handshake only. No rooms, commands or interview functionality.
@WebSocketGateway({ path: '/socket.io/' })
export class InfrastructureGateway {}
