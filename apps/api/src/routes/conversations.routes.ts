import { Router } from 'express';
import * as conversationsController from '../controllers/conversations.controller.js';

const router = Router();
const asyncRoute = (handler: (...args: any[]) => any) => (req: any, res: any, next: any) => Promise.resolve(handler(req, res, next)).catch(next);

router.post('/', asyncRoute(conversationsController.createConversation));
router.get('/', asyncRoute(conversationsController.listConversations));
router.get('/:id', asyncRoute(conversationsController.getConversation));
router.post('/:id/messages', asyncRoute(conversationsController.addMessage));
router.get('/:id/messages', asyncRoute(conversationsController.listMessages));
router.get('/:id/stream', asyncRoute(conversationsController.streamConversation));

export default router;
