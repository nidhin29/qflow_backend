import { asyncHandler } from "../utils/asyncHandler.js";
import { Hospital } from "../models/hospital.model.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { OAuth2Client } from "google-auth-library";
import { sendEmail } from "../utils/sendEmail.js";
import jwt from "jsonwebtoken";
import { redisClient } from "../db/redis.js";
import { uploadImageWithThumbnailToS3, deleteFileFromS3 } from "../utils/s3.js";

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

    // Store registration data in Redis with 15-minute TTL
    const registrationData = {
        email,
        password,
        name,
        username: generatedUsername,
    };

    try {
        await redisClient.setEx(
            `signup:hospital:data:${email}`,
            900,
            JSON.stringify(registrationData)
        );
    } catch (error) {
        throw new ApiError(500, "Failed to initialize registration. Please try again.");
    }

    return res.status(200)
        .json(
            new ApiResponse(200, "Hospital registration initiated. Please verify the OTP sent to your email.", { email })
        )
})

export { registerHospital }

const sendOtp = asyncHandler(async (req, res) => {
    const { email } = req.body;

    if (!email) {
        throw new ApiError(400, "Hospital email is required");
    }

    const otp = Math.floor(100000 + Math.random() * 900000);

    // Save OTP to Redis with a 15-minute (900 seconds) expiration
    try {
        await redisClient.setEx(`otp:hospital:${email}`, 900, otp.toString());
    } catch (error) {
        throw new ApiError(500, "Failed to generate OTP securely. Please try again.");
    }

    try {
        await sendEmail({
            email: email,
            subject: "Your Hospital Verification OTP",
            message: `Your verification code for Qflow Hospital account is ${otp}. It will expire in 15 minutes.`
        });
    } catch (error) {
        throw new ApiError(500, "Something went wrong while sending the email. Please try again.");
    }

    return res.status(200).json(
        new ApiResponse(200, "OTP sent successfully to hospital email")
    );
});

export { sendOtp }

const verifyOtp = asyncHandler(async (req, res) => {
    const { email, otp } = req.body;

    if (!email || !otp) {
        throw new ApiError(400, "Hospital email and OTP are required");
    }

    // Verify OTP against Redis Cache
    const cachedOtp = await redisClient.get(`otp:hospital:${email}`);
    if (!cachedOtp) {
        throw new ApiError(400, "OTP has expired or does not exist. Please request a new one.");
    }
    if (cachedOtp !== otp.toString()) {
        throw new ApiError(400, "Invalid OTP");
    }

    let hospital = await Hospital.findOne({ email });

    if (!hospital) {
        // Check for pending registration
        const pendingHospitalData = await redisClient.get(`signup:hospital:data:${email}`);
        if (!pendingHospitalData) {
            throw new ApiError(400, "Registration session expired. Please register again.");
        }

        const { password, name, username } = JSON.parse(pendingHospitalData);

        // Create the hospital in MongoDB
        hospital = await Hospital.create({
            email: email,
            password,
            name,
            username,
            isEmailVerified: true
        });

        // Clean up pending registration data
        await redisClient.del(`signup:hospital:data:${email}`);
    }

    const { accessToken, refreshToken } = await generateAccessAndRefereshTokens(hospital._id);

    return res.status(200)
        .cookie("accessToken", accessToken, options)
        .cookie("refreshToken", refreshToken, options)
        .json(
            new ApiResponse(200, "Hospital email verified successfully!", {
                hospital: {
                    _id: hospital._id,
                    email: hospital.email,
                    name: hospital.name,
                    isEmailVerified: hospital.isEmailVerified
                },
                accessToken,
                refreshToken
            })
        );
});

