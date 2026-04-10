import mongoose, { Schema } from "mongoose";

const notificationSchema = new Schema(
    {
        user_id: {
            type: Schema.Types.ObjectId,
            ref: "User",
            required: true
        },
        text: {
            type: String,
            required: true
        },
        date: {
            type: Date,
            default: Date.now,
            required: true
        }
    },
    { timestamps: true }
);

export const Notification = mongoose.model("Notification", notificationSchema);
