import bcrypt from "bcrypt";
import mongoose, { Schema } from "mongoose";
import mongooseAggregatePaginate from "mongoose-aggregate-paginate-v2";
import jwt from "jsonwebtoken";

const hospitalSchema = new Schema(
    {
        email: {
            type: String,
            required: true,
            unique: true,
            trim: true,
            lowercase: true
        },
        password: {
            type: String,
            required: [true, 'Password is required']
        },
        username: {
            type: String,
            unique: true,
            trim: true,
            lowercase: true
        },
        name: {
            type: String,
            required: true
        },
        city: {
            type: String,
        },
        district: {
            type: String,
        },
        profile_image: {
            type: String,
        },
        thumbnail_url: {
            type: String,
        },
        receptionist_name: {
            type: String,
        },
        receptionist_contact_number: {
            type: Number,
        },
        receptionist_image: {
            type: String,
        },
        available_services: {
            type: [String],
        },
        appointments: {
            type: [Schema.Types.ObjectId],
            ref: "Appointment"
        },
        rating: {
            type: Number,
            default: 0
        },
        is_recommended: {
            type: Boolean,
            default: false
        },
        average_consultation_time: {
            type: Number,
            default: 10
        },
        opening_time: {
            type: String,
            default: "09:00 AM"
        },
        closing_time: {
            type: String,
            default: "05:00 PM"
        },
        slot_duration: {
            type: Number,
            default: 60
        },
        max_patients_per_slot: {
            type: Number,
            default: 4
        },
        refresh_token: {
            type: String
        },
        isEmailVerified: {
            type: Boolean,
            default: false
        }
    },
    { timestamps: true }
);

hospitalSchema.pre("save", async function (next) {
    if (!this.isModified("password")) return;
    this.password = await bcrypt.hash(this.password, 10);

});

hospitalSchema.methods.isPasswordCorrect = async function (password) {
    return await bcrypt.compare(password, this.password);
};

hospitalSchema.methods.generateAccessToken = function () {
    return jwt.sign(
        {
            _id: this._id,
            email: this.email,
            username: this.username,
            name: this.name,
            role: "hospital"
        },
        process.env.ACCESS_TOKEN_SECRET,
        {
            expiresIn: process.env.ACCESS_TOKEN_EXPIRY
        }
    );
};

hospitalSchema.methods.generateRefreshToken = function () {
    return jwt.sign(
        {
            _id: this._id,
        },
        process.env.REFRESH_TOKEN_SECRET,
        {
            expiresIn: process.env.REFRESH_TOKEN_EXPIRY
        }
    );
};

hospitalSchema.plugin(mongooseAggregatePaginate);

export const Hospital = mongoose.model("Hospital", hospitalSchema);