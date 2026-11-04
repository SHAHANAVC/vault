import mongoose, { Document, Schema, Types } from 'mongoose';
import { Visibility } from '@vault/shared';

export interface IParty extends Document {
  _id: Types.ObjectId;
  householdId: Types.ObjectId;
  ownerId: Types.ObjectId;
  name: string;
  phone?: string;
  note?: string;
  visibility: Visibility;
  isArchived: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const partySchema = new Schema<IParty>(
  {
    householdId: {
      type: Schema.Types.ObjectId,
      ref: 'Household',
      required: [true, 'Household ID is required'],
      index: true,
    },
    ownerId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Owner ID is required'],
      index: true,
    },
    name: {
      type: String,
      required: [true, 'Party name is required'],
      trim: true,
      maxlength: [100, 'Party name cannot exceed 100 characters'],
    },
    phone: {
      type: String,
      trim: true,
      maxlength: [25, 'Phone number cannot exceed 25 characters'],
    },
    note: {
      type: String,
      trim: true,
      maxlength: [300, 'Note cannot exceed 300 characters'],
    },
    visibility: {
      type: String,
      required: true,
      enum: {
        values: ['shared', 'private'],
        message: 'Invalid visibility: {VALUE}',
      },
      default: 'shared',
    },
    isArchived: {
      type: Boolean,
      default: false,
      index: true,
    },
  },
  {
    timestamps: true,
  }
);

// Party name must be unique per owner (case-insensitive)
partySchema.index(
  { ownerId: 1, name: 1 },
  {
    unique: true,
    collation: { locale: 'en', strength: 2 },
  }
);

partySchema.index({ householdId: 1, isArchived: 1 });

export const Party = mongoose.model<IParty>('Party', partySchema);
