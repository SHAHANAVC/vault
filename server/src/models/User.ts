import { Schema, model, Document, Types } from 'mongoose';

/**
 * User Model
 * Stores core credentials and link to their household.
 * Email is strictly lowercased, trimmed, and unique.
 */
export interface IUser extends Document {
  name: string;
  email: string;
  passwordHash: string;
  householdId: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const userSchema = new Schema<IUser>(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    passwordHash: {
      type: String,
      required: true,
    },
    householdId: {
      type: Schema.Types.ObjectId,
      ref: 'Household',
      required: true,
      index: true,
    },
  },
  {
    timestamps: true,
  }
);

export const User = model<IUser>('User', userSchema);
