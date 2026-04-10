import cron from "node-cron";
import { Appointment } from "../models/appointment.model.js";
import { User } from "../models/user.model.js";
import { adminMessaging } from "../config/firebase.js";
import { Notification } from "../models/notification.model.js";

const sendAutomatedReminders = async () => {
    try {
        console.log("⏰ Running Daily Appointment Reminder Task...");

        // 1. Calculate Tomorrow's Date in IST
        const now = new Date();
        const tomorrow = new Date(now.getTime() + (24 * 60 * 60 * 1000));
        
        // Normalize tomorrow to start of day in UTC for matching DB storage
        const tomorrowStart = new Date(Date.UTC(tomorrow.getUTCFullYear(), tomorrow.getUTCMonth(), tomorrow.getUTCDate()));
        
        console.log(`🔍 Searching for appointments on: ${tomorrowStart.toDateString()}`);

        // 2. Find pending appointments for tomorrow that haven't received a reminder
        const appointments = await Appointment.find({
            appointment_date: tomorrowStart,
            status: "Pending",
            reminder_sent: false
        }).populate("hospital_id", "name");

        if (appointments.length === 0) {
            console.log("✅ No pending appointments for tomorrow requiring reminders.");
            return;
        }

        console.log(`📧 Found ${appointments.length} appointments for tomorrow. Checking for FCM tokens...`);

        for (const appt of appointments) {
            const user = await User.findById(appt.patient_id);
            const hospitalName = appt.hospital_id?.name || "the hospital";
            const notificationText = `Hey, you have an appointment at ${hospitalName} tomorrow. Don't forget!`;
            
            if (user && user.fcmToken && adminMessaging) {
                const message = {
                    notification: {
                        title: "Appointment Reminder",
                        body: notificationText
                    },
                    token: user.fcmToken,
                };

                try {
                    await adminMessaging.send(message);
                    console.log(`✅ FCM Reminder sent to ${user.email} (Token: ${user.fcmToken.substring(0, 10)}...)`);
                    
                    // Mark as sent in Appointment
                    appt.reminder_sent = true;
                    await appt.save();

                    // Save to Notification History
                    await Notification.create({
                        user_id: user._id,
                        text: notificationText,
                        date: new Date() // Store the actual time sent
                    });

                } catch (fcmError) {
                    console.error(`❌ Failed to send FCM to ${user.email}:`, fcmError.message);
                }
            } else if (!user?.fcmToken) {
                 // console.log(`⏩ Skipping ${user?.email} - No FCM Token found.`);
            }
        }

    } catch (error) {
        console.error("❌ CRITICAL: Error in Automated Reminder Task:", error);
    }
};

/**
 * Cleanup Service: Deletes notifications older than 30 days every day at midnight UTC.
 */
const clearOldNotifications = async () => {
    try {
        console.log("🧹 Running Notification Cleanup Task...");
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

        const result = await Notification.deleteMany({
            date: { $lt: thirtyDaysAgo }
        });

        console.log(`✅ Cleanup Complete. Deleted ${result.deletedCount} old notifications.`);
    } catch (error) {
        console.error("❌ Error in Notification Cleanup Task:", error);
    }
}

// Schedule: Daily at 9:00 AM IST (03:30 AM UTC)
// Cleanup: Daily at 12:00 AM UTC (05:30 AM IST)
const initReminderCron = () => {
    // 1. Reminders at 04:00 AM UTC (09:30 AM IST)
    cron.schedule('0 4 * * *', () => {
        sendAutomatedReminders();
    });

    // 2. Cleanup at 00:00 AM UTC (05:30 AM IST)
    cron.schedule('0 0 * * *', () => {
        clearOldNotifications();
    });

    console.log("🚀 Background Services Scheduled (Reminders & Cleanup)");
};

export { initReminderCron };
