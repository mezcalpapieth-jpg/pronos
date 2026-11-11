// Signed API-key claims use the same payout accounting as the portfolio.
import { createApiRedemptionHandler } from '../_lib/points-api-redemption-http.js';
export const config = { api: { bodyParser: false } };
export default createApiRedemptionHandler('redeem');
