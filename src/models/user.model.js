import mongoose, { Schema } from "mongoose";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";

const userSchema = new Schema(
    {
        username: {
            type: String,
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
            type: String
        },
        last_name: {
            type: String
        },
        age: {
            type: Number
        },
        weight: {
            type: Number
        },
        height: {
            type: Number
        },
        gender: {
            type: String,
            enum: ["male", "female", "other"]
        },
        blood_group: {
            type: String
        },
        contact_number: {
            type: Number
        },
        profile_image: {
            type: String
        },
        thumbnail_url: {
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
            ref: "Hospital"
        },
        refresh_token: {
            type: String
        },
        isEmailVerified: {
            type: Boolean,
            default: false
        },
        city: {
            type: String
        },
        district: {
            type: String
        },
        fcmToken: {
            type: String
        }
    },
    { timestamps: true }
);

userSchema.pre('save', async function () {
    if (!this.isModified("password")) return;
    this.password = await bcrypt.hash(this.password, 10);
})

userSchema.methods.isPasswordCorrect = async function (password) {
    return await bcrypt.compare(password, this.password);
}

userSchema.methods.generateAccessToken = function () {
    return jwt.sign(
        {
            _id: this._id,
            email: this.email,
            role: "user"
        },
        process.env.ACCESS_TOKEN_SECRET,
        {
            expiresIn: process.env.ACCESS_TOKEN_EXPIRY
        }
    )
}

userSchema.methods.generateRefreshToken = function () {
    return jwt.sign(
        {
            _id: this._id,
        },
        process.env.REFRESH_TOKEN_SECRET,
        {
            expiresIn: process.env.REFRESH_TOKEN_EXPIRY
        }
    )
}

export const User = mongoose.model("User", userSchema);