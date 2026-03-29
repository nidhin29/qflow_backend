import { asyncHandler } from "../utils/asyncHandler";
import { User } from "../models/user.model";
import mongoose from "mongoose";



const upcomingAppointmentsUser = asyncHandler(
    async (req,res) => {

        const {page = 1, limit = 10} = req.query;

        const userWithUpcomingAppointments = await User.aggregate(
            [
                {
                    $match: {
                        _id: mongoose.Types.ObjectId(req.user._id),
                        $gte: new Date()
                    },
                    $sort: {
                        appointment_date: 1
                    },

                    $lookup:{
                        from: "appointments",
                        localField: "_id",
                        foreignField: "patient_id",
                        as: "upcomingAppointments"
                    }
                },
                {
                    $project: {
                        upcomingAppointments: 1
                    }
                }
            ]
        )

        if(!userWithUpcomingAppointments || userWithUpcomingAppointments.length === 0){
            throw new ApiError(404, "User not found");
        }

        const options = {
            page: parseInt(page),
            limit: parseInt(limit),
            
        }

        const result = await Appointment.aggregatePaginate(userWithUpcomingAppointments, options);

        return res.status(200).json(
            new ApiResponse(200, "Upcoming appointments fetched successfully", result)
        )
    }
)

export { upcomingAppointmentsUser }


const pastAppointmentsUser = asyncHandler(
    async (req,res) => {

        const {page = 1, limit = 10} = req.query;

        const userWithPastAppointments = await User.aggregate(
            [
                {
                    $match: {
                        _id: mongoose.Types.ObjectId(req.user._id),
                        $lte: new Date()
                    },
                    $sort: {
                        appointment_date: -1
                    },

                    $lookup:{
                        from: "appointments",
                        localField: "_id",
                        foreignField: "patient_id",
                        as: "pastAppointments"
                    }
                },
                {
                    $project: {
                        pastAppointments: 1
                    }
                }
            ]
        )

        if(!userWithPastAppointments || userWithPastAppointments.length === 0){
            throw new ApiError(404, "User not found");
        }

        const options = {
            page: parseInt(page),
            limit: parseInt(limit),
            
        }

        const result = await Appointment.aggregatePaginate(userWithPastAppointments, options);

        return res.status(200).json(
            new ApiResponse(200, "Past appointments fetched successfully", result)
        )
    }
)

export { pastAppointmentsUser }
