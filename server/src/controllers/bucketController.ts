import { Request, Response } from 'express';
import {
  createBucketSchema,
  updateBucketSchema,
  updateVisibilitySchema,
} from '@vault/shared';
import { BucketService } from '../services/bucketService';
import { AppError } from '../utils/errors';

export class BucketController {
  static async createBucket(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ message: 'Unauthorized' });
        return;
      }

      const parsed = createBucketSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          message: 'Invalid bucket input',
          errors: parsed.error.flatten().fieldErrors,
        });
        return;
      }

      const bucket = await BucketService.createBucket(
        req.user.householdId,
        req.user.userId,
        parsed.data
      );

      res.status(201).json({ bucket });
    } catch (err) {
      if (err instanceof AppError) {
        res.status(err.statusCode).json({ message: err.message });
        return;
      }
      res.status(500).json({
        message: err instanceof Error ? err.message : 'Failed to create bucket',
      });
    }
  }

  static async getBuckets(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ message: 'Unauthorized' });
        return;
      }

      const includeArchived = req.query['includeArchived'] === 'true';
      const buckets = await BucketService.getBuckets(
        req.user.householdId,
        req.user.userId,
        includeArchived
      );

      res.status(200).json({ buckets });
    } catch (err) {
      if (err instanceof AppError) {
        res.status(err.statusCode).json({ message: err.message });
        return;
      }
      res.status(500).json({ message: 'Failed to retrieve buckets' });
    }
  }

  static async getSummary(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ message: 'Unauthorized' });
        return;
      }

      const summary = await BucketService.getSummary(
        req.user.householdId,
        req.user.userId
      );

      res.status(200).json(summary);
    } catch (err) {
      if (err instanceof AppError) {
        res.status(err.statusCode).json({ message: err.message });
        return;
      }
      res.status(500).json({ message: 'Failed to calculate summary' });
    }
  }

  static async getBucketById(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ message: 'Unauthorized' });
        return;
      }

      const bucketId = req.params['id'];
      if (!bucketId) {
        res.status(400).json({ message: 'Bucket ID is required' });
        return;
      }

      const bucket = await BucketService.getBucketById(
        bucketId,
        req.user.householdId,
        req.user.userId
      );

      res.status(200).json({ bucket });
    } catch (err) {
      if (err instanceof AppError) {
        res.status(err.statusCode).json({ message: err.message });
        return;
      }
      res.status(500).json({ message: 'Failed to retrieve bucket' });
    }
  }

  static async updateBucket(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ message: 'Unauthorized' });
        return;
      }

      const bucketId = req.params['id'];
      if (!bucketId) {
        res.status(400).json({ message: 'Bucket ID is required' });
        return;
      }

      const parsed = updateBucketSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          message: 'Invalid update input',
          errors: parsed.error.flatten().fieldErrors,
        });
        return;
      }

      const bucket = await BucketService.updateBucket(
        bucketId,
        req.user.householdId,
        req.user.userId,
        parsed.data
      );

      res.status(200).json({ bucket });
    } catch (err) {
      if (err instanceof AppError) {
        res.status(err.statusCode).json({ message: err.message });
        return;
      }
      res.status(500).json({ message: 'Failed to update bucket' });
    }
  }

  static async updateVisibility(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ message: 'Unauthorized' });
        return;
      }

      const bucketId = req.params['id'];
      if (!bucketId) {
        res.status(400).json({ message: 'Bucket ID is required' });
        return;
      }

      const parsed = updateVisibilitySchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          message: 'Invalid visibility input',
          errors: parsed.error.flatten().fieldErrors,
        });
        return;
      }

      const bucket = await BucketService.updateVisibility(
        bucketId,
        req.user.householdId,
        req.user.userId,
        parsed.data
      );

      res.status(200).json({ bucket });
    } catch (err) {
      if (err instanceof AppError) {
        res.status(err.statusCode).json({ message: err.message });
        return;
      }
      res.status(500).json({ message: 'Failed to update visibility' });
    }
  }

  static async archiveBucket(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ message: 'Unauthorized' });
        return;
      }

      const bucketId = req.params['id'];
      if (!bucketId) {
        res.status(400).json({ message: 'Bucket ID is required' });
        return;
      }

      const bucket = await BucketService.archiveBucket(
        bucketId,
        req.user.householdId,
        req.user.userId
      );

      res.status(200).json({ bucket });
    } catch (err) {
      if (err instanceof AppError) {
        res.status(err.statusCode).json({ message: err.message });
        return;
      }
      res.status(500).json({ message: 'Failed to archive bucket' });
    }
  }
}
