import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { Appointment } from "../models/appointment.model.js";
import mongoose from "mongoose";
import { redisClient } from "../db/redis.js";

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
                as: "userAppointmentDetails"
            }
        },
        {
            $unwind: {
                path: "$userAppointmentDetails",
                preserveNullAndEmptyArrays: true
            }
        },
        {
            $lookup: {
                from: "hospitals",
                localField: "hospital_id",
                foreignField: "_id",
                as: "hospitalDetails"
            }
        },
        {
            $unwind: {
                path: "$hospitalDetails",
                preserveNullAndEmptyArrays: true
            }
        },
        {
            $project: {
                _id: 1,
                appointment_date: 1,
                appointment_time: 1,
                token_number: 1,
                department: 1,
                patient_name: 1,
                // Only project safe fields from the Hospital document
                "hospitalDetails._id": 1,
                "hospitalDetails.name": 1,
                "hospitalDetails.city": 1,
                "hospitalDetails.district": 1,
                // Only project safe fields from the User document
                "userAppointmentDetails.fullName": 1,
            }
        }
    ]);

    const options = {
        page: parseInt(page, 10),
        limit: parseInt(limit, 10)
    };

    // 4. Pass the pipeline query into aggregatePaginate
    const result = await Appointment.aggregatePaginate(aggregateQuery, options);

    // 5. Automatically fetch live Redis queuing status ONLY for upcoming appointments!
    if (type === "upcoming") {
        const docsWithLiveQueue = await Promise.all(result.docs.map(async (appointment) => {
            // Because of the $unwind stage above, hospitalDetails is no longer an array!
            const hospital_id = appointment.hospitalDetails?._id;
            if (!hospital_id) return appointment;

            const dateString = new Date(appointment.appointment_date).toISOString().split("T")[0];
            const servingQueueKey = `serving:hospital:${hospital_id}:date:${dateString}`;

            // Get the Live TV Screen Ticket Number from Redis
            const currently_serving = await redisClient.get(servingQueueKey);
            const servedNumber = currently_serving ? parseInt(currently_serving, 10) : 0;

            // Calculate the math for the Patient's App UI! (e.g. 50 - 15 = 35)
            const patients_ahead = Math.max(0, appointment.token_number - servedNumber);

            return {
                ...appointment,
                currently_serving: servedNumber,
                patients_ahead
            };
        }));

        result.docs = docsWithLiveQueue;
    }

    return res.status(200).json(
        new ApiResponse(200, `${type === 'upcoming' ? 'Upcoming' : 'Past'} appointments fetched successfully`, result)
    );
});

export { getUserAppointments }

const bookAppointment = asyncHandler(async (req, res) => {
    const { hospital_id, appointment_date, appointment_time, department, patient_name } = req.body;

    if (!hospital_id || !appointment_date || !appointment_time || !department || !patient_name) {
        throw new ApiError(400, "Hospital ID, Appointment Date, Time, Department, and Patient Name are required.");
    }

    // 1. Format the date to a simple String (YYYY-MM-DD) for the Redis Key
    const dateObj = new Date(appointment_date);
    const dateString = dateObj.toISOString().split("T")[0]; // e.g., "2024-03-31"

    // 2. Generate the unique Redis Queue Key
    const redisQueueKey = `queue:hospital:${hospital_id}:date:${dateString}`;

    let token_number;

    // 3. Atomically get the next Token Number from Redis (Instantaneous!)
    try {
        token_number = await redisClient.incr(redisQueueKey);

        // 4. Attach expiration timer to the very first token booked for that specific date
        if (token_number === 1) {
            const expireDate = new Date(appointment_date);
            expireDate.setDate(expireDate.getDate() + 2); // Add 2 days
            const expireUnixTimestamp = Math.floor(expireDate.getTime() / 1000);
            await redisClient.expireAt(redisQueueKey, expireUnixTimestamp);
        }
    } catch (error) {
        // GRACEFUL DEGRADATION: If Redis is completely down/crashes, DO NOT let the app crash!
        // Fallback to manually counting the database to generate the token number
        console.error("Redis failed to generate Queue Token. Falling back to MongoDB...");
        const previousAppointments = await Appointment.countDocuments({
            hospital_id,
            appointment_date: dateObj
        });

        token_number = previousAppointments + 1;
    }

    // 5. Save the Appointment to MongoDB permanently with a Retry Loop for Redis Desyncs
    let appointment;
    let maxRetries = 2; // Try up to 2 times

    while (maxRetries > 0) {
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
            break; // Success! Exit the loop
        } catch (saveError) {
            // Did we hit the Unique Constraint? (11000 = MongoDB Duplicate Key Error)
            if (saveError.code === 11000) {
                console.error(`Redis desync detected! Token ${token_number} already exists! Recovering...`);

                // Ask Mongo for the true count
                const trueCount = await Appointment.countDocuments({
                    hospital_id,
                    appointment_date: dateObj
                });

                // Force Redis to jump to the correct number so the NEXT loop iteration works
                token_number = trueCount + 1;
                await redisClient.set(redisQueueKey, token_number);

                maxRetries--;
            } else {
                throw saveError; // Normal MongoDB error (e.g., validation failed)
            }
        }
    }

    if (!appointment) {
        throw new ApiError(500, "Failed to securely book appointment. The queue may be temporarily unstable. Please try again.");
    }

    return res.status(201).json(
        new ApiResponse(201, "Appointment booked successfully", appointment)
    );
});

