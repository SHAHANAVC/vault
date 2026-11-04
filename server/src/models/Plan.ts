import mongoose, { Document, Schema, Types } from 'mongoose';
import { PlanKind, PlanStatus, Visibility } from '@vault/shared';

export interface IPlan extends Document {
  _id: Types.ObjectId;
  householdId: Types.ObjectId;
  ownerId: Types.ObjectId;
  kind: PlanKind;
  name: string;
  note?: string;
  totalAmount: number; // Integer paise
  monthlyAmount: number; // Integer paise
  totalInstallments: number;
  paidInstallments: number;
  paidAmount: number; // Integer paise
  dueDay: number;
  startDate: Date;
  payFromBucketId: Types.ObjectId;
  kuriBucketId?: Types.ObjectId;
  jewellerName?: string;
  bonusAmount?: number; // Integer paise
  bonusRecorded: boolean;
  goldBucketId?: Types.ObjectId;
  redeemRecorded: boolean;
  redeemOption?: 'jewellery' | 'cash_refund';
  reminderDaysBefore: number;
  visibility: Visibility;
  status: PlanStatus;
  payoutRecorded: boolean;
  completedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const planSchema = new Schema<IPlan>(
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
    kind: {
      type: String,
      required: [true, 'Plan kind is required'],
      enum: {
        values: ['emi', 'kuri', 'gold_scheme'],
        message: 'Invalid plan kind: {VALUE}',
      },
    },
    name: {
      type: String,
      required: [true, 'Plan name is required'],
      trim: true,
      maxlength: [100, 'Plan name cannot exceed 100 characters'],
    },
    note: {
      type: String,
      trim: true,
      maxlength: [300, 'Note cannot exceed 300 characters'],
    },
    totalAmount: {
      type: Number,
      required: [true, 'Total amount is required'],
      validate: {
        validator: (v: number) => Number.isInteger(v) && v > 0,
        message: 'Total amount must be a positive integer in paise',
      },
    },
    monthlyAmount: {
      type: Number,
      required: [true, 'Monthly amount is required'],
      validate: {
        validator: (v: number) => Number.isInteger(v) && v > 0,
        message: 'Monthly amount must be a positive integer in paise',
      },
    },
    totalInstallments: {
      type: Number,
      required: [true, 'Total installments is required'],
      validate: {
        validator: (v: number) => Number.isInteger(v) && v > 0,
        message: 'Total installments must be a positive integer',
      },
    },
    paidInstallments: {
      type: Number,
      required: true,
      default: 0,
      validate: {
        validator: (v: number) => Number.isInteger(v) && v >= 0,
        message: 'Paid installments must be a non-negative integer',
      },
    },
    paidAmount: {
      type: Number,
      required: true,
      default: 0,
      validate: {
        validator: (v: number) => Number.isInteger(v) && v >= 0,
        message: 'Paid amount must be a non-negative integer in paise',
      },
    },
    dueDay: {
      type: Number,
      required: [true, 'Due day is required'],
      min: [1, 'Due day must be between 1 and 31'],
      max: [31, 'Due day must be between 1 and 31'],
    },
    startDate: {
      type: Date,
      required: [true, 'Start date is required'],
    },
    payFromBucketId: {
      type: Schema.Types.ObjectId,
      ref: 'Bucket',
      required: [true, 'Payment bucket ID is required'],
      index: true,
    },
    kuriBucketId: {
      type: Schema.Types.ObjectId,
      ref: 'Bucket',
      index: true,
    },
    jewellerName: {
      type: String,
      trim: true,
      maxlength: [100, 'Jeweller name cannot exceed 100 characters'],
    },
    bonusAmount: {
      type: Number,
      required: true,
      default: 0,
      validate: {
        validator: (v: number) => Number.isInteger(v) && v >= 0,
        message: 'Bonus amount must be a non-negative integer in paise',
      },
    },
    bonusRecorded: {
      type: Boolean,
      required: true,
      default: false,
    },
    goldBucketId: {
      type: Schema.Types.ObjectId,
      ref: 'Bucket',
      index: true,
    },
    redeemRecorded: {
      type: Boolean,
      required: true,
      default: false,
    },
    redeemOption: {
      type: String,
      enum: {
        values: ['jewellery', 'cash_refund'],
        message: 'Invalid redeem option: {VALUE}',
      },
    },
    reminderDaysBefore: {
      type: Number,
      required: true,
      default: 3,
      min: [0, 'Reminder days must be between 0 and 7'],
      max: [7, 'Reminder days must be between 0 and 7'],
    },
    visibility: {
      type: String,
      required: true,
      enum: {
        values: ['shared', 'private', 'balance_only'],
        message: 'Invalid visibility: {VALUE}',
      },
      default: 'shared',
    },
    status: {
      type: String,
      required: true,
      enum: {
        values: ['active', 'completed', 'cancelled'],
        message: 'Invalid plan status: {VALUE}',
      },
      default: 'active',
      index: true,
    },
    payoutRecorded: {
      type: Boolean,
      required: true,
      default: false,
    },
    completedAt: {
      type: Date,
    },
  },
  {
    timestamps: true,
  }
);

planSchema.index({ householdId: 1, status: 1 });
planSchema.index({ householdId: 1, ownerId: 1 });
planSchema.index({ householdId: 1, payFromBucketId: 1 });
planSchema.index({ householdId: 1, goldBucketId: 1 });

export const Plan = mongoose.model<IPlan>('Plan', planSchema);
