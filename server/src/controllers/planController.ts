import { Request, Response } from 'express';
import {
  createPlanSchema,
  updatePlanSchema,
  payPlanSchema,
  kuriPayoutSchema,
  recordBonusSchema,
  redeemSchema,
} from '@vault/shared';
import { PlanService } from '../services/planService';
import { AppError } from '../utils/errors';

export class PlanController {
  /**
   * POST /plans
   * Creates an EMI or Kuri plan
   */
  static async createPlan(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ message: 'Authentication required' });
        return;
      }

      const parsed = createPlanSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          message: 'Invalid plan input',
          errors: parsed.error.flatten().fieldErrors,
        });
        return;
      }

      const plan = await PlanService.createPlan(
        req.user.householdId,
        req.user.userId,
        parsed.data
      );
      res.status(201).json(plan);
    } catch (err) {
      if (err instanceof AppError) {
        res.status(err.statusCode).json({ message: err.message });
        return;
      }
      res.status(500).json({
        message: err instanceof Error ? err.message : 'Failed to create plan',
      });
    }
  }

  /**
   * GET /plans
   * Lists plans visible to current viewer
   */
  static async getPlans(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ message: 'Authentication required' });
        return;
      }

      const statusFilter = req.query['status'] as string | undefined;
      const plans = await PlanService.getPlans(
        req.user.householdId,
        req.user.userId,
        statusFilter
      );
      res.status(200).json({ plans });
    } catch (err) {
      if (err instanceof AppError) {
        res.status(err.statusCode).json({ message: err.message });
        return;
      }
      res.status(500).json({
        message: err instanceof Error ? err.message : 'Failed to fetch plans',
      });
    }
  }

  /**
   * GET /plans/alerts
   * Live alerts for due, due-soon and overdue payments with shortfall analysis
   */
  static async getAlerts(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ message: 'Authentication required' });
        return;
      }

      const alertsData = await PlanService.getAlerts(
        req.user.householdId,
        req.user.userId
      );
      res.status(200).json(alertsData);
    } catch (err) {
      if (err instanceof AppError) {
        res.status(err.statusCode).json({ message: err.message });
        return;
      }
      res.status(500).json({
        message: err instanceof Error ? err.message : 'Failed to fetch plan alerts',
      });
    }
  }

  /**
   * GET /plans/:id
   * Single plan detail with payment history
   */
  static async getPlanById(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ message: 'Authentication required' });
        return;
      }

      const result = await PlanService.getPlanById(
        req.params['id'] as string,
        req.user.householdId,
        req.user.userId
      );
      res.status(200).json(result);
    } catch (err) {
      if (err instanceof AppError) {
        res.status(err.statusCode).json({ message: err.message });
        return;
      }
      res.status(500).json({
        message: err instanceof Error ? err.message : 'Failed to fetch plan',
      });
    }
  }

  /**
   * PATCH /plans/:id
   * Modifies plan metadata or terms (if unpaid)
   */
  static async updatePlan(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ message: 'Authentication required' });
        return;
      }

      const parsed = updatePlanSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          message: 'Invalid plan update payload',
          errors: parsed.error.flatten().fieldErrors,
        });
        return;
      }

      const updated = await PlanService.updatePlan(
        req.params['id'] as string,
        req.user.householdId,
        req.user.userId,
        parsed.data
      );
      res.status(200).json(updated);
    } catch (err) {
      if (err instanceof AppError) {
        res.status(err.statusCode).json({ message: err.message });
        return;
      }
      res.status(500).json({
        message: err instanceof Error ? err.message : 'Failed to update plan',
      });
    }
  }

  /**
   * POST /plans/:id/cancel
   * Cancels active plan
   */
  static async cancelPlan(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ message: 'Authentication required' });
        return;
      }

      const cancelled = await PlanService.cancelPlan(
        req.params['id'] as string,
        req.user.householdId,
        req.user.userId
      );
      res.status(200).json(cancelled);
    } catch (err) {
      if (err instanceof AppError) {
        res.status(err.statusCode).json({ message: err.message });
        return;
      }
      res.status(500).json({
        message: err instanceof Error ? err.message : 'Failed to cancel plan',
      });
    }
  }

  /**
   * POST /plans/:id/pay
   * Records installment payment (Expense for EMI, Transfer for Kuri)
   */
  static async payPlan(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ message: 'Authentication required' });
        return;
      }

      const planId = req.params['id'] as string;
      const parsed = payPlanSchema.safeParse({ ...req.body, planId });
      if (!parsed.success) {
        res.status(400).json({
          message: 'Invalid payment parameters',
          errors: parsed.error.flatten().fieldErrors,
        });
        return;
      }

      const result = await PlanService.payPlan(
        planId,
        req.user.householdId,
        req.user.userId,
        parsed.data
      );
      res.status(201).json(result);
    } catch (err) {
      if (err instanceof AppError) {
        res.status(err.statusCode).json({ message: err.message });
        return;
      }
      res.status(500).json({
        message: err instanceof Error ? err.message : 'Failed to record plan payment',
      });
    }
  }

  /**
   * POST /plans/:id/payout (kuri only)
   * Records payout transfer from Kuri bucket
   */
  static async payoutKuri(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ message: 'Authentication required' });
        return;
      }

      const planId = req.params['id'] as string;
      const parsed = kuriPayoutSchema.safeParse({ ...req.body, planId });
      if (!parsed.success) {
        res.status(400).json({
          message: 'Invalid payout parameters',
          errors: parsed.error.flatten().fieldErrors,
        });
        return;
      }

      const result = await PlanService.payoutKuri(
        planId,
        req.user.householdId,
        req.user.userId,
        parsed.data
      );
      res.status(200).json(result);
    } catch (err) {
      if (err instanceof AppError) {
        res.status(err.statusCode).json({ message: err.message });
        return;
      }
      res.status(500).json({
        message: err instanceof Error ? err.message : 'Failed to record kuri payout',
      });
    }
  }

  /**
   * POST /plans/:id/bonus
   * Records jeweller bonus as income in gold_scheme bucket
   */
  static async recordBonus(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ message: 'Authentication required' });
        return;
      }

      const planId = req.params['id'] as string;
      const parsed = recordBonusSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          message: 'Invalid bonus parameters',
          errors: parsed.error.flatten().fieldErrors,
        });
        return;
      }

      const result = await PlanService.recordBonus(
        planId,
        req.user.householdId,
        req.user.userId,
        parsed.data
      );
      res.status(200).json(result);
    } catch (err) {
      if (err instanceof AppError) {
        res.status(err.statusCode).json({ message: err.message });
        return;
      }
      res.status(500).json({
        message: err instanceof Error ? err.message : 'Failed to record gold scheme bonus',
      });
    }
  }

  /**
   * POST /plans/:id/redeem
   * Redeems gold scheme for jewellery purchase or cash refund
   */
  static async redeemPlan(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ message: 'Authentication required' });
        return;
      }

      const planId = req.params['id'] as string;
      const parsed = redeemSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          message: 'Invalid redeem parameters',
          errors: parsed.error.flatten().fieldErrors,
        });
        return;
      }

      const result = await PlanService.redeemPlan(
        planId,
        req.user.householdId,
        req.user.userId,
        parsed.data
      );
      res.status(200).json(result);
    } catch (err) {
      if (err instanceof AppError) {
        res.status(err.statusCode).json({ message: err.message });
        return;
      }
      res.status(500).json({
        message: err instanceof Error ? err.message : 'Failed to redeem gold scheme',
      });
    }
  }

  /**
   * POST /plans/:id/dismiss
   * Dismisses an alert for the current user for today
   */
  static async dismissAlert(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ message: 'Authentication required' });
        return;
      }

      const planId = req.params['id'] as string;
      const result = await PlanService.dismissAlertToday(
        planId,
        req.user.householdId,
        req.user.userId
      );
      res.status(200).json(result);
    } catch (err) {
      if (err instanceof AppError) {
        res.status(err.statusCode).json({ message: err.message });
        return;
      }
      res.status(500).json({
        message: err instanceof Error ? err.message : 'Failed to dismiss alert',
      });
    }
  }
}
