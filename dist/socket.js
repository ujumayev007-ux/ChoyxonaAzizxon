"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.emitSocketEvent = exports.initSocket = void 0;
let ioInstance = null;
const initSocket = (io) => {
    ioInstance = io;
};
exports.initSocket = initSocket;
const emitSocketEvent = (event, data) => {
    if (ioInstance) {
        ioInstance.emit(event, data);
    }
};
exports.emitSocketEvent = emitSocketEvent;
