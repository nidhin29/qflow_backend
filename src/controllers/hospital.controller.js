import { asyncHandler } from "../utils/asyncHandler.js";
import { Hospital } from "../models/hospital.model.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { OAuth2Client } from "google-auth-library";
import { sendEmail } from "../utils/sendEmail.js";
import jwt from "jsonwebtoken";

const generateAccessAndRefereshTokens = async (hospitalId) => {
    try {
        const hospital = await Hospital.findById(hospitalId)
        const accessToken = hospital.generateAccessToken()
        const refreshToken = hospital.generateRefreshToken()

        hospital.refresh_token = refreshToken
        await hospital.save({ validateBeforeSave: false })

        return { accessToken, refreshToken }

    } catch (error) {
        throw new ApiError(500, "Something went wrong while generating refresh and access token")
    }
}

const options = {
    httpOnly: true,
    secure: true
}

const registerHospital = asyncHandler(async (req, res) => {
    const { email, password, name } = req.body;

    if ([email, password, name].some((field) => field?.trim() === "")) {
        throw new ApiError(400, "Email, Password and Hospital Name are required");
    }

    const existingHospital = await Hospital.findOne({ email });

    if (existingHospital) {
        throw new ApiError(400, "Hospital already exists with this email");
    }

    const generatedUsername = email.split("@")[0] + Math.floor(Math.random() * 1000);

    const hospital = await Hospital.create({
        email,
        password,
        name,
        username: generatedUsername,
    })

    const createdHospital = await Hospital.findById(hospital._id).select("email _id name")

    if (!createdHospital) {
        throw new ApiError(500, "Something went wrong while registering the hospital");
    }

    return res.status(201)
        .json(
            new ApiResponse(201, "Hospital registered. Please proceed with OTP verification", createdHospital)
        )
})

const sendOtp = asyncHandler(async (req, res) => {
    const { email } = req.body;

    if (!email) {
        throw new ApiError(400, "Hospital email is required");
    }

    const hospital = await Hospital.findOne({ email });

    if (!hospital) {
        throw new ApiError(404, "Hospital not found");
    }

    const otp = Math.floor(100000 + Math.random() * 900000);
    const otpExpiry = new Date(Date.now() + 15 * 60 * 1000);

    hospital.emailVerificationOTP = otp;
    hospital.emailVerificationOTPExpiry = otpExpiry;
    await hospital.save({ validateBeforeSave: false });

    try {
        await sendEmail({
            email: hospital.email,
            subject: "Your Hospital Verification OTP",
            message: `Your verification code for Qflow Hospital account is ${otp}.`
        });
    } catch (error) {
        throw new ApiError(500, "Something went wrong while sending the email. Please try again.");
    }

    return res.status(200).json(
        new ApiResponse(200, "OTP sent successfully to hospital email")
    );
});

const verifyOtp = asyncHandler(async (req, res) => {
    const { email, otp } = req.body;

    if (!email || !otp) {
        throw new ApiError(400, "Hospital email and OTP are required");
    }

    const hospital = await Hospital.findOne({ email });

    if (!hospital) {
        throw new ApiError(404, "Hospital not found");
    }

    if (hospital.emailVerificationOTP !== Number(otp)) {
        throw new ApiError(400, "Invalid OTP");
    }

    if (hospital.emailVerificationOTPExpiry < Date.now()) {
        throw new ApiError(400, "OTP has expired. Please request a new one.");
    }

    hospital.isEmailVerified = true;
    hospital.emailVerificationOTP = undefined;
    hospital.emailVerificationOTPExpiry = undefined;

    await hospital.save({ validateBeforeSave: false });

    const { accessToken, refreshToken } = await generateAccessAndRefereshTokens(hospital._id);

    return res.status(200)
        .cookie("accessToken", accessToken, options)
        .cookie("refreshToken", refreshToken, options)
        .json(
            new ApiResponse(200, "Hospital email verified successfully!", {
                hospital: {
                    email: hospital.email,
                    name: hospital.name,
                    isEmailVerified: hospital.isEmailVerified
                },
                accessToken,
                refreshToken
            })
        );
});

const loginHospital = asyncHandler(async (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
        throw new ApiError(400, "Email and Password are required");
    }

    const hospital = await Hospital.findOne({ email });

    if (!hospital) {
        throw new ApiError(404, "Hospital not found");
    }

    const isPasswordCorrect = await hospital.isPasswordCorrect(password);

    if (!isPasswordCorrect) {
        throw new ApiError(401, "Invalid password");
    }

    const { accessToken, refreshToken } = await generateAccessAndRefereshTokens(hospital._id)

    return res.status(200)
        .cookie("accessToken", accessToken, options)
        .cookie("refreshToken", refreshToken, options)
        .json(
            new ApiResponse(200, "Hospital logged in successfully", {
                hospital: {
                    _id: hospital._id,
                    email: hospital.email,
                    name: hospital.name
                },
                accessToken,
                refreshToken
            })
        )
})

const registerHospitalDetails = asyncHandler(async (req, res) => {
    const hospital = req.user; // Assuming verifyJWT middleware is used

    const {
        city,
        district,
        receptionist_name,
        receptionist_contact_number,
        available_services
    } = req.body;

    if (!hospital) {
        throw new ApiError(404, "Hospital not found");
    }

    // Update fields
    hospital.city = city;
    hospital.district = district;
    hospital.receptionist_name = receptionist_name;
    hospital.receptionist_contact_number = receptionist_contact_number;
    hospital.available_services = available_services;

    await hospital.save();

    return res.status(200)
        .json(
            new ApiResponse(200, "Hospital details registered successfully", {
                hospital: {
                    _id: hospital._id,
                    name: hospital.name,
                    city: hospital.city
                }
            })
        )
})

