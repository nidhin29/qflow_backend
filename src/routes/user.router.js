import { Router } from "express"
import { registerUser, googleLogin, verifyOtp, sendOtp, loginUser } from "../controllers/user.controller.js"

const router = Router();

router.route("/register").post(registerUser);
router.route("/send-otp").post(sendOtp);
router.route("/google-login").post(googleLogin);
router.route("/verify-otp").post(verifyOtp);
router.route("/login").post(loginUser);

export default router;
