FROM node:24-bookworm
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . ./
RUN npm run build
EXPOSE 3000
CMD ["npm", "start"]
