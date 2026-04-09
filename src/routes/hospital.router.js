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
    updateHospitalDetails,
    getHospitalById,
    searchHospitals,
    searchLocations,
    getHospitalsByLocation
} from "../controllers/hospital.controller.js"
import { verifyJWT } from "../middlewares/auth.middleware.js"
import { upload } from "../middlewares/multer.middleware.js"

const router = Router();

router.route("/register").post(registerHospital);
router.route("/send-otp").post(sendOtp);
router.route("/verify-otp").post(verifyOtp);
router.route("/login").post(loginHospital);
router.route("/google-login").post(googleLogin);
router.route("/refresh-token").post(refreshAccessToken);
router.route("/register-details").post(verifyJWT, upload.fields([{ name: 'profile_image', maxCount: 1 }, { name: 'receptionist_image', maxCount: 1 }]), registerHospitalDetails);
router.route("/forgot-password").post(forgotPassword);
router.route("/reset-password").post(resetPassword);
router.route("/logout").post(verifyJWT, logoutHospital);
router.route("/update-hospital-details").put(verifyJWT, upload.fields([{ name: 'profile_image', maxCount: 1 }, { name: 'receptionist_image', maxCount: 1 }]), updateHospitalDetails);
router.route("/get-hospital-details").get(verifyJWT, getHospitalDetails);
router.route("/get-hospital-by-id/:hospital_id").get(verifyJWT, getHospitalById);
router.route("/search-hospitals").get(verifyJWT, searchHospitals);
router.route("/search-locations").get(verifyJWT, searchLocations);
router.route("/get-hospitals-by-location").get(verifyJWT, getHospitalsByLocation);

export default router;
