import type { CalendarClock } from './operational-types.ts';
/** Runtime supplies the installed date-fns-tz implementation. Preserve the V2
 * browser's date-only/midnight convention in the explicitly supplied timezone. */
export function calendarClock(fromZonedTime:(date:string,zone:string)=>Date,formatInTimeZone:(date:Date,zone:string,format:string)=>string):CalendarClock {
  return {
    today:(zone,now)=>formatInTimeZone(new Date(now),zone,'yyyy-MM-dd'),
    timestamp:(date,time,zone)=>{
      if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!/^\d{2}:\d{2}(:\d{2})?$/.test(time))return NaN;
      const local=`${date}T${time}`,value=fromZonedTime(local,zone);
      if(!Number.isFinite(value.getTime())||formatInTimeZone(value,zone,"yyyy-MM-dd'T'HH:mm")!==local.slice(0,16))return NaN;
      return value.getTime();
    },
  };
}
