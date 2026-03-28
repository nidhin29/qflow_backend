import { Router } from "express"
import { registerUser, googleLogin, verifyOtp, sendOtp } from "../controllers/user.controller.js"

const router = Router();

router.route("/register").post(registerUser);
router.route("/send-otp").post(sendOtp);
router.route("/google-login").post(googleLogin);
router.route("/verify-otp").post(verifyOtp);

export default router;
