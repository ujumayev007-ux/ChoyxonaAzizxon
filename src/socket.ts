import { Server } from 'socket.io';

let ioInstance: Server | null = null;

export const initSocket = (io: Server) => {
    ioInstance = io;
};

export const emitSocketEvent = (event: string, data: any) => {
    if (ioInstance) {
        ioInstance.emit(event, data);
    }
};
