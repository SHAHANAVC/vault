import mongoose, { Document, Schema, Types } from 'mongoose';
import { TransactionType, TransactionStatus } from '@vault/shared';

export interface ITransaction extends Document {
  _id: Types.ObjectId;
  householdId: Types.ObjectId;
  type: TransactionType;
  amount: number; // Positive integer paise (1 INR = 100 paise)
  fromBucketId?: Types.ObjectId;
  toBucketId?: Types.ObjectId;
  category?: string;
  purpose?: string;
  reason?: string;
  date: Date;
  createdBy: Types.ObjectId;
  groupId?: string;
  status: TransactionStatus;
  reversalOf?: Types.ObjectId;
  voidedBy?: Types.ObjectId;
  voidedAt?: Date;
  idempotencyKey?: string;
  createdAt: Date;
  updatedAt: Date;
}

const transactionMongooseSchema = new Schema<ITransaction>(
  {
    householdId: {
      type: Schema.Types.ObjectId,
      ref: 'Household',
      required: [true, 'Household ID is required'],
      index: true,
    },
    type: {
      type: String,
      required: [true, 'Transaction type is required'],
      enum: {
        values: ['income', 'expense', 'transfer', 'adjustment'],
        message: 'Invalid transaction type: {VALUE}',
      },
    },
    amount: {
      type: Number,
      required: [true, 'Amount is required'],
      validate: {
        validator: (v: number) => Number.isInteger(v) && v > 0,
        message: 'Amount must be a positive integer representing paise',
      },
    },
    fromBucketId: {
      type: Schema.Types.ObjectId,
      ref: 'Bucket',
      index: true,
    },
    toBucketId: {
      type: Schema.Types.ObjectId,
      ref: 'Bucket',
      index: true,
    },
    category: {
      type: String,
      trim: true,
      maxlength: [50, 'Category cannot exceed 50 characters'],
    },
    purpose: {
      type: String,
      trim: true,
      maxlength: [200, 'Purpose cannot exceed 200 characters'],
    },
    reason: {
      type: String,
      trim: true,
      maxlength: [200, 'Reason cannot exceed 200 characters'],
    },
    date: {
      type: Date,
      required: [true, 'Date is required'],
      default: Date.now,
    },
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Creator ID is required'],
      index: true,
    },
    groupId: {
      type: String,
      trim: true,
    },
    status: {
      type: String,
      required: true,
      enum: {
        values: ['active', 'voided'],
        message: 'Invalid status: {VALUE}',
      },
      default: 'active',
      index: true,
    },
    reversalOf: {
      type: Schema.Types.ObjectId,
      ref: 'Transaction',
    },
    voidedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
    },
    voidedAt: {
      type: Date,
    },
    idempotencyKey: {
      type: String,
      trim: true,
    },
  },
  {
    timestamps: true,
  }
);

// High-performance compound indexes for ledger queries
transactionMongooseSchema.index({ householdId: 1, date: -1 });
transactionMongooseSchema.index({ householdId: 1, fromBucketId: 1, date: -1 });
transactionMongooseSchema.index({ householdId: 1, toBucketId: 1, date: -1 });
transactionMongooseSchema.index({ householdId: 1, groupId: 1 });

// Unique partial index for idempotency keys per household (only indexes when idempotencyKey is a string)
transactionMongooseSchema.index(
  { householdId: 1, idempotencyKey: 1 },
  {
    unique: true,
    partialFilterExpression: {
      idempotencyKey: { $type: 'string' },
    },
  }
);

export const Transaction = mongoose.model<ITransaction>(
  'Transaction',
  transactionMongooseSchema
);
