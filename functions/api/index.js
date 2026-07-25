/* GET /api — Cloudflare Pages Function. A ROUTE BINDING, NOT LOGIC.
 * Everything real is in functions/_lib/handlers.mjs so that plain node can
 * import and test it (build/apitest.js). Keep this file one line long. */
export { apiIndex as onRequest } from '../_lib/handlers.mjs';
