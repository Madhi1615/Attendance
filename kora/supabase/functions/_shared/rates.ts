export interface RateCard {
  hourly_rate: number;
  night_premium_percent: number;
  sunday_premium_percent: number;
  holiday_premium_percent: number;
}

export interface HourSegment {
  start: Date;
  end: Date;
}

const NIGHT_START_HOUR = 20; // 20:00
const NIGHT_END_HOUR = 6; // 06:00

// German public holidays are state-specific; a company's rate card is per federal state,
// so this list intentionally stays generic (nationwide fixed-date holidays only). Firms
// operating in a single Bundesland can extend this via the rate_cards table's premiums
// without code changes for the common cases below.
const FIXED_NATIONWIDE_HOLIDAYS = new Set(["01-01", "05-01", "10-03", "12-25", "12-26"]);

function isHoliday(date: Date): boolean {
  const mmdd = `${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
  return FIXED_NATIONWIDE_HOLIDAYS.has(mmdd);
}

function isSunday(date: Date): boolean {
  return date.getUTCDay() === 0;
}

function isNightHour(hour: number): boolean {
  return hour >= NIGHT_START_HOUR || hour < NIGHT_END_HOUR;
}

// Walks a shift hour by hour and applies the highest single applicable premium per hour
// (holiday > Sunday > night), matching how the brief describes "premiums per hour worked".
export function calculateShiftCost(shift: HourSegment, rate: RateCard) {
  let baseHours = 0;
  let nightHours = 0;
  let sundayHours = 0;
  let holidayHours = 0;

  const cursor = new Date(shift.start);
  while (cursor < shift.end) {
    const hourEnd = new Date(Math.min(cursor.getTime() + 3600_000, shift.end.getTime()));
    const fraction = (hourEnd.getTime() - cursor.getTime()) / 3600_000;

    if (isHoliday(cursor)) holidayHours += fraction;
    else if (isSunday(cursor)) sundayHours += fraction;
    else if (isNightHour(cursor.getUTCHours())) nightHours += fraction;
    else baseHours += fraction;

    cursor.setTime(hourEnd.getTime());
  }

  const totalHours = baseHours + nightHours + sundayHours + holidayHours;
  const base = totalHours * rate.hourly_rate;
  const nightPremium = nightHours * rate.hourly_rate * (rate.night_premium_percent / 100);
  const sundayPremium = sundayHours * rate.hourly_rate * (rate.sunday_premium_percent / 100);
  const holidayPremium = holidayHours * rate.hourly_rate * (rate.holiday_premium_percent / 100);

  return {
    totalHours,
    baseHours,
    nightHours,
    sundayHours,
    holidayHours,
    base,
    nightPremium,
    sundayPremium,
    holidayPremium,
    premiumsTotal: nightPremium + sundayPremium + holidayPremium,
    total: base + nightPremium + sundayPremium + holidayPremium,
  };
}
