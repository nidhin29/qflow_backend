import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { Appointment } from "../models/appointment.model.js";
import mongoose from "mongoose";

const getUserAppointments = asyncHandler(async (req, res) => {
    // 1. Extract page, limit, and the 'type' of appointments to fetch
    const { page = 1, limit = 10, type = "upcoming" } = req.query;

    // 2. Build our dynamic matching condition based on the 'type' parameter
    const matchCondition = {
        patient_id: new mongoose.Types.ObjectId(req.user._id)
    };

    if (type === "upcoming") {
        matchCondition.appointment_date = { $gte: new Date() };
    } else if (type === "past") {
        matchCondition.appointment_date = { $lt: new Date() };
    } else {
        throw new ApiError(400, "Invalid appointment type parameter. Must be 'upcoming' or 'past'.");
    }

    // Sort upcoming from nearest to furthest, and past from most recent to oldest
    const sortOrder = type === "upcoming" ? 1 : -1;

    // 3. Define the Aggregate pipeline query (do NOT await it, because we need to hand it to paginate)
    const aggregateQuery = Appointment.aggregate([
        {
            $match: matchCondition
        },
        {
            $sort: { appointment_date: sortOrder }
        },
        {
            $lookup: {
                from: "users",
                localField: "patient_id",
                foreignField: "_id",
                as: "userDetails"
            }
        }
    ]);

    const options = {
        page: parseInt(page, 10),
        limit: parseInt(limit, 10)
    };

    // 4. Pass the pipeline query into aggregatePaginate
    const result = await Appointment.aggregatePaginate(aggregateQuery, options);

    return res.status(200).json(
        new ApiResponse(200, `${type === 'upcoming' ? 'Upcoming' : 'Past'} appointments fetched successfully`, result)
    );
});

export { getUserAppointments };
