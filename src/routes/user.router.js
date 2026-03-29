import { Router } from "express"
import {
    registerUser,
    googleLogin,
    verifyOtp,
    sendOtp,
    loginUser,
    registerUserDetails,
    refreshAccessToken,
    forgotPassword,
    resetPassword,
    logoutUser
} from "../controllers/user.controller.js"
import { verifyJWT } from "../middlewares/auth.middleware.js"

const router = Router();

router.route("/register").post(registerUser);
router.route("/send-otp").post(sendOtp);
router.route("/google-login").post(googleLogin);
router.route("/verify-otp").post(verifyOtp);
router.route("/login").post(loginUser);
router.route("/register-user-details").post(verifyJWT, registerUserDetails);
router.route("/refresh-access-token").post(refreshAccessToken);
router.route("/forgot-password").post(forgotPassword);
router.route("/reset-password").post(resetPassword);
router.route("/logout").post(verifyJWT, logoutUser);

export default router;