export { verifyOtp }

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

    if (!hospital.city || !hospital.district ||
        !hospital.receptionist_name || !hospital.receptionist_contact_number ||
        !hospital.available_services) {

        return res.status(201)
            .cookie("accessToken", accessToken, options)
            .cookie("refreshToken", refreshToken, options)
            .json(
                new ApiResponse(201, "Hospital logged in successfully but profile is incomplete", {
                    hospital: {
                        _id: hospital._id,
                        email: hospital.email,
                        name: hospital.name
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

export { loginHospital }

const registerHospitalDetails = asyncHandler(async (req, res) => {
    const hospital = req.user;

    const {
        city,
        district,
        receptionist_name,
        receptionist_contact_number,
        available_services,
        average_consultation_time
    } = req.body;

    if (!hospital) {
        throw new ApiError(404, "Hospital not found");
    }

    if (!city || !district || !receptionist_name || !receptionist_contact_number || !available_services) {
        throw new ApiError(400, "All fields are required");
    }

    // Update fields
    hospital.city = city;
    hospital.district = district;

    if (req.files) {
        if (req.files.profile_image && req.files.profile_image[0]) {
            const profileFile = req.files.profile_image[0];
            const { imageUrl, thumbnailUrl } = await uploadImageWithThumbnailToS3(
                profileFile.buffer,
                profileFile.originalname,
                "hospitals/logos",
                profileFile.mimetype
            );
            hospital.profile_image = imageUrl;
            hospital.thumbnail_url = thumbnailUrl;
        }

        if (req.files.receptionist_image && req.files.receptionist_image[0]) {
            const receptionistFile = req.files.receptionist_image[0];
            const { imageUrl } = await uploadImageWithThumbnailToS3(
                receptionistFile.buffer,
                receptionistFile.originalname,
                "hospitals/receptionists",
                receptionistFile.mimetype
            );
            hospital.receptionist_image = imageUrl;
        }
    }

    hospital.receptionist_name = receptionist_name;
    hospital.receptionist_contact_number = receptionist_contact_number;
    hospital.available_services = JSON.parse(available_services);
    hospital.average_consultation_time = average_consultation_time || 10;

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

export { registerHospitalDetails }

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

export { refreshAccessToken }

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

export { googleLogin }

const forgotPassword = asyncHandler(async (req, res) => {

    const { email } = req.body;

    if (!email) {
        throw new ApiError(400, "email is required");
    }

    const hospital = await Hospital.findOne({ email });

    if (!hospital) {
        throw new ApiError(400, "not a valid hospital");
    }

    // Generate 6-digit OTP
    const otp = Math.floor(100000 + Math.random() * 900000);

    // Save OTP to Redis with a 15-minute (900 seconds) expiration
    try {
        await redisClient.setEx(`otp:hospital:${email}`, 900, otp.toString());
    } catch (error) {
        throw new ApiError(500, "Failed to process OTP request. Please try again.");
    }

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

export { forgotPassword }

const resetPassword = asyncHandler(async (req, res) => {
    const { email, otp, newPassword } = req.body;

    if (!email || !otp || !newPassword) {
        throw new ApiError(400, "Email, OTP and New Password are required");
    }

    const hospital = await Hospital.findOne({ email });

    if (!hospital) {
        throw new ApiError(404, "Hospital not found");
    }

    // Verify OTP against Redis Cache
    const cachedOtp = await redisClient.get(`otp:hospital:${email}`);
    if (!cachedOtp) {
        throw new ApiError(400, "OTP has expired or does not exist. Please request a new one.");
    }
    if (cachedOtp !== otp.toString()) {
        throw new ApiError(400, "Invalid OTP");
    }

    // Update password and clean up Redis
    hospital.password = newPassword;
    await redisClient.del(`otp:hospital:${email}`);

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

export { resetPassword }


const logoutHospital = asyncHandler(async (req, res) => {
    await Hospital.findByIdAndUpdate(
        req.user._id,
        {
            $set: {
                refresh_token: undefined
            }
        },
        {
            returnDocument: 'after'
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

export { logoutHospital }

const getHospitalDetails = asyncHandler(async (req, res) => {
    const hospital = await Hospital.findById(req.user._id);

    if (!hospital) {
        throw new ApiError(404, "Hospital not found");
    }

    return res.status(200).json(
        new ApiResponse(200, "Hospital details fetched successfully", {
            hospital: {
                email: hospital.email,
                name: hospital.name,
                username: hospital.username,
                city: hospital.city,
                district: hospital.district,
                receptionist_name: hospital.receptionist_name,
                receptionist_contact_number: hospital.receptionist_contact_number,
                receptionist_image: hospital.receptionist_image,
                available_services: hospital.available_services,
                average_consultation_time: hospital.average_consultation_time,
                profile_image: hospital.profile_image,
                thumbnail_url: hospital.thumbnail_url
            }
        })
    );
});

export { getHospitalDetails }

const updateHospitalDetails = asyncHandler(async (req, res) => {
    console.log("--- Update Hospital Profile Request ---");
    console.log("Body:", req.body);

    const { city, district, receptionist_name, receptionist_contact_number, available_services, average_consultation_time, name, username } = req.body;

    if (username) {
        const existingHospital = await Hospital.findOne({ username });
        if (existingHospital && existingHospital._id.toString() !== req.user._id.toString()) {
            throw new ApiError(400, "Username is already taken");
        }
    }

    const updateFields = {};
    if (city) updateFields.city = city;
    if (district) updateFields.district = district;
    if (receptionist_name) updateFields.receptionist_name = receptionist_name;
    if (receptionist_contact_number) updateFields.receptionist_contact_number = receptionist_contact_number;
    if (available_services) updateFields.available_services = available_services;
    if (average_consultation_time) updateFields.average_consultation_time = average_consultation_time;
    if (name) updateFields.name = name;
    if (username) updateFields.username = username;

    const currentHospital = await Hospital.findById(req.user._id);

    if (req.files) {
        // Handle profile_image
        if (req.files.profile_image && req.files.profile_image[0]) {
            const profileFile = req.files.profile_image[0];
            
            // Delete old profile images
            if (currentHospital.profile_image) {
                await deleteFileFromS3(currentHospital.profile_image);
            }
            if (currentHospital.thumbnail_url) {
                await deleteFileFromS3(currentHospital.thumbnail_url);
            }

            // Upload new profile image
            const { imageUrl, thumbnailUrl } = await uploadImageWithThumbnailToS3(
                profileFile.buffer,
                profileFile.originalname,
                "hospitals/logos",
                profileFile.mimetype
            );
            updateFields.profile_image = imageUrl;
            updateFields.thumbnail_url = thumbnailUrl;
        }

        // Handle receptionist_image
        if (req.files.receptionist_image && req.files.receptionist_image[0]) {
            const receptionistFile = req.files.receptionist_image[0];

            // Delete old receptionist image
            if (currentHospital.receptionist_image) {
                await deleteFileFromS3(currentHospital.receptionist_image);
            }

            // Upload new receptionist image
            const { imageUrl } = await uploadImageWithThumbnailToS3(
                receptionistFile.buffer,
                receptionistFile.originalname,
                "hospitals/receptionists",
                receptionistFile.mimetype
            );
            updateFields.receptionist_image = imageUrl;
        }
    }

    const updatedHospital = await Hospital.findByIdAndUpdate(
        req.user._id,
        {
            $set: updateFields
        },
        {
            new: true
        }
    );

    if (!updatedHospital) {
        throw new ApiError(404, "Hospital not found");
    }

    return res.status(200).json(
        new ApiResponse(200, "Hospital details updated successfully")
    );
});

export { updateHospitalDetails }


const searchLocations = asyncHandler(async (req, res) => {
    const { q, page = 1, limit = 10 } = req.query;

    if (!q) {
        throw new ApiError(400, "Location Search query is required");
    }

    // We use $group to make cities unique (Distinct), allowing us to paginate them!
    const locationAggregateQuery = Hospital.aggregate([
        {
            $match: {
                $or: [
                    { city: { $regex: q, $options: "i" } },
                    { district: { $regex: q, $options: "i" } }
                ]
            }
        },
        {
            $group: {
                _id: "$city",
                district: { $first: "$district" }
            }
        },
        {
            $sort: {
                _id: 1,
                district: 1
            }
        },
        {
            $project: {
                _id: 0,
                city: "$_id",
                district: 1
            }
        }
    ]);

    const options = {
        page: parseInt(page, 10),
        limit: parseInt(limit, 10)
    };

    const result = await Hospital.aggregatePaginate(locationAggregateQuery, options);

    return res.status(200).json(
        new ApiResponse(200, "Locations fetched successfully", result)
    );
});

export { searchLocations }

const searchHospitals = asyncHandler(async (req, res) => {
    const { q, filter, page = 1, limit = 10 } = req.query;

    if (!q) {
        throw new ApiError(400, "Search query is required");
    }

    const searchRegex = { $regex: q, $options: "i" };
    let matchCondition = {};

    if (filter === "place") {
        matchCondition = {
            $or: [
                { city: searchRegex },
                { district: searchRegex }
            ]
        };
    } else if (filter === "department") {
        matchCondition = { available_services: searchRegex };
    } else if (filter === "hospital") {
        matchCondition = { name: searchRegex };
    } else {
        // Universal Search (No specific filter selected)
        matchCondition = {
            $or: [
                { name: searchRegex },
                { city: searchRegex },
                { district: searchRegex },
                { available_services: searchRegex }
            ]
        };
    }

    const hospitalsAggregateQuery = Hospital.aggregate([
        {
            $match: matchCondition
        },
        {
            $project: {
                _id: 1,
                name: 1,
                city: 1,
                district: 1,
                profile_image: 1,
                thumbnail_url: 1
            }
        }
    ]);

    const options = {
        page: parseInt(page, 10),
        limit: parseInt(limit, 10)
    }

    const result = await Hospital.aggregatePaginate(hospitalsAggregateQuery, options);

    return res.status(200).json(
        new ApiResponse(200, "Hospitals fetched successfully", result)
    )
})

export { searchHospitals }


const getHospitalsByLocation = asyncHandler(async (req, res) => {
    const { page = 1, limit = 10, location } = req.query;

    if (!location) {
        throw new ApiError(400, "Location parameter is required");
    }

    const hospitalsAggregateQuery = Hospital.aggregate([
        {
            $match: {
                $or: [
                    { city: { $regex: `^${location}$`, $options: "i" } },
                    { district: { $regex: `^${location}$`, $options: "i" } }
                ]
            }
        },
        {
            $project: {
                _id: 1,
                name: 1,
                city: 1,
                district: 1,
                available_services: 1,
                profile_image: 1,
                thumbnail_url: 1
            }
        }
    ]);

    const options = {
        page: parseInt(page, 10),
        limit: parseInt(limit, 10)
    };

    const result = await Hospital.aggregatePaginate(hospitalsAggregateQuery, options);

    return res.status(200).json(
        new ApiResponse(200, "Hospitals fetched successfully", result)
    );
});

export { getHospitalsByLocation }


const getHospitalById = asyncHandler(async (req, res) => {
    const { hospital_id } = req.params;

    if (!hospital_id) {
        throw new ApiError(400, "Hospital ID is required");
    }

    const hospital = await Hospital.findById(hospital_id).select("-password -refresh_token -isEmailVerified -createdAt -updatedAt -__v");

    if (!hospital) {
        throw new ApiError(404, "Hospital not found");
    }

    return res.status(200).json(
        new ApiResponse(200, "Hospital details fetched successfully", hospital)
    );
});

export { getHospitalById }

