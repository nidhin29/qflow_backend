import { Router } from "express";
import { upcomingAppointmentsUser, pastAppointmentsUser } from "../controllers/appointment.controller.js";
import { verifyJWT } from "../middlewares/auth.middleware.js";

const router = Router();

// Secure all routes with the auth middleware
router.use(verifyJWT);

// Routes
router.route("/upcoming-appointments-user").get(upcomingAppointmentsUser);
router.route("/past-appointments-user").get(pastAppointmentsUser);

export default router;
