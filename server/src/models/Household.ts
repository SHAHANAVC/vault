import { Schema, model, Document, Types } from 'mongoose';

/**
 * Household Model
 * Represents the shared financial unit.
 * Invariant: At most 2 members per household (partner finance model).
 * Note: Household is strictly a backend grouping concept and is NEVER exposed in the UI.
 */
export interface IHousehold extends Document {
  members: Types.ObjectId[];
  createdAt: Date;
  updatedAt: Date;
}

const householdSchema = new Schema<IHousehold>(
  {
    members: {
      type: [
        {
          type: Schema.Types.ObjectId,
          ref: 'User',
          required: true,
        },
      ],
      validate: [
        {
          validator: function (val: Types.ObjectId[]) {
            return !val || val.length <= 2;
          },
          message: 'A household cannot have more than 2 members',
        },
      ],
    },
  },
  {
    timestamps: true,
  }
);

householdSchema.pre('validate', function () {
  if (this.members && this.members.length > 2) {
    throw new Error('A household cannot have more than 2 members');
  }
});

export const Household = model<IHousehold>('Household', householdSchema);
