import mongoose, { Schema } from "mongoose";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";

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

userSchema.pre('save', async function(next) {

    if(!this.isModified("password")) return next();

    this.password = await bcrypt.hash(this.password,10);
    return next();
})

userSchema.methods.isPasswordCorrect = async function(password){
    return await bcrypt.compare(password,this.password);
}

userSchema.methods.generateAccessToken = function(){
    return jwt.sign(
        {
            _id: this._id,
            email: this.email,
            username: this.username,
            first_name: this.first_name,
            last_name: this.last_name
        },
        process.env.ACCESS_TOKEN_SECRET,
        {
            expiresIn: process.env.ACCESS_TOKEN_EXPIRY
        }
    )
}

userSchema.methods.generateRefreshToken = function(){
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