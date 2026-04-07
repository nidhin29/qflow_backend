# 1. Start with a lightweight Node.js 20 image on Alpine Linux
FROM node:20-alpine

# 2. Set the working directory inside the container
WORKDIR /app

# 3. Copy package.json and package-lock.json first (for better caching)
COPY package*.json ./

# 4. Install dependencies (Clean install for production)
RUN npm install

# 5. Copy the rest of your source code
COPY . .

# 6. Your app runs on port 8000
EXPOSE 8000

# 7. Start the application
CMD ["node", "src/index.js"]

