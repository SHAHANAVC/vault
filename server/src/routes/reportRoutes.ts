import { Router } from 'express';
import { authenticate } from '../middlewares/authenticate';
import { ReportController } from '../controllers/reportController';

export const reportRouter = Router();

// All report endpoints require authentication
reportRouter.use(authenticate);

reportRouter.get('/summary', ReportController.getSummary);
reportRouter.get('/categories', ReportController.getCategories);
reportRouter.get('/trend', ReportController.getTrend);

export const dashboardRouter = Router();
dashboardRouter.use(authenticate);
dashboardRouter.get('/', ReportController.getDashboard);
