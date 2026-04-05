import { asyncHandler } from "../utils/asyncHandler.js";
import { User } from "../models/user.model.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { OAuth2Client } from "google-auth-library";
import { sendEmail } from "../utils/sendEmail.js";
import jwt from "jsonwebtoken";
import { redisClient } from "../db/redis.js";
import { uploadImageWithThumbnailToS3, deleteFileFromS3 } from "../utils/s3.js";

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

    // Store registration data in Redis with 15-minute TTL
    const registrationData = {
        email,
        password,
        username: generatedUsername,
    };

    try {
        await redisClient.setEx(
            `signup:data:${email}`,
            900,
            JSON.stringify(registrationData)
        );
    } catch (error) {
        throw new ApiError(500, "Failed to initialize registration. Please try again.");
    }


    return res.status(200)
        .json(
            new ApiResponse(200, "Registration initiated. Please verify the OTP sent to your email.", { email })
        )
})

export { registerUser }


const sendOtp = asyncHandler(async (req, res) => {
    const { email } = req.body;

    if (!email) {
        throw new ApiError(400, "Email is required");
    }

    // Generate 6-digit OTP
    const otp = Math.floor(100000 + Math.random() * 900000);

    // Save OTP to Redis with a 15-minute (900 seconds) expiration
    try {
        await redisClient.setEx(`otp:user:${email}`, 900, otp.toString());
    } catch (error) {
        throw new ApiError(500, "Failed to generate OTP securely. Please try again.");
    }

    // Send the email
    try {
        await sendEmail({
            email: email,
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

    // Verify OTP against Redis Cache
    const cachedOtp = await redisClient.get(`otp:user:${email}`);
    if (!cachedOtp) {
        throw new ApiError(400, "OTP has expired or does not exist. Please request a new one.");
    }
    if (cachedOtp !== otp.toString()) {
        throw new ApiError(400, "Invalid OTP");
    }

    let user = await User.findOne({ email });

    if (!user) {
        // Check if there is pending registration data in Redis
        const pendingUserData = await redisClient.get(`signup:data:${email}`);
        if (!pendingUserData) {
            throw new ApiError(400, "Registration session expired. Please register again.");
        }

        const { password, username } = JSON.parse(pendingUserData);

        // Create the user in MongoDB
        user = await User.create({
            email: email,
            password,
            username,
            isEmailVerified: true
        });

        // Clean up pending registration data
        await redisClient.del(`signup:data:${email}`);
    }

    // Generate tokens
    const { accessToken, refreshToken } = await generateAccessAndRefereshTokens(user._id);

    return res.status(200)
        .cookie("accessToken", accessToken, options)
        .cookie("refreshToken", refreshToken, options)
        .json(
            new ApiResponse(200, "Email verified successfully!", {
                user: {
                    _id: user._id,
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
        || !existingUser.contact_number)) {

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

    if (!user.first_name || !user.last_name ||
        !user.age || !user.weight ||
        !user.height || !user.gender ||
        !user.blood_group || !user.contact_number) {

        return res.status(201)
            .cookie("accessToken", accessToken, options)
            .cookie("refreshToken", refreshToken, options)
            .json(
                new ApiResponse(201, "User logged in successfully but profile is incomplete", {
                    user: {
                        _id: user._id,
                        email: user.email,
                        username: user.username
                    },
                    accessToken,
                    refreshToken
                })
            )
    }

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

    if (req.file) {
        const { imageUrl, thumbnailUrl } = await uploadImageWithThumbnailToS3(
            req.file.buffer,
            req.file.originalname,
            "users/profiles",
            req.file.mimetype
        );
        user.profile_image = imageUrl;
        user.thumbnail_url = thumbnailUrl;
    }

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

    // Generate 6-digit OTP
    const otp = Math.floor(100000 + Math.random() * 900000);

    // Save OTP to Redis with a 15-minute (900 seconds) expiration
    try {
        await redisClient.setEx(`otp:user:${email}`, 900, otp.toString());
    } catch (error) {
        throw new ApiError(500, "Failed to process OTP request. Please try again.");
    }

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

    // Verify OTP against Redis Cache
    const cachedOtp = await redisClient.get(`otp:user:${email}`);
    if (!cachedOtp) {
        throw new ApiError(400, "OTP has expired or does not exist. Please request a new one.");
    }
    if (cachedOtp !== otp.toString()) {
        throw new ApiError(400, "Invalid OTP");
    }

    // Update password and clean up Redis
    user.password = newPassword;
    await redisClient.del(`otp:user:${email}`);

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
        { returnDocument: 'after' }
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


const updateUserDetails = asyncHandler(async (req, res) => {

    const { first_name, last_name, age, weight, height, gender, blood_group, contact_number } = req.body;

    // Build the update object dynamically (only update fields that are provided)
    const updateFields = {};
    if (first_name) updateFields.first_name = first_name;
    if (last_name) updateFields.last_name = last_name;
    if (age) updateFields.age = age;
    if (weight) updateFields.weight = weight;
    if (height) updateFields.height = height;
    if (gender) updateFields.gender = gender;
    if (blood_group) updateFields.blood_group = blood_group;
    if (contact_number) updateFields.contact_number = contact_number;

    if (req.file) {
        // 1. Fetch current user to get old image URLs for deletion
        const currentUser = await User.findById(req.user._id);
        if (currentUser.profile_image) {
            await deleteFileFromS3(currentUser.profile_image);
        }
        if (currentUser.thumbnail_url) {
            await deleteFileFromS3(currentUser.thumbnail_url);
        }

        // 2. Upload new images to generic folder
        const { imageUrl, thumbnailUrl } = await uploadImageWithThumbnailToS3(
            req.file.buffer,
            req.file.originalname,
            "users/profiles",
            req.file.mimetype
        );
        updateFields.profile_image = imageUrl;
        updateFields.thumbnail_url = thumbnailUrl;
    }

    const updatedUser = await User.findByIdAndUpdate(
        req.user._id,
        {
            $set: updateFields
        },
        {
            returnDocument: 'after'
        }
    );

    if (!updatedUser) {
        throw new ApiError(404, "User not found");
    }

    return res.status(200).json(
        new ApiResponse(200, "User details updated successfully")
    );
});

export { updateUserDetails }

const getUserDetails = asyncHandler(async (req, res) => {
    const user = await User.findById(req.user._id);

    if (!user) {
        throw new ApiError(404, "User not found");
    }

    return res.status(200).json(
        new ApiResponse(200, "User details fetched successfully", {
            user: {
                email: user.email,
                username: user.username,
                first_name: user.first_name,
                last_name: user.last_name,
                age: user.age,
                weight: user.weight,
                height: user.height,
                gender: user.gender,
                blood_group: user.blood_group,
                contact_number: user.contact_number,
                profile_image: user.profile_image,
                thumbnail_url: user.thumbnail_url
            }
        })
    );
});

export { getUserDetails }
