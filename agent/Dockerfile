FROM swr.cn-north-4.myhuaweicloud.com/ddn-k8s/docker.io/node:20-slim

# Install Python
RUN apt-get update && apt-get install -y python3 python3-pip && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json ./
RUN npm install -g cnpm --registry=https://registry.npmmirror.com && cnpm install

COPY . .
RUN npm run build

CMD ["npm", "start"]