const refreshAccessToken = asyncHandler(async (req, res) => {
    const incomingRefreshToken = req.cookies.refreshToken || req.body.refreshToken;

    if (!incomingRefreshToken) {
        throw new ApiError(401, "No refresh token found");
    }

    try {
        const decodedToken = jwt.verify(incomingRefreshToken, process.env.REFRESH_TOKEN_SECRET);

        const hospital = await Hospital.findById(decodedToken._id);

        if (!hospital) {
            throw new ApiError(401, "Invalid refresh token");
        }

        if (incomingRefreshToken !== hospital.refresh_token) {
            throw new ApiError(401, "Refresh token is expired or used");
        }

        const { accessToken, refreshToken: newRefreshToken } = await generateAccessAndRefereshTokens(hospital._id);

        return res
            .status(200)
            .cookie("accessToken", accessToken, options)
            .cookie("refreshToken", newRefreshToken, options)
            .json(
                new ApiResponse(
                    200,
                    "Access token refreshed successfully",
                    { accessToken, refreshToken: newRefreshToken }
                )
            );
    } catch (error) {
        throw new ApiError(401, error?.message || "Invalid refresh token");
    }
});

const googleLogin = asyncHandler(async (req, res) => {
    const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID_WEB);
    const { tokenID } = req.body;

    const ticket = await client.verifyIdToken({
        idToken: tokenID,
        audience: [
            process.env.GOOGLE_CLIENT_ID_WEB,
            process.env.GOOGLE_CLIENT_ID_APP,
        ]
    });

    const payload = ticket.getPayload();
    const { email, name } = payload;

    const existingHospital = await Hospital.findOne({ email });

    if (existingHospital) {
        const { accessToken, refreshToken } = await generateAccessAndRefereshTokens(existingHospital._id)
        return res.status(200)
            .cookie("accessToken", accessToken, options)
            .cookie("refreshToken", refreshToken, options)
            .json(new ApiResponse(200, "Hospital logged in via Google", { hospital: existingHospital, accessToken, refreshToken }))
    } else {
        const hospital = await Hospital.create({
            email,
            name,
            password: Math.random().toString(36).slice(-10),
            username: email.split("@")[0] + Math.floor(Math.random() * 1000)
        })
        const { accessToken, refreshToken } = await generateAccessAndRefereshTokens(hospital._id)
        return res.status(201)
            .cookie("accessToken", accessToken, options)
            .cookie("refreshToken", refreshToken, options)
            .json(new ApiResponse(201, "Hospital registered via Google", { hospital, accessToken, refreshToken }))
    }
})

const forgotPassword = asyncHandler(async (req, res) => {

    const { email } = req.body;

    if (!email) {
        throw new ApiError(400, "email is required");
    }

    const hospital = await Hospital.findOne({ email });

    if (!hospital) {
        throw new ApiError(400, "not a valid hospital");
    }

    // Generate 6-digit OTP and set expiry (15 minutes)
    const otp = Math.floor(100000 + Math.random() * 900000);
    const otpExpiry = new Date(Date.now() + 15 * 60 * 1000);

    // Save OTP and Expiry to the user in the database
    hospital.emailVerificationOTP = otp;
    hospital.emailVerificationOTPExpiry = otpExpiry;
    await hospital.save({ validateBeforeSave: false });

    // Send the email
    try {
        await sendEmail({
            email: hospital.email,
            subject: "Your Qflow Verification OTP",
            message: `Your verification code is ${otp}. It will expire in 15 minutes.`
        });
    } catch (error) {
        throw new ApiError(500, "Something went wrong while sending the email. Please try again.");
    }

    return res.status(200).json(
        new ApiResponse(200, "OTP sent successfully to your email", { email: hospital.email })
    );
})

const resetPassword = asyncHandler(async (req, res) => {
    const { email, otp, newPassword } = req.body;

    if (!email || !otp || !newPassword) {
        throw new ApiError(400, "Email, OTP and New Password are required");
    }

    const hospital = await Hospital.findOne({ email });

    if (!hospital) {
        throw new ApiError(404, "Hospital not found");
    }

    if (hospital.emailVerificationOTP !== Number(otp)) {
        throw new ApiError(400, "Invalid OTP");
    }

    if (hospital.emailVerificationOTPExpiry < Date.now()) {
        throw new ApiError(400, "OTP has expired. Please request a new one.");
    }

    hospital.password = newPassword;
    hospital.emailVerificationOTP = undefined;
    hospital.emailVerificationOTPExpiry = undefined;

    const { accessToken, refreshToken } = await generateAccessAndRefereshTokens(hospital._id);

    hospital.refresh_token = refreshToken;

    await hospital.save();

    return res
        .status(200)
        .cookie("accessToken", accessToken, options)
        .cookie("refreshToken", refreshToken, options)
        .json(
            new ApiResponse(
                200,
                "Hospital password reset successfully! You are now logged in.",
                { hospital: { email: hospital.email, name: hospital.name }, accessToken, refreshToken }
            )
        );
});


const logoutHospital = asyncHandler(async (req, res) => {
    await Hospital.findByIdAndUpdate(
        req.user._id,
        {
            $set: {
                refresh_token: undefined
            }
        },
        {
            new: true
        }
    )

    const logoutOptions = {
        httpOnly: true,
        secure: true
    }

    return res
        .status(200)
        .clearCookie("accessToken", logoutOptions)
        .clearCookie("refreshToken", logoutOptions)
        .json(new ApiResponse(200, "Hospital logged out successfully"))
})


export {
    registerHospital,
    sendOtp,
    verifyOtp,
    loginHospital,
    registerHospitalDetails,
    refreshAccessToken,
    googleLogin,
    forgotPassword,
    resetPassword,
    logoutHospital
}
