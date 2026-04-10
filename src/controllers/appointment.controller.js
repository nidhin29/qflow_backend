import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { Appointment } from "../models/appointment.model.js";
import { Hospital } from "../models/hospital.model.js";
import { Notification } from "../models/notification.model.js";
import { adminMessaging } from "../config/firebase.js";
import mongoose from "mongoose";
import { redisClient } from "../db/redis.js";

/**
 * UTILITY HELPERS
 */

const getApptDateObject = (date, timeStr) => {
    try {
        const [time, modifier] = timeStr.split(' ');
        let [hours, minutes] = time.split(':');
        hours = parseInt(hours, 10);
        minutes = parseInt(minutes, 10);

        if (modifier === 'PM' && hours < 12) hours += 12;
        if (modifier === 'AM' && hours === 12) hours = 0;

        const d = new Date(date);
        d.setHours(hours, minutes, 0, 0);
        return d;
    } catch (e) {
        return new Date(date);
    }
};

/**
 * PATIENT CONTROLLERS
 */

const getUserAppointments = asyncHandler(async (req, res) => {
    const { page = 1, limit = 10, type = "upcoming" } = req.query;

    const matchCondition = {
        patient_id: new mongoose.Types.ObjectId(req.user._id)
    };

    const now = new Date();
    const indiaTime = new Date(now.getTime() + (5.5 * 60 * 60 * 1000));
    const startOfToday = new Date(Date.UTC(indiaTime.getUTCFullYear(), indiaTime.getUTCMonth(), indiaTime.getUTCDate()));

    if (type === "upcoming") {
        matchCondition.appointment_date = { $gte: startOfToday };
    } else if (type === "past") {
        matchCondition.appointment_date = { $lt: startOfToday };
    } else {
        throw new ApiError(400, "Invalid appointment type. Must be 'upcoming' or 'past'.");
    }

    const sortOrder = type === "upcoming" ? 1 : -1;

    const aggregateQuery = Appointment.aggregate([
        { $match: matchCondition },
        { $sort: { appointment_date: sortOrder } },
        {
            $lookup: {
                from: "hospitals",
                localField: "hospital_id",
                foreignField: "_id",
                as: "hospitalDetails"
            }
        },
        { $unwind: { path: "$hospitalDetails", preserveNullAndEmptyArrays: true } },
        {
            $project: {
                _id: 1,
                appointment_date: 1,
                appointment_time: 1,
                token_number: 1,
                department: 1,
                patient_name: 1,
                status: 1,
                "hospitalDetails._id": 1,
                "hospitalDetails.name": 1,
                "hospitalDetails.city": 1,
                "hospitalDetails.district": 1,
                "hospitalDetails.average_consultation_time": 1,
            }
        }
    ]);

    const result = await Appointment.aggregatePaginate(aggregateQuery, {
        page: parseInt(page, 10),
        limit: parseInt(limit, 10)
    });

    if (type === "upcoming") {
        result.docs = await Promise.all(result.docs.map(async (appointment) => {
            const hospital_id = appointment.hospitalDetails?._id || appointment.hospital_id;
            const dateStr = new Date(appointment.appointment_date).toISOString().split('T')[0];
            const dept = appointment.department;

            let servedNumber = 0;
            try {
                const servingValue = await redisClient.get(`queue:hosp:${hospital_id}:dept:${dept}:date:${dateStr}:serving`);
                servedNumber = servingValue ? parseInt(servingValue, 10) : 0;
            } catch (err) { }

            const patients_ahead = await Appointment.countDocuments({
                hospital_id: hospital_id,
                department: dept,
                appointment_date: appointment.appointment_date,
                status: "Pending",
                token_number: { $lt: appointment.token_number }
            });

            return {
                ...appointment,
                currently_serving: servedNumber,
                patients_ahead
            };
        }));
    }

    return res.status(200).json(new ApiResponse(200, "Appointments fetched", result));
});

const searchUserAppointments = asyncHandler(async (req, res) => {
    const { q, page = 1, limit = 10 } = req.query;
    if (!q) throw new ApiError(400, "Search query is required");

    const matchCondition = { patient_id: new mongoose.Types.ObjectId(req.user._id) };

    const aggregateQuery = Appointment.aggregate([
        { $match: matchCondition },
        {
            $lookup: {
                from: "hospitals",
                localField: "hospital_id",
                foreignField: "_id",
                as: "hospitalDetails"
            }
        },
        { $unwind: { path: "$hospitalDetails", preserveNullAndEmptyArrays: true } },
        {
            $match: {
                $or: [
                    { "hospitalDetails.name": { $regex: q, $options: "i" } },
                    { "department": { $regex: q, $options: "i" } },
                    { "patient_name": { $regex: q, $options: "i" } }
                ]
            }
        },
        { $sort: { appointment_date: -1 } },
        {
            $project: {
                _id: 1,
                appointment_date: 1,
                appointment_time: 1,
                token_number: 1,
                department: 1,
                patient_name: 1,
                status: 1,
                "hospitalDetails.name": 1,
            }
        }
    ]);

    const result = await Appointment.aggregatePaginate(aggregateQuery, {
        page: parseInt(page, 10),
        limit: parseInt(limit, 10)
    });

    return res.status(200).json(new ApiResponse(200, "Search complete", result));
});

