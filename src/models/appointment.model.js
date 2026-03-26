import mongoose, { Schema } from "mongoose";

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
    },
    { timestamps: true }
);

export const Appointment = mongoose.model("Appointment", appointmentSchema);