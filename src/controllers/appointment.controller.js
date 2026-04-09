import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { Appointment } from "../models/appointment.model.js";
import { Hospital } from "../models/hospital.model.js";
import mongoose from "mongoose";
import { redisClient } from "../db/redis.js";

/**
 * UTILITY HELPERS
 */

/**
 * Merges a Date object and a Time String (e.g. "10:30 AM") into a single Date object.
 * @param {Date|String} date - The base date
 * @param {String} timeStr - The time string in "HH:MM AM/PM" format
 * @returns {Date}
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

/**
 * Fetches a paginated list of appointments for the logged-in user.
 * Calculates real-time "Smart Wait" predictions for upcoming slots.
 */
const getUserAppointments = asyncHandler(async (req, res) => {
    const { page = 1, limit = 10, type = "upcoming" } = req.query;

    const matchCondition = {
        patient_id: new mongoose.Types.ObjectId(req.user._id)
    };

    // Filter by Date (Upcoming vs Past)
    const now = new Date();
    // Offset now by 5.5 hours to find the correct local calendar day (IST)
    const indiaTime = new Date(now.getTime() + (5.5 * 60 * 60 * 1000));
    const startOfToday = new Date(Date.UTC(indiaTime.getUTCFullYear(), indiaTime.getUTCMonth(), indiaTime.getUTCDate()));

    if (type === "upcoming") {
        matchCondition.appointment_date = { $gte: startOfToday };
    } else if (type === "past") {
        matchCondition.appointment_date = { $lt: startOfToday };
    } else {
        throw new ApiError(400, "Invalid appointment type parameter. Must be 'upcoming' or 'past'.");
    }

    const sortOrder = type === "upcoming" ? 1 : -1;

    const aggregateQuery = Appointment.aggregate([
        { $match: matchCondition },
        { $sort: { appointment_date: sortOrder } },
        {
            $lookup: {
                from: "users",
                localField: "patient_id",
                foreignField: "_id",
                as: "userAppointmentDetails"
            }
        },
        { $unwind: { path: "$userAppointmentDetails", preserveNullAndEmptyArrays: true } },
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
                "userAppointmentDetails.fullName": 1,
            }
        }
    ]);

    const result = await Appointment.aggregatePaginate(aggregateQuery, {
        page: parseInt(page, 10),
        limit: parseInt(limit, 10)
    });

    // Enrich "Upcoming" appointments with live wait-time math (Dept-Specific)
    if (type === "upcoming") {
        result.docs = await Promise.all(result.docs.map(async (appointment) => {
            const hospital_id = appointment.hospitalDetails?._id || appointment.hospital_id;
            const dateStr = new Date(appointment.appointment_date).toISOString().split('T')[0];
            const dept = appointment.department;

            // 1. Fetch current "Now Serving" for this DEPARTMENT
            let servedNumber = 0;
            try {
                const servingValue = await redisClient.get(`queue:hosp:${hospital_id}:dept:${dept}:date:${dateStr}:serving`);
                servedNumber = servingValue ? parseInt(servingValue, 10) : 0;
            } catch (err) { }

            // 2. Count real "Pending" people ahead IN THIS DEPARTMENT
            const patients_ahead = await Appointment.countDocuments({
                hospital_id: hospital_id,
                department: dept,
                appointment_date: appointment.appointment_date,
                status: "Pending",
                token_number: { $lt: appointment.token_number }
            });

            // 3. Smart Wait Logic: (Now/Slot + Wait Time)
            const avgConsultTime = appointment.hospitalDetails?.average_consultation_time || 15;
            const bookedTime = getApptDateObject(appointment.appointment_date, appointment.appointment_time);

            const isToday = new Date(appointment.appointment_date).toDateString() === new Date().toDateString();
            const now = Date.now();

            // Logic: You can't be served before your slot, but you might be served late if the queue is long.
            const baseStartTime = isToday ? Math.max(bookedTime.getTime(), now) : bookedTime.getTime();

            const estServiceTime = new Date(baseStartTime + (patients_ahead * avgConsultTime * 60000));

            return {
                ...appointment,
                currently_serving: servedNumber,
                patients_ahead,
                estimated_service_time: estServiceTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
            };
        }));
    }

    return res.status(200).json(
        new ApiResponse(200, `${type.toUpperCase()} appointments fetched successfully`, result)
    );
});

/**
 * Allows a patient to search their own appointments by Hospital Name.
 */
