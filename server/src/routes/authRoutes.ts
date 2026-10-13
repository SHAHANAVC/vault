import { Router } from 'express';
import { AuthController } from '../controllers/authController';
import { authenticate } from '../middlewares/authenticate';
import { authLimiter } from '../middlewares/rateLimiters';

export const authRouter = Router();

authRouter.post('/register', authLimiter, AuthController.register);
authRouter.post('/login', authLimiter, AuthController.login);
authRouter.post('/logout', AuthController.logout);
authRouter.get('/me', authenticate, AuthController.getMe);
