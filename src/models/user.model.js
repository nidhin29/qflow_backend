import mongoose, { Schema } from "mongoose";

const userSchema = new Schema(
    {
        username: {
            type: String,
            required: true,
            unique: true,
            lowercase: true,
            trim: true
        },
        email: {
            type: String,
            required: true,
            unique: true,
            lowercase: true,
            trim: true
        },
        password: {
            type: String,
            required: true
        },
        first_name: {
            type: String,
            required: true
        },
        last_name: {
            type: String,
            required: true
        },
        age: {
            type: Number,
            required: true
        },
        weight: {
            type: Number,
            required: true
        },
        height: {
            type: Number,
            required: true
        },
        gender: {
            type: String,
            enum: ["male", "female", "other"],
            required: true
        },
        blood_group: {
            type: String,
            required: true
        }, 
        contact_number: {
            type: Number,
            required: true
        },
        profile_image: {
            type: String
        },
        appointments: {
            type: [Schema.Types.ObjectId],
            ref: "Appointment"
        },
        members: {
            type: [Schema.Types.ObjectId],
            ref: "Member"
        },
        previously_visited: {
            type: [Schema.Types.ObjectId],
            ref:"Hospital"
        }
    },
    { timestamps: true }
);

export const User = mongoose.model("User", userSchema);