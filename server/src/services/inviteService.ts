import { Types } from 'mongoose';
import { PublicUser } from '@vault/shared';
import { Invite } from '../models/Invite';
import { Household } from '../models/Household';
import { User, IUser } from '../models/User';
import { generateInviteToken, hashToken } from '../utils/crypto';
import { signJwt } from '../utils/jwt';
import { runInTransaction } from '../utils/transaction';

export interface InviteCreateResult {
  token: string;
  inviteUrl: string;
  expiresAt: string;
}

export interface InvitePreviewResult {
  valid: boolean;
  isExpired: boolean;
  inviterFirstName: string | null;
  expiresAt: string | null;
}

export interface InviteAcceptResult {
  user: PublicUser;
  token: string;
}

export class InviteService {
  /**
   * Creates a single-use partner invite valid for 7 days.
   * Stores ONLY the SHA-256 hash in the database.
   * Returns the raw token once in the generated invite link.
   */
  static async createInvite(
    userId: string,
    householdId: string,
    expiresInDays = 7
  ): Promise<InviteCreateResult> {
    const household = await Household.findById(householdId);
    if (!household) {
      throw new Error('Household not found');
    }

    if (household.members.length >= 2) {
      throw new Error('This household already has 2 members (maximum capacity)');
    }

    const { rawToken, tokenHash } = generateInviteToken();
    const expiresAt = new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000);

    // Invalidate any previously pending invites created by this user
    await Invite.updateMany(
      {
        invitedBy: new Types.ObjectId(userId),
        status: 'pending',
      },
      {
        status: 'expired',
      }
    );

    await Invite.create({
      householdId: new Types.ObjectId(householdId),
      invitedBy: new Types.ObjectId(userId),
      tokenHash,
      expiresAt,
      status: 'pending',
    });

    const clientUrl = process.env['CLIENT_URL'] || 'http://localhost:3000';
    const inviteUrl = `${clientUrl}/invite/${rawToken}`;

    return {
      token: rawToken,
      inviteUrl,
      expiresAt: expiresAt.toISOString(),
    };
  }

  /**
   * Previews an invitation safely without exposing any sensitive financial or private user information.
   * Only returns whether valid/expired and the inviter's first name.
   */
  static async getPreview(rawToken: string): Promise<InvitePreviewResult> {
    const tokenHash = hashToken(rawToken);
    const invite = await Invite.findOne({ tokenHash });

    if (!invite || invite.status !== 'pending') {
      return {
        valid: false,
        isExpired: true,
        inviterFirstName: null,
        expiresAt: null,
      };
    }

    const isExpired = new Date() > invite.expiresAt;
    if (isExpired) {
      return {
        valid: false,
        isExpired: true,
        inviterFirstName: null,
        expiresAt: invite.expiresAt.toISOString(),
      };
    }

    const inviter = await User.findById(invite.invitedBy);
    const inviterFirstName = inviter
      ? inviter.name.trim().split(' ')[0] || inviter.name
      : 'Partner';

    return {
      valid: true,
      isExpired: false,
      inviterFirstName,
      expiresAt: invite.expiresAt.toISOString(),
    };
  }

  /**
   * Accepts an invitation for an existing authenticated user.
   * Runs atomically inside a MongoDB transaction session.
   */
  static async acceptInvite(
    rawToken: string,
    userId: string
  ): Promise<InviteAcceptResult> {
    const tokenHash = hashToken(rawToken);
    let updatedUser: IUser | null = null;
    let partnerId: string | null = null;

    await runInTransaction(async (session) => {
      const invite = await Invite.findOne({
        tokenHash,
        status: 'pending',
        expiresAt: { $gt: new Date() },
      }).session(session ?? null);

      if (!invite) {
        throw new Error('Invalid, expired, or already used invite token');
      }

      // Rule: Cannot accept your own invite
      if (invite.invitedBy.toString() === userId) {
        throw new Error('You cannot accept your own invitation');
      }

      // Rule: Target household has at most 2 members
      const targetHousehold = await Household.findById(invite.householdId).session(
        session ?? null
      );
      if (!targetHousehold) {
        throw new Error('Target partner household not found');
      }

      if (targetHousehold.members.length >= 2) {
        throw new Error('Target partner household already has 2 members');
      }

      const currentUser = await User.findById(userId).session(session ?? null);
      if (!currentUser) {
        throw new Error('Authenticated user not found');
      }

      // Rule: User who already has other data or members in their current household cannot switch
      const currentHousehold = await Household.findById(
        currentUser.householdId
      ).session(session ?? null);
      if (currentHousehold && currentHousehold.members.length > 1) {
        throw new Error(
          'You already belong to a partner household. You cannot join another household.'
        );
      }

      const oldHouseholdId = currentUser.householdId;

      // Associate user to new household
      currentUser.householdId = targetHousehold._id as Types.ObjectId;
      await currentUser.save({ session });
      updatedUser = currentUser;

      targetHousehold.members.push(currentUser._id as Types.ObjectId);
      await targetHousehold.save({ session });

      // Update invite
      invite.status = 'accepted';
      invite.usedBy = currentUser._id as Types.ObjectId;
      await invite.save({ session });

      // Clean up old empty solo household
      if (
        oldHouseholdId &&
        oldHouseholdId.toString() !== targetHousehold._id.toString()
      ) {
        await Household.findByIdAndDelete(oldHouseholdId).session(session ?? null);
      }

      partnerId = invite.invitedBy.toString();
    });

    if (!updatedUser) {
      throw new Error('Failed to complete invite acceptance transaction');
    }

    const token = signJwt({
      userId: (updatedUser as IUser)._id.toString(),
      householdId: (updatedUser as IUser).householdId.toString(),
    });

    const publicUser: PublicUser = {
      id: (updatedUser as IUser)._id.toString(),
      name: (updatedUser as IUser).name,
      email: (updatedUser as IUser).email,
      householdId: (updatedUser as IUser).householdId.toString(),
      partnerId,
      createdAt: (updatedUser as IUser).createdAt.toISOString(),
    };

    return {
      user: publicUser,
      token,
    };
  }
}
