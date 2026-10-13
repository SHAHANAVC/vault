import { Types } from 'mongoose';
import bcrypt from 'bcryptjs';
import { RegisterInput, LoginInput, PublicUser } from '@vault/shared';
import { User, IUser } from '../models/User';
import { Household } from '../models/Household';
import { Invite } from '../models/Invite';
import { hashToken } from '../utils/crypto';
import { signJwt } from '../utils/jwt';
import { runInTransaction } from '../utils/transaction';

/**
 * BCrypt Cost Factor 12:
 * 2^12 = 4,096 key derivation rounds.
 * Takes ~200-300ms on modern server CPUs—safely mitigating offline dictionary
 * attacks while preserving a responsive user registration experience.
 */
const BCRYPT_SALT_ROUNDS = 12;

/**
 * Constant dummy hash used for constant-time comparison when an email is not found.
 * Equalizes timing to eliminate email enumeration attacks.
 */
const DUMMY_HASH = '$2a$12$e80yqZ6V62p1aImsH9wJcOa4v2OqY2U81yN07eG1g2E4k5m6p7q8r';

export interface AuthResult {
  user: PublicUser;
  token: string;
}

export interface UserWithPartnerProfile {
  user: PublicUser;
  partner: {
    id: string;
    name: string;
    email: string;
  } | null;
}

function toPublicUser(user: IUser, partnerId: string | null = null): PublicUser {
  return {
    id: user._id.toString(),
    name: user.name,
    email: user.email,
    householdId: user.householdId.toString(),
    partnerId: partnerId,
    createdAt: user.createdAt.toISOString(),
  };
}

export class AuthService {
  /**
   * Registers a user and sets up their household inside ONE MongoDB transaction session.
   * If an inviteToken is supplied, joins the existing inviter's household instead.
   */
  static async register(input: RegisterInput, inviteToken?: string): Promise<AuthResult> {
    const normalizedEmail = input.email.trim().toLowerCase();

    // Check if user with this email already exists before starting heavy hashing
    const existingUser = await User.findOne({ email: normalizedEmail });
    if (existingUser) {
      throw new Error('An account with this email address already exists');
    }

    const passwordHash = await bcrypt.hash(input.password, BCRYPT_SALT_ROUNDS);

    let createdUser: IUser | null = null;
    let partnerId: string | null = null;

    await runInTransaction(async (session) => {
      if (inviteToken) {
        // Joining via Partner Invite
        const tokenHash = hashToken(inviteToken);
        const invite = await Invite.findOne({
          tokenHash,
          status: 'pending',
          expiresAt: { $gt: new Date() },
        }).session(session ?? null);

        if (!invite) {
          throw new Error('Invalid or expired invite token');
        }

        const household = await Household.findById(invite.householdId).session(session ?? null);
        if (!household) {
          throw new Error('Associated partner household not found');
        }

        if (household.members.length >= 2) {
          throw new Error(
            'This partner household already has the maximum of 2 members'
          );
        }

        partnerId = invite.invitedBy.toString();

        const [userDoc] = await User.create(
          [
            {
              name: input.name.trim(),
              email: normalizedEmail,
              passwordHash,
              householdId: household._id,
            },
          ],
          { session }
        );

        if (!userDoc) {
          throw new Error('Failed to create user record');
        }
        createdUser = userDoc;

        // Add user to household members
        household.members.push(createdUser._id as Types.ObjectId);
        await household.save({ session });

        // Mark invite accepted
        invite.status = 'accepted';
        invite.usedBy = createdUser._id as Types.ObjectId;
        await invite.save({ session });
      } else {
        // Creating independent household
        const [householdDoc] = await Household.create(
          [
            {
              members: [],
            },
          ],
          { session }
        );

        if (!householdDoc) {
          throw new Error('Failed to create household record');
        }

        const [userDoc] = await User.create(
          [
            {
              name: input.name.trim(),
              email: normalizedEmail,
              passwordHash,
              householdId: householdDoc._id,
            },
          ],
          { session }
        );

        if (!userDoc) {
          throw new Error('Failed to create user record');
        }
        createdUser = userDoc;

        householdDoc.members.push(createdUser._id as Types.ObjectId);
        await householdDoc.save({ session });
      }
    });

    if (!createdUser) {
      throw new Error('Registration failed to complete transaction');
    }

    const token = signJwt({
      userId: (createdUser as IUser)._id.toString(),
      householdId: (createdUser as IUser).householdId.toString(),
    });

    return {
      user: toPublicUser(createdUser, partnerId),
      token,
    };
  }

  /**
   * Authenticates user with constant-time timing equalization and generic error messages.
   */
  static async login(input: LoginInput): Promise<AuthResult> {
    const normalizedEmail = input.email.trim().toLowerCase();
    const user = await User.findOne({ email: normalizedEmail });

    if (!user) {
      // Timing equalization: run dummy comparison so duration matches successful/failed hash compares
      await bcrypt.compare(input.password, DUMMY_HASH);
      throw new Error('Invalid email or password');
    }

    const isMatch = await bcrypt.compare(input.password, user.passwordHash);
    if (!isMatch) {
      throw new Error('Invalid email or password');
    }

    // Determine partner ID if household has 2 members
    const household = await Household.findById(user.householdId);
    let partnerId: string | null = null;
    if (household && household.members.length > 1) {
      const partnerObjId = household.members.find(
        (m) => m.toString() !== user._id.toString()
      );
      if (partnerObjId) {
        partnerId = partnerObjId.toString();
      }
    }

    const token = signJwt({
      userId: user._id.toString(),
      householdId: user.householdId.toString(),
    });

    return {
      user: toPublicUser(user, partnerId),
      token,
    };
  }

  /**
   * Returns current user data and partner's safe display profile.
   */
  static async getMe(userId: string): Promise<UserWithPartnerProfile> {
    const user = await User.findById(userId);
    if (!user) {
      throw new Error('User not found');
    }

    const household = await Household.findById(user.householdId);
    let partnerProfile: UserWithPartnerProfile['partner'] = null;
    let partnerId: string | null = null;

    if (household && household.members.length > 1) {
      const partnerObjId = household.members.find(
        (m) => m.toString() !== user._id.toString()
      );
      if (partnerObjId) {
        partnerId = partnerObjId.toString();
        const partnerUser = await User.findById(partnerObjId);
        if (partnerUser) {
          partnerProfile = {
            id: partnerUser._id.toString(),
            name: partnerUser.name,
            email: partnerUser.email,
          };
        }
      }
    }

    return {
      user: toPublicUser(user, partnerId),
      partner: partnerProfile,
    };
  }
}