const bookAppointment = asyncHandler(async (req, res) => {
    const { hospital_id, appointment_date, appointment_time, department, patient_name, patient_id } = req.body;

    if (!hospital_id || !appointment_date || !appointment_time || !department || !patient_name || !patient_id) {
        throw new ApiError(400, "All fields are required.");
    }

    const hospital = await Hospital.findById(hospital_id);
    if (!hospital) throw new ApiError(404, "Hospital not found");

    const dateObj = new Date(appointment_date);
    dateObj.setUTCHours(0, 0, 0, 0);
    const dateStr = dateObj.toISOString().split("T")[0];

    const hospitalStartTime = getApptDateObject(appointment_date, hospital.opening_time || "09:00 AM");
    const requestedTime = getApptDateObject(appointment_date, appointment_time);
    const diffMins = Math.floor((requestedTime.getTime() - hospitalStartTime.getTime()) / 60000);
    const slotIndex = Math.floor(diffMins / (hospital.slot_duration || 60));

    const redisSlotKey = `queue:hosp:${hospital_id}:dept:${department}:date:${dateStr}:slot:${slotIndex}`;
    let token_number;

    try {
        const sub_token = await redisClient.incr(redisSlotKey);
        if (sub_token === 1) await redisClient.expire(redisSlotKey, 172800);
        const maxPerSlot = hospital.max_patients_per_slot || 4;
        token_number = (slotIndex * maxPerSlot) + sub_token;
    } catch (error) {
        const previousCount = await Appointment.countDocuments({ hospital_id, department, appointment_date: dateObj });
        token_number = previousCount + 1;
    }

    const appointment = await Appointment.create({
        patient_id,
        hospital_id,
        appointment_date: dateObj,
        appointment_time,
        token_number,
        department,
        patient_name
    });

    return res.status(201).json(new ApiResponse(201, "Appointment booked", appointment));
});

/**
 * HOSPITAL CONTROLLERS
 */

const getHospitalAppointments = asyncHandler(async (req, res) => {
    const { page = 1, limit = 10, type = "upcoming", department } = req.query;
    const matchCondition = { hospital_id: new mongoose.Types.ObjectId(req.user._id) };

    if (department) matchCondition.department = department;

    const now = new Date();
    const indiaTime = new Date(now.getTime() + (5.5 * 60 * 60 * 1000));
    const startOfToday = new Date(Date.UTC(indiaTime.getUTCFullYear(), indiaTime.getUTCMonth(), indiaTime.getUTCDate()));

    if (type === "upcoming") matchCondition.appointment_date = { $gte: startOfToday };
    else if (type === "past") matchCondition.appointment_date = { $lt: startOfToday };

    const aggregateQuery = Appointment.aggregate([
        { $match: matchCondition },
        {
            $lookup: {
                from: "users",
                localField: "patient_id",
                foreignField: "_id",
                as: "patientDetails"
            }
        },
        { $unwind: { path: "$patientDetails", preserveNullAndEmptyArrays: true } },
        { $sort: { appointment_date: type === "upcoming" ? 1 : -1, token_number: 1 } },
        {
            $project: {
                _id: 1,
                appointment_date: 1,
                appointment_time: 1,
                token_number: 1,
                department: 1,
                patient_name: 1,
                status: 1,
                "patientDetails.fullName": 1
            }
        }
    ]);

    const result = await Appointment.aggregatePaginate(aggregateQuery, {
        page: parseInt(page, 10),
        limit: parseInt(limit, 10)
    });

    return res.status(200).json(new ApiResponse(200, "Hospital appointments fetched", result));
});

const serveNextPatient = asyncHandler(async (req, res) => {
    const { appointment_date, department } = req.body;
    if (!appointment_date || !department) throw new ApiError(400, "Date and Department are required.");

    const hospital_id = req.user._id;
    const dateObj = new Date(appointment_date);
    dateObj.setUTCHours(0, 0, 0, 0);
    const dateStr = dateObj.toISOString().split("T")[0];

    const nextAppointment = await Appointment.findOneAndUpdate(
        { hospital_id, department, appointment_date: dateObj, status: "Pending" },
        { status: "Completed" },
        { sort: { token_number: 1 }, new: true }
    );

    if (!nextAppointment) throw new ApiError(404, "No pending patients left.");

    const currentToken = nextAppointment.token_number;
    const servingKey = `queue:hosp:${hospital_id}:dept:${department}:date:${dateStr}:serving`;
    await redisClient.set(servingKey, currentToken, { EX: 172800 });

    const io = req.app.get("io");
    if (io) {
        io.to(`hospital_${hospital_id}`).emit("queueUpdate", {
            appointment_date: dateStr,
            department,
            currently_serving: currentToken
        });
    }

    return res.status(200).json(new ApiResponse(200, "Patient served", { currently_serving: currentToken }));
});

const testNotification = asyncHandler(async (req, res) => {
    const user = req.user;
    if (!user.fcmToken) throw new ApiError(400, "No FCM Token found. Sync from app first.");

    const title = "Test Notification";
    const body = "Success! Your Qflow notification system is working perfectly. 🎉";

    if (adminMessaging) {
        try {
            const response = await adminMessaging.send({
                notification: { title, body },
                data: { click_action: "FLUTTER_NOTIFICATION_CLICK", type: "test" },
                token: user.fcmToken,
            });
            console.log("✅ FCM Success! ID:", response);
        } catch (error) {
            console.error("❌ FCM Error:", error);
        }
    }

    await Notification.create({ user_id: user._id, text: body, date: new Date() });
    return res.status(200).json(new ApiResponse(200, "Test notification sent!"));
});

export {
    getUserAppointments,
    searchUserAppointments,
    bookAppointment,
    getHospitalAppointments,
    serveNextPatient,
    testNotification
};
