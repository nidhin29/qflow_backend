import { Router } from "express"
import {
    registerHospital,
    sendOtp,
    verifyOtp,
    loginHospital,
    registerHospitalDetails,
    refreshAccessToken,
    googleLogin
} from "../controllers/hospital.controller.js"
import { verifyJWT } from "../middlewares/auth.middleware.js"

const router = Router();

router.route("/register").post(registerHospital);
router.route("/send-otp").post(sendOtp);
router.route("/verify-otp").post(verifyOtp);
router.route("/login").post(loginHospital);
router.route("/google-login").post(googleLogin);
router.route("/refresh-token").post(refreshAccessToken);
router.route("/register-details").post(verifyJWT, registerHospitalDetails);

export default router;
