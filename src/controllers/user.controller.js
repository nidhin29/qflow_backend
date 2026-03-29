import { asyncHandler } from "../utils/asyncHandler.js";
import { User } from "../models/user.model.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { OAuth2Client } from "google-auth-library";
import { sendEmail } from "../utils/sendEmail.js";
import jwt from "jsonwebtoken"

const generateAccessAndRefereshTokens = async (userId) => {
    try {
        const user = await User.findById(userId)
        const accessToken = user.generateAccessToken()
        const refreshToken = user.generateRefreshToken()

        user.refresh_token = refreshToken
        await user.save({ validateBeforeSave: false })

        return { accessToken, refreshToken }


    } catch (error) {
        throw new ApiError(500, "Something went wrong while generating referesh and access token")
    }
}

const options = {
    httpOnly: true,
    secure: true
}


const registerUser = asyncHandler(async (req, res) => {

    const { email, password } = req.body;

    if (!email || !password) {
        throw new ApiError(400, "Email and Password are required");
    }

    const existingUser = await User.findOne({ email });

    if (existingUser) {
        throw new ApiError(400, "User already exists with this email");
    }

    const generatedUsername = email.split("@")[0] + Math.floor(Math.random() * 1000);

    const user = await User.create({
        email,
        password,
        username: generatedUsername,
    })

    const createdUser = await User.findById(user._id).select("email _id")

    if (!createdUser) {
        throw new ApiError(500, "Something went wrong while registering the user");
    }

    return res.status(201)
        .json(
            new ApiResponse(201, "User registered. Please proceed with OTP verification", createdUser)
        )

})

export { registerUser }


const sendOtp = asyncHandler(async (req, res) => {
    const { email } = req.body;

    if (!email) {
        throw new ApiError(400, "User ID is required");
    }

    const user = await User.findOne({ email });

    if (!user) {
        throw new ApiError(404, "User not found");
    }

    // Generate 6-digit OTP and set expiry (15 minutes)
    const otp = Math.floor(100000 + Math.random() * 900000);
    const otpExpiry = new Date(Date.now() + 15 * 60 * 1000);

    // Save OTP and Expiry to the user in the database
    user.emailVerificationOTP = otp;
    user.emailVerificationOTPExpiry = otpExpiry;
    await user.save({ validateBeforeSave: false });

    // Send the email
    try {
        await sendEmail({
            email: user.email,
            subject: "Your Qflow Verification OTP",
            message: `Your verification code is ${otp}. It will expire in 15 minutes.`
        });
    } catch (error) {
        throw new ApiError(500, "Something went wrong while sending the email. Please try again.");
    }

    return res.status(200).json(
        new ApiResponse(200, "OTP sent successfully to your email")
    );
});

export { sendOtp }


const verifyOtp = asyncHandler(async (req, res) => {
    const { email, otp } = req.body;

    if (!email || !otp) {
        throw new ApiError(400, "Email and OTP are required");
    }

    const user = await User.findOne({ email });

    if (!user) {
        throw new ApiError(404, "User not found");
    }

    // Check if OTP matches
    if (user.emailVerificationOTP !== Number(otp)) {
        throw new ApiError(400, "Invalid OTP");
    }

    // Check if OTP is expired
    if (user.emailVerificationOTPExpiry < Date.now()) {
        throw new ApiError(400, "OTP has expired. Please request a new one.");
    }

    // Verify user and clear OTP fields
    user.isEmailVerified = true;
    user.emailVerificationOTP = undefined;
    user.emailVerificationOTPExpiry = undefined;

    await user.save({ validateBeforeSave: false });

    // Generate tokens so user is logged in immediately after verification
    const { accessToken, refreshToken } = await generateAccessAndRefereshTokens(user._id);

    return res.status(200)
        .cookie("accessToken", accessToken, options)
        .cookie("refreshToken", refreshToken, options)
        .json(
            new ApiResponse(200, "Email verified successfully!", {
                user: {
                    email: user.email,
                    username: user.username,
                    isEmailVerified: user.isEmailVerified
                },
                accessToken,
                refreshToken
            })
        );
});

export { verifyOtp }


