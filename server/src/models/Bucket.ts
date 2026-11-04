import mongoose, { Document, Schema, Types } from 'mongoose';
import { BucketType, Visibility } from '@vault/shared';

export interface IBucket extends Document {
  _id: Types.ObjectId;
  householdId: Types.ObjectId;
  ownerId: Types.ObjectId;
  name: string;
  type: BucketType;
  balance: number; // Integer paise (1 INR = 100 paise)
  visibility: Visibility;
  description?: string;
  isArchived: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const bucketMongooseSchema = new Schema<IBucket>(
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
      required: [true, 'Bucket name is required'],
      trim: true,
      minlength: [1, 'Bucket name cannot be empty'],
      maxlength: [50, 'Bucket name cannot exceed 50 characters'],
    },
    type: {
      type: String,
      required: [true, 'Bucket type is required'],
      enum: {
        values: ['cash', 'bank', 'kuri', 'gold_scheme', 'loan_given', 'loan_taken'],
        message: 'Invalid bucket type: {VALUE}',
      },
    },
    balance: {
      type: Number,
      required: true,
      default: 0,
      validate: {
        validator: Number.isInteger,
        message: 'Balance must be an integer representing paise',
      },
    },
    visibility: {
      type: String,
      required: [true, 'Visibility level is required'],
      enum: {
        values: ['shared', 'balance_only', 'private'],
        message: 'Invalid visibility level: {VALUE}',
      },
      default: 'shared',
    },
    description: {
      type: String,
      trim: true,
      maxlength: [200, 'Description cannot exceed 200 characters'],
    },
    isArchived: {
      type: Boolean,
      required: true,
      default: false,
    },
  },
  {
    timestamps: true,
  }
);

// Compound indexes for performant household queries and owner filters
bucketMongooseSchema.index({ householdId: 1, isArchived: 1 });
bucketMongooseSchema.index({ householdId: 1, ownerId: 1 });

export const Bucket = mongoose.model<IBucket>('Bucket', bucketMongooseSchema);
