import { Router } from "express";
import { addMember, getMembers, deleteMember, updateMember } from "../controllers/member.controller.js";
import { verifyJWT } from "../middlewares/auth.middleware.js";

const router = Router();

// Secure all routes with the auth middleware
router.use(verifyJWT);

// Routes
router.route("/add-member").post(addMember);
router.route("/get-members").get(getMembers);
router.route("/delete-member").delete(deleteMember);
router.route("/update-member").post(updateMember);

export default router;
