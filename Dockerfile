FROM node:20-alpine

WORKDIR /app

# Ensure OpenSSL tooling is available so Prisma picks the correct binary
RUN apk add --no-cache openssl

# Install dependencies
COPY package*.json ./
RUN npm install

# Copy source code
COPY . .

# Expose port
EXPOSE 3000

# Default command (can be overridden in docker-compose)
CMD ["npm", "run", "dev"]
