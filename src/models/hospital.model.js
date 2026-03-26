import mongoose, { Schema } from "mongoose";
import mongooseAggregatePaginate from "mongoose-aggregate-paginate-v2";

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
        rating: {
            type: Number,
            required: true
        },
    },
    { timestamps: true }
);

hospitalSchema.plugin(mongooseAggregatePaginate);

export const Hospital = mongoose.model("Hospital", hospitalSchema);