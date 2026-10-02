export function generateTableQrLink(botUsername: string, tableId: number): string {
    return `https://t.me/${botUsername}?start=table_${tableId}`;
}
