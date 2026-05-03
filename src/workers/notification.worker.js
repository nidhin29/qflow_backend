import { getChannel } from '../config/rabbitmq.js';
import { adminMessaging } from '../config/firebase.js';
import { Notification } from '../models/notification.model.js';

export const setupWorkers = () => {
    const channel = getChannel();
    if (!channel) {
        console.error('Cannot setup workers: RabbitMQ channel not initialized');
        return;
    }

    // Notification Queue Worker (Handles FCM and In-App History)
    channel.consume('notification_queue', async (msg) => {
        if (msg !== null) {
            try {
                const data = JSON.parse(msg.content.toString());
                const { userId, fcmToken, title, body, extraData } = data;

                console.log(`🔔 Processing notification for user: ${userId}`);

                // 1. Send FCM if token exists
                if (fcmToken && adminMessaging) {
                    try {
                        await adminMessaging.send({
                            notification: { title, body },
                            data: extraData || {},
                            token: fcmToken,
                        });
                        console.log(`✅ FCM sent successfully to user: ${userId}`);
                    } catch (fcmError) {
                        console.error(`❌ FCM failed for user ${userId}:`, fcmError.message);
                    }
                }

                // 2. Always save to Notification History in DB
                await Notification.create({
                    user_id: userId,
                    text: body,
                    date: new Date()
                });

                channel.ack(msg);
            } catch (error) {
                console.error('❌ Failed to process notification task:', error);
                // Ack to avoid infinite loops, but in production you might want to use a DLQ (Dead Letter Queue)
                channel.ack(msg);
            }
        }
    });

    console.log('👷 RabbitMQ Workers are listening for tasks...');
};
