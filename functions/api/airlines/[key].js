/* GET /api/airlines/{key} — route binding only. `params.key` is the path segment.
 * Logic: functions/_lib/handlers.mjs. */
export { airlineOne as onRequest } from '../../_lib/handlers.mjs';
