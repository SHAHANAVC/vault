import { Router } from 'express';
import { InviteController } from '../controllers/inviteController';
import { authenticate } from '../middlewares/authenticate';
import { inviteLimiter } from '../middlewares/rateLimiters';

export const inviteRouter = Router();

// Create a new single-use invite link
inviteRouter.post('/', authenticate, inviteLimiter, InviteController.create);

// Preview an invite link (public safe preview)
inviteRouter.get('/:token/preview', InviteController.preview);

// Accept an invite for a logged-in user
inviteRouter.post('/:token/accept', authenticate, inviteLimiter, InviteController.accept);
