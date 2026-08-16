import { Router } from 'express';
import * as documentsController from '../controllers/documents.controller.js';
import { requireUuidParam } from '../middleware/validate.js';

const router = Router();
const asyncRoute = (handler: (...args: any[]) => any) => (req: any, res: any, next: any) => Promise.resolve(handler(req, res, next)).catch(next);

router.post('/upload/init', asyncRoute(documentsController.initUpload));
router.post('/upload/chunk', asyncRoute(documentsController.uploadChunk));
router.post('/upload/complete', asyncRoute(documentsController.completeUpload));
router.get('/', asyncRoute(documentsController.listDocuments));
router.use('/:id', requireUuidParam('id'));
router.get('/:id/file', asyncRoute(documentsController.getDocumentFile));
router.get('/:id', asyncRoute(documentsController.getDocument));
router.delete('/:id', asyncRoute(documentsController.deleteDocument));
router.get('/:id/status', asyncRoute(documentsController.getDocumentStatus));
router.post('/:id/reprocess', asyncRoute(documentsController.reprocessDocument));
router.post('/:id/cancel', asyncRoute(documentsController.cancelDocument));
router.post('/:id/search', asyncRoute(documentsController.searchDocument));
router.post('/:id/search/stream', asyncRoute(documentsController.searchDocumentStream));
router.post('/:id/training-feedback', asyncRoute(documentsController.recordTrainingFeedback));
router.post('/:id/chapters/:chapterNumber/graph', asyncRoute(documentsController.getChapterGraph));
router.get('/:id/chapters/:chapterNumber/graph', asyncRoute(documentsController.getChapterGraph));

export default router;
