import mongoose, { Schema } from "mongoose";

const hospitalSchema = new Schema(
    {
        name: {
            type: String,
            required: true
        },
        city: {
            type: String,
            required: true
        },
        district: {
            type: String,
            required: true
        },
        profile_image: {
            type: String,
            required: true
        },
        receptionist_name: {
            type: String,
            required: true
        },
        receptionist_contact_number: {
            type: Number,
            required: true
        },
        receptionist_image: {
            type: String,
            required: true
        },
        available_services: {
            type: [String],
            required: true
        },
        appointments: {
            type: [Schema.Types.ObjectId],
            ref: "Appointment"
        },
        is_recommended: {
            type: Boolean,
            default: false
        }
    },
    { timestamps: true }
);

export const Hospital = mongoose.model("Hospital", hospitalSchema);