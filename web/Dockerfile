FROM swr.cn-north-4.myhuaweicloud.com/ddn-k8s/docker.io/node:20-slim

WORKDIR /app

COPY package.json ./

# 安装依赖
RUN npm install -g cnpm --registry=https://registry.npmmirror.com && cnpm install

COPY . .

EXPOSE 5173

# 开发模式启动
CMD ["npm", "run", "dev", "--", "--host"]
