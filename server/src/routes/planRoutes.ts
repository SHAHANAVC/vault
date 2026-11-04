import { Router } from 'express';
import { authenticate } from '../middlewares/authenticate';
import { PlanController } from '../controllers/planController';

const router = Router();

// All plan operations require authenticated household session
router.use(authenticate);

// Live alerts endpoint (must be before /:id)
router.get('/alerts', PlanController.getAlerts);

// Core plan CRUD & actions
router.post('/', PlanController.createPlan);
router.get('/', PlanController.getPlans);
router.get('/:id', PlanController.getPlanById);
router.patch('/:id', PlanController.updatePlan);
router.post('/:id/cancel', PlanController.cancelPlan);
router.post('/:id/pay', PlanController.payPlan);
router.post('/:id/payout', PlanController.payoutKuri);
router.post('/:id/bonus', PlanController.recordBonus);
router.post('/:id/redeem', PlanController.redeemPlan);
router.post('/:id/dismiss', PlanController.dismissAlert);

export { router as planRoutes };
