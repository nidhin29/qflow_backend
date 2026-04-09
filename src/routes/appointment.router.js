import { Router } from "express";
import { getUserAppointments, searchUserAppointments, bookAppointment, getHospitalAppointments, serveNextPatient } from "../controllers/appointment.controller.js";
import { verifyJWT } from "../middlewares/auth.middleware.js";

const router = Router();

// Secure all routes with the auth middleware
router.use(verifyJWT);

// Routes
// Use a single route for appointments, differentiated by `?type=upcoming` or `?type=past`
router.route("/user-appointments").get(getUserAppointments);

// Search through user appointments by hospital name
router.route("/search-user-appointments").get(searchUserAppointments);

// Book a new appointment using Redis Queuing
router.route("/book-appointment").post(bookAppointment);

router.route("/hospital-appointments").get(getHospitalAppointments);

// Advance the Currently Serving Queue
router.route("/serve-next-patient").post(serveNextPatient);

export default router;
