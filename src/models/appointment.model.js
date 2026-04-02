import mongoose, { Schema } from "mongoose";
import mongooseAggregatePaginate from "mongoose-aggregate-paginate-v2";

const appointmentSchema = new Schema(
    {
        patient_id: {
            type: Schema.Types.ObjectId,
            ref: "User",
            required: true
        },
        hospital_id: {
            type: Schema.Types.ObjectId,
            ref: "Hospital",
            required: true
        },
        appointment_date: {
            type: Date,
            required: true
        },
        appointment_time: {
            type: String,
            required: true
        },
        token_number: {
            type: Number,
        },
        department: {
            type: String,
            required: true
        },
        patient_name: {
            type: String,
            required: true
        },
        status: {
            type: String,
            enum: ["Pending", "Completed", "Cancelled"],
            default: "Pending"
        }
    },
    { timestamps: true }
);
appointmentSchema.plugin(mongooseAggregatePaginate);

// Compound Unique Index: Prevents duplicate tokens for the exact same hospital/department on the exact same date
appointmentSchema.index({ hospital_id: 1, department: 1, appointment_date: 1, token_number: 1 }, { unique: true });

export const Appointment = mongoose.model("Appointment", appointmentSchema);