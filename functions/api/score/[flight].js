/* GET /api/score/{flightNumber} — route binding only. `params.flight` is the path
 * segment. Logic: functions/_lib/handlers.mjs. */
export { scoreFlight as onRequest } from '../../_lib/handlers.mjs';
