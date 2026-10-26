/**
 * Heat bands, as the rules split them: the mission's Heat budget falls into thirds, CLEAN, HOT and CRITICAL, and
 * when it doesn't divide by three CRITICAL gets the smallest range. A budget of 6 is two marks of each; 7 is 3, 2, 2;
 * 8 is 3, 3, 2. Spending the whole budget is LOCKDOWN. Heat is stored as marks spent (current) out of the budget
 * (max). Pure: tested without Foundry.
 */

/** How many marks each band holds. */
export function heatBandSizes(max) {
  const budget = Math.max(0, Math.trunc(Number(max) || 0));
  const third = Math.floor(budget / 3);
  const extra = budget % 3;
  return { clean: third + (extra > 0 ? 1 : 0), hot: third + (extra > 1 ? 1 : 0), critical: third };
}

/** The marks spent at which HOT, CRITICAL and LOCKDOWN begin. */
export function heatBandStarts(max) {
  const sizes = heatBandSizes(max);
  return { hot: sizes.clean, critical: sizes.clean + sizes.hot, lockdown: sizes.clean + sizes.hot + sizes.critical };
}

/** The band for marks spent out of the budget: idle (no mission), clean, hot, critical or lockdown. */
export function heatBand(current, max) {
  const budget = Math.max(0, Math.trunc(Number(max) || 0));
  if (!budget) return "idle";
  const spent = Number(current) || 0;
  const starts = heatBandStarts(budget);
  if (spent >= starts.lockdown) return "lockdown";
  if (spent >= starts.critical) return "critical";
  if (spent >= starts.hot) return "hot";
  return "clean";
}
