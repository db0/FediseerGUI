# Stage 1: Build the application
FROM node:14 as builder

# Set the working directory
WORKDIR /app

# Copy package.json and yarn.lock to the container
COPY package.json yarn.lock ./

# Install dependencies
RUN yarn install

# Copy the rest of the application source code
COPY . .

# Build the application
RUN yarn build

# Stage 2: Create the production image
FROM nginx:alpine

# Copy the built app from the builder stage to the Nginx server's root directory
COPY --from=builder /app/dist/fediseer-gui /usr/share/nginx/html

# Expose port 10101
EXPOSE 10101

# Configure Nginx to listen on port 10101
RUN sed -i 's/listen       80;/listen       10101;/g' /etc/nginx/conf.d/default.conf

# Start Nginx when the container starts
CMD ["nginx", "-g", "daemon off;"]