const googleLogin = asyncHandler(async (req, res) => {
    const client = new OAuth2Client(
        process.env.GOOGLE_CLIENT_ID_WEB
    );

    const { tokenID } = req.body;

    const ticket = await client.verifyIdToken({
        idToken: tokenID,
        audience: [
            process.env.GOOGLE_CLIENT_ID_WEB,
            process.env.GOOGLE_CLIENT_ID_APP,
        ]
    });

    const payload = ticket.getPayload();

    const { email } = payload;

    const existingUser = await User.findOne({ email });

    if (existingUser && (!existingUser.first_name ||
        !existingUser.last_name || !existingUser.age ||
        !existingUser.weight || !existingUser.height ||
        !existingUser.gender || !existingUser.blood_group
        || !existingUser.contact_number ||
        !existingUser.profile_image)) {

        const userData = {
            _id: existingUser._id,
            email: existingUser.email,
            username: existingUser.username
        };

        const { accessToken, refreshToken } = await generateAccessAndRefereshTokens(existingUser._id)

        return res.status(201)
            .cookie("accessToken", accessToken, options)
            .cookie("refreshToken", refreshToken, options)
            .json(
                new ApiResponse(201, "User already exists and needs to complete profile", {
                    user: userData,
                    accessToken,
                    refreshToken
                })
            )
    }
    else if (existingUser) {
        const userData = {
            _id: existingUser._id,
            email: existingUser.email,
            username: existingUser.username
        };

        const { accessToken, refreshToken } = await generateAccessAndRefereshTokens(existingUser._id)


        return res.status(200)
            .cookie("accessToken", accessToken, options)
            .cookie("refreshToken", refreshToken, options)
            .json(
                new ApiResponse(200, "User already exists", {
                    user: userData,
                    accessToken,
                    refreshToken
                })
            )
    }
    else {

        const generatedUsername = email.split("@")[0] + Math.floor(Math.random() * 1000);

        const user = await User.create({
            email,
            username: generatedUsername,
            password: Math.random().toString(36).slice(-10)
        })

        const createdUser = await User.findById(user._id).select("email username _id");

        const { accessToken, refreshToken } = await generateAccessAndRefereshTokens(user._id)


        if (!createdUser) {
            throw new ApiError(500, "Something went wrong while registering user via Google");
        }


        return res.status(201)
            .cookie("accessToken", accessToken, options)
            .cookie("refreshToken", refreshToken, options)
            .json(
                new ApiResponse(201, "User registered successfully", {
                    user: createdUser,
                    accessToken,
                    refreshToken
                })
            )
    }
})


export { googleLogin }


const loginUser = asyncHandler(async (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
        throw new ApiError(400, "Email and Password are required");
    }

    const user = await User.findOne({ email });

    if (!user) {
        throw new ApiError(404, "User not found");
    }

    const isPasswordCorrect = await user.isPasswordCorrect(password);

    if (!isPasswordCorrect) {
        throw new ApiError(401, "Invalid password");
    }

    const { accessToken, refreshToken } = await generateAccessAndRefereshTokens(user._id)

    return res.status(200)
        .cookie("accessToken", accessToken, options)
        .cookie("refreshToken", refreshToken, options)
        .json(
            new ApiResponse(200, "User logged in successfully", {
                user: {
                    _id: user._id,
                    email: user.email,
                    username: user.username
                },
                accessToken,
                refreshToken
            })
        )
})

export { loginUser }


const registerUserDetails = asyncHandler(async (req, res) => {
    const user = req.user;

    const { username, first_name, last_name, age, weight, height, gender, blood_group, contact_number } = req.body;


    if (!username || !first_name || !last_name || !age || !weight || !height || !gender || !blood_group || !contact_number) {
        throw new ApiError(400, "All fields are required");
    }

    if (!user) {
        throw new ApiError(404, "User not found");
    }

    const existingUserWithUsername = await User.findOne({ username });

    if (existingUserWithUsername && existingUserWithUsername._id.toString() !== user._id.toString()) {
        throw new ApiError(400, "Username is already taken");
    }

    user.username = username;
    user.first_name = first_name;
    user.last_name = last_name;
    user.age = age;
    user.weight = weight;
    user.height = height;
    user.gender = gender;
    user.blood_group = blood_group;
    user.contact_number = contact_number;

    await user.save();

    return res.status(200)
        .json(
            new ApiResponse(200, "User details registered successfully", {
                user: {
                    _id: user._id,
                    email: user.email,
                    username: user.username
                }
            })
        )
})

