# chromium now comes from the shared base image (sprint-19); no per-build
# apt install so --no-cache rebuilds of bot/api stay fast.
FROM music-league-bot-base:chromium

ENV CHROMIUM_PATH=/usr/bin/chromium

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

CMD ["sh", "-c", "rm -f .wwebjs_auth/session/Singleton* && npm run dev"]
