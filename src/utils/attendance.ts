export function scheduleFor(now: Date, start: string, end: string, timezone: string) {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(now);
    const n = (key: string) => Number(parts.find(p => p.type === key)!.value);
    const local = Date.UTC(n('year'), n('month') - 1, n('day'), n('hour'), n('minute'), n('second'));
    const offset = local - Math.floor(now.getTime() / 1000) * 1000;
    const minutes = (value: string) => Number(value.slice(0, 2)) * 60 + Number(value.slice(3));
    let day = Date.UTC(n('year'), n('month') - 1, n('day'));
    if (minutes(end) <= minutes(start) && n('hour') * 60 + n('minute') < minutes(end)) day -= 86400000;
    return { start: new Date(day + minutes(start) * 60000 - offset), end: new Date(day + minutes(end) * 60000 - offset + (minutes(end) <= minutes(start) ? 86400000 : 0)) };
}
export function attendanceMetrics(checkIn: Date, checkOut: Date | null, scheduledStart: Date | null, scheduledEnd: Date | null, grace: number) {
    return { lateMinutes: scheduledStart ? Math.max(0, Math.floor((checkIn.getTime() - scheduledStart.getTime()) / 60000) - grace) : 0,
        earlyMinutes: checkOut && scheduledEnd ? Math.max(0, Math.floor((scheduledEnd.getTime() - checkOut.getTime()) / 60000)) : 0,
        totalHours: checkOut ? Math.round((checkOut.getTime() - checkIn.getTime()) / 36000) / 100 : null };
}
