import { Request, Response } from 'express';
import {
  transactionInputSchema,
  splitIncomeSchema,
  splitTransferSchema,
  adjustmentSchema,
  transactionQuerySchema,
  updateTransactionSchema,
} from '@vault/shared';
import { TransactionService } from '../services/transactionService';
import { AppError } from '../utils/errors';

export class TransactionController {
  /**
   * POST /transactions
   * Creates income, expense, transfer, or adjustment
   */
  static async createTransaction(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ message: 'Authentication required' });
        return;
      }

      const parsed = transactionInputSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          message: 'Invalid transaction input',
          errors: parsed.error.flatten().fieldErrors,
        });
        return;
      }

      const transaction = await TransactionService.createTransaction(
        req.user.householdId,
        req.user.userId,
        parsed.data
      );
      res.status(201).json({ transaction });
    } catch (err) {
      if (err instanceof AppError) {
        res.status(err.statusCode).json({ message: err.message });
        return;
      }
      console.error('[TransactionController] createTransaction unexpected error:', err);
      res.status(500).json({
        message: err instanceof Error ? err.message : 'Failed to create transaction',
      });
    }
  }

  /**
   * POST /transactions/split-income
   * Creates a multi-allocation split income in one atomic transaction session
   */
  static async splitIncome(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ message: 'Authentication required' });
        return;
      }

      const parsed = splitIncomeSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          message: 'Invalid split income input',
          errors: parsed.error.flatten().fieldErrors,
        });
        return;
      }

      const group = await TransactionService.createSplitIncome(
        parsed.data,
        req.user.householdId,
        req.user.userId
      );
      res.status(201).json({ group });
    } catch (err) {
      if (err instanceof AppError) {
        res.status(err.statusCode).json({ message: err.message });
        return;
      }
      console.error('[TransactionController] splitIncome unexpected error:', err);
      res.status(500).json({
        message: err instanceof Error ? err.message : 'Failed to create split income',
      });
    }
  }

  /**
   * POST /transactions/split-transfer
   * Creates a multi-destination split transfer in one atomic transaction session
   */
  static async splitTransfer(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ message: 'Authentication required' });
        return;
      }

      const parsed = splitTransferSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          message: 'Invalid split transfer input',
          errors: parsed.error.flatten().fieldErrors,
        });
        return;
      }

      const group = await TransactionService.createSplitTransfer(
        parsed.data,
        req.user.householdId,
        req.user.userId
      );
      res.status(201).json({ group });
    } catch (err) {
      if (err instanceof AppError) {
        res.status(err.statusCode).json({ message: err.message });
        return;
      }
      console.error('[TransactionController] splitTransfer unexpected error:', err);
      res.status(500).json({
        message: err instanceof Error ? err.message : 'Failed to create split transfer',
      });
    }
  }

  /**
   * POST /transactions/adjustment
   * Creates an adjustment transaction for correcting balances (owner only)
   */
  static async adjustment(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ message: 'Authentication required' });
        return;
      }

      const parsed = adjustmentSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          message: 'Invalid adjustment input',
          errors: parsed.error.flatten().fieldErrors,
        });
        return;
      }

      const transaction = await TransactionService.createAdjustment(
        parsed.data,
        req.user.householdId,
        req.user.userId
      );
      res.status(201).json({ transaction });
    } catch (err) {
      if (err instanceof AppError) {
        res.status(err.statusCode).json({ message: err.message });
        return;
      }
      console.error('[TransactionController] adjustment unexpected error:', err);
      res.status(500).json({
        message: err instanceof Error ? err.message : 'Failed to create adjustment',
      });
    }
  }

  /**
   * GET /transactions/groups/:groupId
   * Retrieves a split group with per-line privacy enforcement
   */
  static async getGroupById(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ message: 'Authentication required' });
        return;
      }

      const group = await TransactionService.getGroupById(
        req.params['groupId'] as string,
        req.user.householdId,
        req.user.userId
      );
      res.status(200).json({ group });
    } catch (err) {
      if (err instanceof AppError) {
        res.status(err.statusCode).json({ message: err.message });
        return;
      }
      res.status(500).json({
        message: err instanceof Error ? err.message : 'Failed to fetch transaction group',
      });
    }
  }

  /**
   * POST /transactions/groups/:groupId/void
   * Voids an entire transaction group in one atomic session (creator only)
   */
  static async voidGroup(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ message: 'Authentication required' });
        return;
      }

      const group = await TransactionService.voidGroup(
        req.params['groupId'] as string,
        req.user.householdId,
        req.user.userId
      );
      res.status(200).json({ group });
    } catch (err) {
      if (err instanceof AppError) {
        res.status(err.statusCode).json({ message: err.message });
        return;
      }
      console.error('[TransactionController] voidGroup unexpected error:', err);
      res.status(500).json({
        message: err instanceof Error ? err.message : 'Failed to void transaction group',
      });
    }
  }

  /**
   * POST /transactions/:id/void
   * Voids an active transaction via an append-only reversal entry
   */
  static async voidTransaction(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ message: 'Authentication required' });
        return;
      }

      const transaction = await TransactionService.voidTransaction(
        req.params['id'] as string,
        req.user.householdId,
        req.user.userId
      );
      res.status(200).json({ transaction });
    } catch (err) {
      if (err instanceof AppError) {
        res.status(err.statusCode).json({ message: err.message });
        return;
      }
      console.error('[TransactionController] voidTransaction unexpected error:', err);
      res.status(500).json({
        message: err instanceof Error ? err.message : 'Failed to void transaction',
      });
    }
  }

  /**
   * PATCH /transactions/:id
   * Edits a transaction (metadata or amount/accounts with atomic reversal)
   */
  static async updateTransaction(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ message: 'Authentication required' });
        return;
      }

      const parsed = updateTransactionSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          message: 'Invalid transaction update payload',
          errors: parsed.error.flatten().fieldErrors,
        });
        return;
      }

      const transaction = await TransactionService.updateTransaction(
        req.params['id'] as string,
        req.user.householdId,
        req.user.userId,
        parsed.data
      );
      res.status(200).json({ transaction });
    } catch (err) {
      if (err instanceof AppError) {
        res.status(err.statusCode).json({ message: err.message });
        return;
      }
      console.error('[TransactionController] updateTransaction unexpected error:', err);
      res.status(500).json({
        message: err instanceof Error ? err.message : 'Failed to update transaction',
      });
    }
  }

  /**
   * GET /transactions
   * Lists transactions visible to the user with privacy masking, filters, search, and stable pagination
   */
  static async getTransactions(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ message: 'Authentication required' });
        return;
      }

      const parsedQuery = transactionQuerySchema.safeParse(req.query);
      if (!parsedQuery.success) {
        res.status(400).json({
          message: 'Invalid transaction query parameters',
          errors: parsedQuery.error.flatten().fieldErrors,
        });
        return;
      }

      const result = await TransactionService.getTransactions(
        req.user.householdId,
        req.user.userId,
        parsedQuery.data
      );
      res.status(200).json(result);
    } catch (err) {
      if (err instanceof AppError) {
        res.status(err.statusCode).json({ message: err.message });
        return;
      }
      console.error('[TransactionController] getTransactions unexpected error:', err);
      res.status(500).json({
        message: err instanceof Error ? err.message : 'Failed to fetch transactions',
      });
    }
  }

  /**
   * GET /transactions/:id
   * Retrieves a single transaction with privacy enforcement (404 if hidden)
   */
  static async getTransactionById(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ message: 'Authentication required' });
        return;
      }

      const transaction = await TransactionService.getTransactionById(
        req.params['id'] as string,
        req.user.householdId,
        req.user.userId
      );
      res.status(200).json({ transaction });
    } catch (err) {
      if (err instanceof AppError) {
        res.status(err.statusCode).json({ message: err.message });
        return;
      }
      res.status(500).json({
        message: err instanceof Error ? err.message : 'Failed to fetch transaction',
      });
    }
  }

  /**
   * GET /transactions/reconcile
   * Recomputes bucket balances from the immutable ledger and detects mismatches
   */
  static async reconcile(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ message: 'Authentication required' });
        return;
      }

      const report = await TransactionService.reconcile(req.user.householdId);
      res.status(200).json(report);
    } catch (err) {
      if (err instanceof AppError) {
        res.status(err.statusCode).json({ message: err.message });
        return;
      }
      res.status(500).json({
        message: err instanceof Error ? err.message : 'Failed to reconcile balances',
      });
    }
  }
}

