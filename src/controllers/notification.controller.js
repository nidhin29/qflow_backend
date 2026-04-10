import { Notification } from "../models/notification.model.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiResponse } from "../utils/ApiResponse.js";

/**
 * Fetches the notification history for the logged-in user.
 * Sorted by newest first.
 */
const getUserNotifications = asyncHandler(async (req, res) => {
    const notifications = await Notification.find({
        user_id: req.user?._id
    }).sort({ date: -1 });

    return res.status(200).json(
        new ApiResponse(200, "Notifications fetched successfully", notifications)
    );
});

export { getUserNotifications };
