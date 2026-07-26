/* GET /api/score/{flightNumber} — route binding only, kept for the URL shape.
 * RETIRED 2026-07-26 (spec D7): answers 410 Gone. Logic: functions/_lib/handlers.mjs. */
export { scoreFlightGone as onRequest } from '../../_lib/handlers.mjs';
