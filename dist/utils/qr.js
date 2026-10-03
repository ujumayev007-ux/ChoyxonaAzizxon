"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateTableQrLink = generateTableQrLink;
function generateTableQrLink(botUsername, tableId) {
    return `https://t.me/${botUsername}?start=table_${tableId}`;
}