export { bookAppointment };

const getHospitalAppointments = asyncHandler(
    async (req, res) => {

        const { page = 1, limit = 10, type = "upcoming" } = req.query;

        const matchCondition = {
            hospital_id: new mongoose.Types.ObjectId(req.user._id)
        }

        if (type === "upcoming") {
            matchCondition.appointment_date = { $gte: new Date() };
        } else if (type === "past") {
            matchCondition.appointment_date = { $lt: new Date() };
        } else {
            throw new ApiError(400, "Invalid appointment type parameter. Must be 'upcoming' or 'past'.");
        }

        const sortOrder = type === "upcoming" ? 1 : -1;


        const aggregateQuery = Appointment.aggregate([
            {
                $match: matchCondition
            },
            {
                $lookup: {
                    from: "users",
                    localField: "patient_id",
                    foreignField: "_id",
                    as: "patientDetails"
                }
            },
            {
                $unwind: {
                    path: "$patientDetails",
                    preserveNullAndEmptyArrays: true
                }
            },
            {
                $sort: { appointment_date: sortOrder }
            },
            {
                $project: {
                    _id: 1,
                    appointment_date: 1,
                    appointment_time: 1,
                    token_number: 1,
                    department: 1,
                    patient_name: 1,
                    createdAt: 1,
                    // Only project safe fields from the Patient document
                    "patientDetails._id": 1,
                    "patientDetails.fullName": 1,
                }
            }
        ]);

        const options = {
            page: parseInt(page, 10),
            limit: parseInt(limit, 10)
        }

        const result = await Appointment.aggregatePaginate(aggregateQuery, options);

        return res.status(200).json(
            new ApiResponse(200, `${type === 'upcoming' ? 'Upcoming' : 'Past'} appointments fetched successfully`, result)
        );
    }
)
export { getHospitalAppointments };

const serveNextPatient = asyncHandler(async (req, res) => {
    // The Hospital Admin clicks the "Call Next Patient" button
    const { appointment_date } = req.body;

    if (!appointment_date) {
        throw new ApiError(400, "Appointment Date is required to serve the queue.");
    }

    const hospital_id = req.user._id;
    const dateObj = new Date(appointment_date);
    const dateString = dateObj.toISOString().split("T")[0];

    const servingQueueKey = `serving:hospital:${hospital_id}:date:${dateString}`;

    // 1. MONGODB IS THE SOURCE OF TRUTH (Graceful Degradation)
    // Find the very next pending patient in the database, and instantly update them to Completed!
    const nextAppointment = await Appointment.findOneAndUpdate(
        { hospital_id, appointment_date: dateObj, status: "Pending" },
        { status: "Completed" },
        { sort: { token_number: 1 }, new: true } // Sort by token_number Ascending (1, 2, 3) to get the correct next person
    );

    if (!nextAppointment) {
        throw new ApiError(404, "There are no pending patients left in the queue for this date.");
    }

    const currently_serving = nextAppointment.token_number;

    // 2. REDIS SYNCHRONIZATION (Try/Catch Fallback)
    try {
        // Force Redis to perfectly match MongoDB's truth
        await redisClient.set(servingQueueKey, currently_serving);

        if (currently_serving === 1) {
            // Attach expiration timer for 48 hours to save server RAM, just like the booking queue
            const expireDate = new Date(appointment_date);
            expireDate.setDate(expireDate.getDate() + 2);
            const expireUnixTimestamp = Math.floor(expireDate.getTime() / 1000);
            await redisClient.expireAt(servingQueueKey, expireUnixTimestamp);
        }
    } catch (redisError) {
        console.error("Redis Cache Failed! Gracefully falling back to MongoDB Source of Truth:", redisError);
        // We DO NOT throw an error here. We silently swallow the Redis crash so the hospital app keeps working!
    }

    // 3. REAL-TIME BROADCAST TO WAITING PATIENTS
    // Instantly yell the new Token Number down the open WebSocket pipeline!
    const io = req.app.get("io");
    if (io) {
        io.to(`hospital_${hospital_id}`).emit("queueUpdate", {
            appointment_date: dateString,
            currently_serving: currently_serving
        });
    }

    return res.status(200).json(
        new ApiResponse(200, "Successfully called the next patient", {
            status: "Now Serving",
            currently_serving: currently_serving
        })
    );
});

export { serveNextPatient };


