import { Router } from 'express';
import { authenticate } from '../middlewares/authenticate';
import { BucketController } from '../controllers/bucketController';

const router = Router();

// All bucket operations require an authenticated session
router.use(authenticate);

// Create a new bucket
router.post('/', BucketController.createBucket);

// List visible buckets
router.get('/', BucketController.getBuckets);

// Calculate household and personal totals (must precede /:id)
router.get('/summary', BucketController.getSummary);

// Single bucket details (enforces 404 privacy masking)
router.get('/:id', BucketController.getBucketById);

// Update bucket properties (name, description)
router.patch('/:id', BucketController.updateBucket);

// Update bucket visibility level
router.patch('/:id/visibility', BucketController.updateVisibility);

// Archive bucket (requires zero balance)
router.post('/:id/archive', BucketController.archiveBucket);

export const bucketRouter = router;
