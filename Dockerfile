FROM node:18-bullseye-slim

# Instala o navegador Chromium e dependências para rodar o robô
RUN apt-get update && apt-get install -y \
    chromium \
    fonts-ipafont-gothic \
    fonts-wqy-zenhei \
    fonts-thai-tlwg \
    fonts-kacst \
    fonts-freefont-ttf \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# Configura o Puppeteer para usar o navegador instalado
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

WORKDIR /usr/src/app

# Instala as dependências
COPY package*.json ./
RUN npm ci

# Copia todo o código do robô
COPY . .

# Comando final
CMD [ "node", "index.js" ]
