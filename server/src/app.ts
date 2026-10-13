import express, { Request, Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import morgan from 'morgan';
import { healthResponseSchema, HealthResponse } from '@vault/shared';
import { authRouter } from './routes/authRoutes';
import { inviteRouter } from './routes/inviteRoutes';
import { bucketRouter } from './routes/bucketRoutes';
import { transactionRoutes } from './routes/transactionRoutes';
import { strictRateLimiter } from './middlewares/rateLimiters';

export const app = express();

/**
 * Trust Proxy:
 * Express must trust the 1st hop reverse proxy (e.g. Next.js rewrite proxy, Nginx, or Cloud load balancer).
 * This ensures req.ip, X-Forwarded-Proto (HTTPS verification for cookies), and secure cookie transmission work correctly.
 */
app.set('trust proxy', 1);

// Security Headers
app.use(helmet());

// CORS Configuration with Credentials support
app.use(
  cors({
    origin: process.env['CLIENT_URL'] || 'http://localhost:3000',
    credentials: true,
  })
);

// Body and Cookie Parsers
app.use(express.json());
app.use(cookieParser());

// Request logging (suppressed during unit/integration tests)
if (process.env['NODE_ENV'] !== 'test') {
  app.use(morgan('dev'));
}

// Health Check Endpoints
const handleHealth = (_req: Request, res: Response) => {
  const healthData: HealthResponse = {
    status: 'ok',
    service: 'Vault Server API',
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.floor(process.uptime()),
  };
  const validated = healthResponseSchema.parse(healthData);
  res.status(200).json(validated);
};

app.get('/health', handleHealth);
app.get('/api/health', handleHealth);

// Test endpoint to verify rate-limiting behavior in automated tests
app.get('/api/test-rate-limit', strictRateLimiter, (_req: Request, res: Response) => {
  res.status(200).json({ ok: true });
});

// Domain Routes (mounted directly and under /api for Next.js proxy rewrites)
app.use('/auth', authRouter);
app.use('/api/auth', authRouter);

app.use('/invites', inviteRouter);
app.use('/api/invites', inviteRouter);

app.use('/buckets', bucketRouter);
app.use('/api/buckets', bucketRouter);

app.use('/transactions', transactionRoutes);
app.use('/api/transactions', transactionRoutes);

