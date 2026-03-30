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
    },
    { timestamps: true }
);

appointmentSchema.plugin(mongooseAggregatePaginate);

export const Appointment = mongoose.model("Appointment", appointmentSchema);