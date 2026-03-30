import { Router } from "express";
import { getUserAppointments } from "../controllers/appointment.controller.js";
import { verifyJWT } from "../middlewares/auth.middleware.js";

const router = Router();

// Secure all routes with the auth middleware
router.use(verifyJWT);

// Routes
// Use a single route for appointments, differentiated by `?type=upcoming` or `?type=past`
router.route("/user-appointments").get(getUserAppointments);

export default router;
