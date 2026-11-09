import { Router } from 'express';
import { authenticate } from '../middlewares/authenticate';
import { TransactionController } from '../controllers/transactionController';

const router = Router();

// All ledger endpoints require authenticated household session
router.use(authenticate);

// Phase 5: Split & Adjustment Endpoints
router.post('/split-income', TransactionController.splitIncome);
router.post('/split-transfer', TransactionController.splitTransfer);
router.post('/adjustment', TransactionController.adjustment);

// Phase 5: Group Endpoints
router.get('/groups/:groupId', TransactionController.getGroupById);
router.post('/groups/:groupId/void', TransactionController.voidGroup);

// Core Transaction Endpoints
router.post('/', TransactionController.createTransaction);
router.get('/', TransactionController.getTransactions);
router.get('/reconcile', TransactionController.reconcile);
router.get('/:id', TransactionController.getTransactionById);
router.patch('/:id', TransactionController.updateTransaction);
router.post('/:id/void', TransactionController.voidTransaction);

export { router as transactionRoutes };
