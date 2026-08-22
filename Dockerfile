FROM node:18-slim

WORKDIR /app

COPY . .

CMD ["npm", "test"]