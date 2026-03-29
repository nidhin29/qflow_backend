import { Router } from "express"
import {
    registerHospital,
    sendOtp,
    verifyOtp,
    loginHospital,
    registerHospitalDetails,
    refreshAccessToken,
    googleLogin,
    forgotPassword,
    resetPassword,
    logoutHospital,
    getHospitalDetails,
    updateHospitalDetails
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
router.route("/forgot-password").post(forgotPassword);
router.route("/reset-password").post(resetPassword);
router.route("/logout").post(verifyJWT, logoutHospital);
router.route("/update-hospital-details").put(verifyJWT, updateHospitalDetails);
router.route("/get-hospital-details").get(verifyJWT, getHospitalDetails);

export default router;