const searchUserAppointments = asyncHandler(async (req, res) => {
    const { q, page = 1, limit = 10 } = req.query;

    if (!q) {
        throw new ApiError(400, "Search query is required");
    }

    const matchCondition = {
        patient_id: new mongoose.Types.ObjectId(req.user._id)
    };

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
                    { "status": { $regex: q, $options: "i" } },
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
                "hospitalDetails.city": 1,
                "hospitalDetails.district": 1,
            }
        }
    ]);

    const result = await Appointment.aggregatePaginate(aggregateQuery, {
        page: parseInt(page, 10),
        limit: parseInt(limit, 10)
    });

    return res.status(200).json(
        new ApiResponse(200, "Appointments searched successfully", result)
    );
});

/**
 * Books a new appointment using the "Slot-Aware Tokening" algorithm.
 * Groups patients into buckets (e.g. 1 hour) to ensure chronological daily order.
 */
const bookAppointment = asyncHandler(async (req, res) => {
    const { hospital_id, appointment_date, appointment_time, department, patient_name } = req.body;

    if (!hospital_id || !appointment_date || !appointment_time || !department || !patient_name) {
        throw new ApiError(400, "All fields are required.");
    }

    const hospital = await Hospital.findById(hospital_id);
    if (!hospital) throw new ApiError(404, "Hospital not found");

    // NEW: Validate that the department exists in the hospital's list
    if (!hospital.available_services || !hospital.available_services.includes(department)) {
        throw new ApiError(400, `The department '${department}' is not available at this hospital.`);
    }

    const dateObj = new Date(appointment_date);
    dateObj.setUTCHours(0, 0, 0, 0); // Normalize to Midnight for consistent indexing
    const dateStr = dateObj.toISOString().split("T")[0];

    // STEP 1: Identify the Slot (Bucket)
    const hospitalStartTime = getApptDateObject(appointment_date, hospital.opening_time || "09:00 AM");
    const requestedTime = getApptDateObject(appointment_date, appointment_time);

    const diffMins = Math.floor((requestedTime.getTime() - hospitalStartTime.getTime()) / 60000);
    const slotIndex = Math.floor(diffMins / (hospital.slot_duration || 60));

    if (slotIndex < 0) throw new ApiError(400, "Appointment time is before opening hours.");

    // STEP 2: Atomic Token Assignment via Redis (Dept-Aware)
    const redisSlotKey = `queue:hosp:${hospital_id}:dept:${department}:date:${dateStr}:slot:${slotIndex}`;
    let token_number;
    let sub_token = 0;
    let usedRedis = false;

    try {
        sub_token = await redisClient.incr(redisSlotKey);
        usedRedis = true;
        if (sub_token === 1) await redisClient.expire(redisSlotKey, 172800); // 48h expiry

        if (sub_token > (hospital.max_patients_per_slot || 4)) {
            throw new ApiError(400, `The ${appointment_time} slot for ${department} is fully booked.`);
        }

        // Global Token = (Previous Slots Full Capacity) + Current Slot Position
        const maxPerSlot = hospital.max_patients_per_slot || 4;
        token_number = (slotIndex * maxPerSlot) + sub_token;

    } catch (error) {
        console.log("Redis Error:", error);
        if (error.statusCode) throw error;
        // Fallback: DB Count approximation if Redis is down
        const previousCount = await Appointment.countDocuments({
            hospital_id,
            department,
            appointment_date: dateObj
        });
        token_number = previousCount + 1;
    }

    // STEP 3: MongoDB Persistence with Collision Retry
    let appointment;
    let maxRetries = 10; // High limit to find a "hole" in the sequence if needed
    while (maxRetries-- > 0) {
        try {
            appointment = await Appointment.create({
                patient_id: req.user._id,
                hospital_id,
                appointment_date: dateObj,
                appointment_time,
                token_number,
                department,
                patient_name
            });
            break;
        } catch (err) {
            console.error("Appointment DB Create Error:", err.code, err.message);
            if (err.code === 11000) {
                token_number++; // Quick bump if token exists
            } else {
                throw err;
            }
        }
    }

    if (!appointment) {
        // REVERT Redis if DB failed so we don't skip a token permanently
        if (usedRedis && sub_token > 0) {
            await redisClient.decr(redisSlotKey);
        }
        throw new ApiError(500, "Failed to secure appointment token after multiple attempts.");
    }

    return res.status(201).json(new ApiResponse(201, "Appointment booked"));
});

