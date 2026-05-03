import amqp from 'amqplib';

let channel;
let connection;

export const connectRabbitMQ = async (retries = 5) => {
    try {
        const amqpServer = process.env.RABBITMQ_URL || 'amqp://guest:guest@localhost:5672';
        connection = await amqp.connect(amqpServer);
        channel = await connection.createChannel();
        
        // Assert queues to ensure they exist
        await channel.assertQueue('notification_queue', { durable: true });

        console.log('✅ Connected to RabbitMQ & Notification Queue Asserted');

        connection.on('error', (err) => {
            console.error('RabbitMQ Connection Error:', err);
            setTimeout(connectRabbitMQ, 5000);
        });

        connection.on('close', () => {
            console.warn('RabbitMQ Connection Closed. Reconnecting...');
            setTimeout(connectRabbitMQ, 5000);
        });

        return { connection, channel };
    } catch (error) {
        console.error(`❌ Failed to connect to RabbitMQ: ${error.message}`);
        if (retries > 0) {
            console.log(`Retrying in 5 seconds... (${retries} attempts left)`);
            await new Promise(resolve => setTimeout(resolve, 5000));
            return connectRabbitMQ(retries - 1);
        }
        return null;
    }
};

export const getChannel = () => channel;

export const publishToQueue = async (queueName, data) => {
    try {
        if (!channel) {
            console.error(`RabbitMQ Channel not initialized. Cannot publish to ${queueName}`);
            return false;
        }
        channel.sendToQueue(queueName, Buffer.from(JSON.stringify(data)), { persistent: true });
        return true;
    } catch (error) {
        console.error(`Error publishing to queue ${queueName}:`, error);
        return false;
    }
};
