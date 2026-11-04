import mongoose, { Document, Schema, Types } from 'mongoose';

export interface ILoanDismissal extends Document {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  alertId: string; // Typically transactionId or partyId
  dateString: string; // 'YYYY-MM-DD' in Asia/Kolkata
  createdAt: Date;
}

const loanDismissalSchema = new Schema<ILoanDismissal>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    alertId: {
      type: String,
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

// One dismissal per user per loan alert per calendar day
loanDismissalSchema.index({ userId: 1, alertId: 1, dateString: 1 }, { unique: true });

export const LoanDismissal = mongoose.model<ILoanDismissal>(
  'LoanDismissal',
  loanDismissalSchema
);