/**
 * HOSPITAL CONTROLLERS
 */

/**
 * Fetches dashboard data for the hospital, including real-time queue metrics.
 */
const getHospitalAppointments = asyncHandler(async (req, res) => {
    const { page = 1, limit = 10, type = "upcoming", department } = req.query;

    const matchCondition = {
        hospital_id: new mongoose.Types.ObjectId(req.user._id)
    };

    if (department) {
        matchCondition.department = department;
    }

    const now = new Date();
    // Offset now by 5.5 hours for IST
    const indiaTime = new Date(now.getTime() + (5.5 * 60 * 60 * 1000));
    const startOfToday = new Date(Date.UTC(indiaTime.getUTCFullYear(), indiaTime.getUTCMonth(), indiaTime.getUTCDate()));

    if (type === "upcoming") {
        matchCondition.appointment_date = { $gte: startOfToday };
    } else if (type === "past") {
        matchCondition.appointment_date = { $lt: startOfToday };
    }

    const sortOrder = type === "upcoming" ? 1 : -1;

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
        { $sort: { appointment_date: sortOrder, token_number: 1 } },
        {
            $project: {
                _id: 1,
                appointment_date: 1,
                appointment_time: 1,
                token_number: 1,
                department: 1,
                patient_name: 1,
                status: 1,
                "patientDetails.fullName": 1,
                "patientDetails._id": 1
            }
        }
    ]);

    const result = await Appointment.aggregatePaginate(aggregateQuery, {
        page: parseInt(page, 10),
        limit: parseInt(limit, 10)
    });

    // Add Live Metrics to upcoming list
    if (type === "upcoming") {
        result.docs = await Promise.all(result.docs.map(async (appointment) => {
            const dateStr = new Date(appointment.appointment_date).toISOString().split("T")[0];
            const dept = appointment.department;
            const servingKey = `queue:hosp:${appointment.hospital_id}:dept:${dept}:date:${dateStr}:serving`;

            let servedNumber = 0;
            try {
                const val = await redisClient.get(servingKey);
                servedNumber = val ? parseInt(val, 10) : 0;
            } catch (err) { }

            const patients_ahead = await Appointment.countDocuments({
                hospital_id: appointment.hospital_id,
                department: dept,
                appointment_date: appointment.appointment_date,
                status: "Pending",
                token_number: { $lt: appointment.token_number }
            });

            return { ...appointment, currently_serving: servedNumber, patients_ahead };
        }));
    }

    return res.status(200).json(new ApiResponse(200, "Hospital appointments fetched", result));
});

/**
 * Atomically advances the queue to the next pending patient.
 * Broadcasts the update via WebSockets.
 */
const serveNextPatient = asyncHandler(async (req, res) => {
    const { appointment_date, department } = req.body;
    console.log(appointment_date, department);
    if (!appointment_date || !department) {
        throw new ApiError(400, "Date and Department are required.");
    }

    const hospital_id = req.user._id;
    const dateObj = new Date(appointment_date);
    dateObj.setUTCHours(0, 0, 0, 0); // ENSURE IT MATCHES DB STORAGE
    const dateStr = dateObj.toISOString().split("T")[0];

    // 1. Mark next in line as "Completed" for this department
    const nextAppointment = await Appointment.findOneAndUpdate(
        { hospital_id, department, appointment_date: dateObj, status: "Pending" },
        { status: "Completed" },
        { sort: { token_number: 1 }, new: true }
    );

    if (!nextAppointment) throw new ApiError(404, `No pending patients left in ${department}.`);

    const currentToken = nextAppointment.token_number;

    // 2. Update Redis Cache (Dept-Aware)
    try {
        const servingKey = `queue:hosp:${hospital_id}:dept:${department}:date:${dateStr}:serving`;
        await redisClient.set(servingKey, currentToken, { EX: 172800 });
    } catch (err) { }

    // 3. Real-time broadcast
    const io = req.app.get("io");
    if (io) {
        io.to(`hospital_${hospital_id}`).emit("queueUpdate", {
            appointment_date: dateStr,
            department: department,
            currently_serving: currentToken
        });
    }

    return res.status(200).json(new ApiResponse(200, `Next patient in ${department} called`, {
        department,
        currently_serving: currentToken
    }));
});

export {
    getUserAppointments,
    searchUserAppointments,
    bookAppointment,
    getHospitalAppointments,
    serveNextPatient
};


