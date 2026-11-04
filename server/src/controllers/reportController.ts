import { Request, Response } from 'express';
import { TransactionService } from '../services/transactionService';
import { AppError } from '../utils/errors';

export class ReportController {
  /**
   * GET /reports/summary?month=YYYY-MM
   * Returns monthly income, expense, and net savings in integer paise
   */
  static async getSummary(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ message: 'Authentication required' });
        return;
      }

      const month = req.query['month'] as string | undefined;
      const summary = await TransactionService.getMonthSummary(
        req.user.householdId,
        req.user.userId,
        month
      );
      res.status(200).json(summary);
    } catch (err) {
      if (err instanceof AppError) {
        res.status(err.statusCode).json({ message: err.message });
        return;
      }
      res.status(500).json({
        message: err instanceof Error ? err.message : 'Failed to fetch summary report',
      });
    }
  }

  /**
   * GET /reports/categories?month=YYYY-MM
   * Returns expense distribution across categories for the month
   */
  static async getCategories(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ message: 'Authentication required' });
        return;
      }

      const month = req.query['month'] as string | undefined;
      const breakdown = await TransactionService.getCategoryBreakdown(
        req.user.householdId,
        req.user.userId,
        month
      );
      res.status(200).json(breakdown);
    } catch (err) {
      if (err instanceof AppError) {
        res.status(err.statusCode).json({ message: err.message });
        return;
      }
      res.status(500).json({
        message: err instanceof Error ? err.message : 'Failed to fetch category report',
      });
    }
  }

  /**
   * GET /reports/trend?months=6
   * Returns chronological monthly income vs expense history
   */
  static async getTrend(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ message: 'Authentication required' });
        return;
      }

      const months = req.query['months'] ? parseInt(req.query['months'] as string, 10) : 6;
      const trend = await TransactionService.getTrend(
        req.user.householdId,
        req.user.userId,
        months
      );
      res.status(200).json(trend);
    } catch (err) {
      if (err instanceof AppError) {
        res.status(err.statusCode).json({ message: err.message });
        return;
      }
      res.status(500).json({
        message: err instanceof Error ? err.message : 'Failed to fetch trend report',
      });
    }
  }

  /**
   * GET /dashboard
   * Consolidated household financial status, buckets, month summary, and recent transactions
   */
  static async getDashboard(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ message: 'Authentication required' });
        return;
      }

      const month = req.query['month'] as string | undefined;
      const dashboard = await TransactionService.getDashboard(
        req.user.householdId,
        req.user.userId,
        month
      );
      res.status(200).json(dashboard);
    } catch (err) {
      if (err instanceof AppError) {
        res.status(err.statusCode).json({ message: err.message });
        return;
      }
      res.status(500).json({
        message: err instanceof Error ? err.message : 'Failed to fetch dashboard data',
      });
    }
  }
}
