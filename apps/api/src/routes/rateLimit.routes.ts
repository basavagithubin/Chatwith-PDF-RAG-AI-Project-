import { Router } from 'express';
import { rateLimitStatusHandler } from '../middleware/rateLimit.js';

const router = Router();

router.get('/status', (req, res, next) => {
  Promise.resolve(rateLimitStatusHandler(req, res)).catch(next);
});

export default router;
