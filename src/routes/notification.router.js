import { Router } from "express";
import { getUserNotifications } from "../controllers/notification.controller.js";
import { verifyJWT } from "../middlewares/auth.middleware.js";

const router = Router();

// Secure all routes with the auth middleware
router.use(verifyJWT);

router.route("/").get(getUserNotifications);

export default router;
