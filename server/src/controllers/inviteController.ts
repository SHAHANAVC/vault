import { Request, Response } from 'express';
import { createInviteSchema, acceptInviteSchema } from '@vault/shared';
import { InviteService } from '../services/inviteService';
import { setAuthCookie } from '../utils/cookies';

export class InviteController {
  static async create(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ message: 'Unauthorized' });
        return;
      }

      const parsed = createInviteSchema.safeParse(req.body);
      const expiresInDays = parsed.success ? parsed.data.expiresInDays : 7;

      const originHeader =
        (req.headers.origin as string) ||
        (req.headers.referer ? new URL(req.headers.referer as string).origin : undefined);

      const result = await InviteService.createInvite(
        req.user.userId,
        req.user.householdId,
        expiresInDays,
        originHeader
      );

      res.status(201).json(result);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Failed to create partner invite';
      res.status(400).json({ message });
    }
  }

  static async preview(req: Request, res: Response): Promise<void> {
    try {
      const token = req.params['token'];
      if (!token) {
        res.status(400).json({ message: 'Invite token is required' });
        return;
      }

      const result = await InviteService.getPreview(token);
      res.status(200).json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to preview invite';
      res.status(400).json({ message });
    }
  }

  static async accept(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ message: 'Unauthorized' });
        return;
      }

      const token = req.params['token'] || req.body.token;
      const parsedToken = acceptInviteSchema.safeParse({ token });

      if (!parsedToken.success) {
        res.status(400).json({
          message: 'Invalid invite token format',
          errors: parsedToken.error.flatten().fieldErrors,
        });
        return;
      }

      const { user, token: newToken } = await InviteService.acceptInvite(
        parsedToken.data.token,
        req.user.userId
      );

      // Reissue auth cookie with updated household ID
      setAuthCookie(res, newToken);
      res.status(200).json({ user, message: 'Partner invite accepted successfully' });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to accept invite';
      res.status(400).json({ message });
    }
  }
}
