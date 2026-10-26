# 真实 aria2 验收的运行镜像：Node 24 + Chromium 系统依赖。
# 依赖在构建镜像时安装；自定义 Docker 网络中 apt 可能因只返回 IPv6 地址而挂起，不要在验收容器里再装。
FROM node:24
RUN npx -y playwright@1.62.1 install-deps chromium && rm -rf /var/lib/apt/lists/* /root/.npm
