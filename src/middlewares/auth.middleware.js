import jwt from "jsonwebtoken"
import { asyncHandler } from "../utils/asyncHandler.js"
import { ApiError } from "../utils/ApiError.js"
import { User } from "../models/user.model.js"
import { Hospital } from "../models/hospital.model.js"

const verifyJWT = asyncHandler(async (req, _, next) => {
    try {
        const token = req.cookies?.accessToken || req.header("Authorization")?.replace("Bearer ", "");

        if (!token) {
            throw new ApiError(401, "Unauthorized User");
        }

        const decodedToken = jwt.verify(token, process.env.ACCESS_TOKEN_SECRET);

        let user;
        if (decodedToken.role === "hospital") {
            user = await Hospital.findById(decodedToken._id).select("-password -refresh_token");
        } else {
            user = await User.findById(decodedToken._id).select("-password -refresh_token");
        }

        if (!user) {
            throw new ApiError(401, "Unauthorized User");
        }

        req.user = user;
        next();
    } catch (error) {
        console.log(error);
        throw new ApiError(401, error?.message || "Invalid Access Token");
    }
})

export { verifyJWT }