export { registerUserDetails }


const refreshAccessToken = asyncHandler(async (req, res) => {
    const incomingRefreshToken = req.cookies.refreshToken || req.body.refreshToken;

    if (!incomingRefreshToken) {
        throw new ApiError(401, "No refresh token found");
    }

    try {
        const decodedToken = jwt.verify(incomingRefreshToken, process.env.REFRESH_TOKEN_SECRET);

        const user = await User.findById(decodedToken._id);

        if (!user) {
            throw new ApiError(401, "Invalid refresh token");
        }

        if (incomingRefreshToken !== user.refresh_token) {
            throw new ApiError(401, "Refresh token is expired or used");
        }

        const { accessToken, refreshToken: newRefreshToken } = await generateAccessAndRefereshTokens(user._id);

        user.refresh_token = newRefreshToken;
        await user.save({ validateBeforeSave: false });

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


export { refreshAccessToken }

const forgotPassword = asyncHandler(async (req, res) => {

    const { email } = req.body;

    if (!email) {
        throw new ApiError(400, "email is required");
    }

    const user = await User.findOne({ email });

    if (!user) {
        throw new ApiError(400, "not a valid user");
    }

    // Generate 6-digit OTP and set expiry (15 minutes)
    const otp = Math.floor(100000 + Math.random() * 900000);
    const otpExpiry = new Date(Date.now() + 15 * 60 * 1000);

    // Save OTP and Expiry to the user in the database
    user.emailVerificationOTP = otp;
    user.emailVerificationOTPExpiry = otpExpiry;
    await user.save({ validateBeforeSave: false });

    // Send the email
    try {
        await sendEmail({
            email: user.email,
            subject: "Your Qflow Verification OTP",
            message: `Your verification code is ${otp}. It will expire in 15 minutes.`
        });
    } catch (error) {
        throw new ApiError(500, "Something went wrong while sending the email. Please try again.");
    }

    return res.status(200).json(
        new ApiResponse(200, "OTP sent successfully to your email", user.email)
    );
})

export { forgotPassword }

const resetPassword = asyncHandler(async (req, res) => {
    const { email, otp, newPassword } = req.body;

    if (!email || !otp || !newPassword) {
        throw new ApiError(400, "Email, OTP and New Password are required");
    }

    const user = await User.findOne({ email });

    if (!user) {
        throw new ApiError(404, "User not found");
    }

    if (user.emailVerificationOTP !== Number(otp)) {
        throw new ApiError(400, "Invalid OTP");
    }

    if (user.emailVerificationOTPExpiry < Date.now()) {
        throw new ApiError(400, "OTP has expired. Please request a new one.");
    }

    user.password = newPassword;
    user.emailVerificationOTP = undefined;
    user.emailVerificationOTPExpiry = undefined;

    const { accessToken, refreshToken } = await generateAccessAndRefereshTokens(user._id);

    user.refresh_token = refreshToken;

    await user.save();

    return res
        .status(200)
        .cookie("accessToken", accessToken, options)
        .cookie("refreshToken", refreshToken, options)
        .json(
            new ApiResponse(
                200,
                "Password reset successfully! You can now login.",
                { user: { email: user.email, username: user.username }, accessToken, refreshToken }
            )
        );

});

export { resetPassword }


const logoutUser = asyncHandler(async (req, res) => {
    await User.findByIdAndUpdate(
        req.user._id,
        {
            $set: {
                refresh_token: undefined
            }
        },
        { new: true }
    )

    const logoutOptions = {
        httpOnly: true,
        secure: true
    }

    return res
        .status(200)
        .clearCookie("accessToken", logoutOptions)
        .clearCookie("refreshToken", logoutOptions)
        .json(new ApiResponse(200, "User logged out successfully"))
})

export { logoutUser }
