import mongoose, { Document, Schema, Types } from 'mongoose';

export interface IPlanDismissal extends Document {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  planId: Types.ObjectId;
  dateString: string; // 'YYYY-MM-DD' in Asia/Kolkata
  createdAt: Date;
}

const planDismissalSchema = new Schema<IPlanDismissal>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    planId: {
      type: Schema.Types.ObjectId,
      ref: 'Plan',
      required: true,
      index: true,
    },
    dateString: {
      type: String,
      required: true,
      index: true,
    },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
  }
);

// One dismissal per user per plan per calendar day
planDismissalSchema.index({ userId: 1, planId: 1, dateString: 1 }, { unique: true });

export const PlanDismissal = mongoose.model<IPlanDismissal>(
  'PlanDismissal',
  planDismissalSchema
);
