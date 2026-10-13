import { Schema, model, Document, Types } from 'mongoose';

export type InviteStatus = 'pending' | 'accepted' | 'expired';

/**
 * Partner Invite Model
 * Stores single-use invitation details.
 * CRITICAL SECURITY INVARIANT:
 * Raw tokens are NEVER stored in the database.
 * Only the SHA-256 cryptographic hash (tokenHash) is persisted.
 */
export interface IInvite extends Document {
  householdId: Types.ObjectId;
  invitedBy: Types.ObjectId;
  tokenHash: string;
  expiresAt: Date;
  status: InviteStatus;
  usedBy?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const inviteSchema = new Schema<IInvite>(
  {
    householdId: {
      type: Schema.Types.ObjectId,
      ref: 'Household',
      required: true,
      index: true,
    },
    invitedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    tokenHash: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    expiresAt: {
      type: Date,
      required: true,
      index: true,
    },
    status: {
      type: String,
      enum: ['pending', 'accepted', 'expired'],
      default: 'pending',
      index: true,
    },
    usedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

export const Invite = model<IInvite>('Invite', inviteSchema);
