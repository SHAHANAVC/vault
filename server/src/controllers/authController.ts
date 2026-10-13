import { Request, Response } from 'express';
import { registerSchema, loginSchema } from '@vault/shared';
import { AuthService } from '../services/authService';
import { setAuthCookie, clearAuthCookie } from '../utils/cookies';

export class AuthController {
  static async register(req: Request, res: Response): Promise<void> {
    try {
      const parsedBody = registerSchema.safeParse(req.body);
      if (!parsedBody.success) {
        res.status(400).json({
          message: 'Invalid registration input',
          errors: parsedBody.error.flatten().fieldErrors,
        });
        return;
      }

      const inviteToken =
        typeof req.body.inviteToken === 'string'
          ? req.body.inviteToken.trim()
          : undefined;

      const { user, token } = await AuthService.register(parsedBody.data, inviteToken);
      setAuthCookie(res, token);
      res.status(201).json({ user });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Registration failed';
      res.status(400).json({ message });
    }
  }

  static async login(req: Request, res: Response): Promise<void> {
    try {
      const parsedBody = loginSchema.safeParse(req.body);
      if (!parsedBody.success) {
        res.status(400).json({
          message: 'Invalid login credentials format',
          errors: parsedBody.error.flatten().fieldErrors,
        });
        return;
      }

      const { user, token } = await AuthService.login(parsedBody.data);
      setAuthCookie(res, token);
      res.status(200).json({ user });
    } catch (_err) {
      // Generic error message: never reveal whether email exists or password failed
      res.status(401).json({ message: 'Invalid email or password' });
    }
  }

  static async logout(_req: Request, res: Response): Promise<void> {
    clearAuthCookie(res);
    res.status(200).json({ message: 'Logged out successfully' });
  }

  static async getMe(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ message: 'Unauthorized' });
        return;
      }

      const data = await AuthService.getMe(req.user.userId);
      res.status(200).json(data);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to retrieve profile';
      res.status(500).json({ message });
    }
  }
}
