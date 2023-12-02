# Используйте образ Node.js как базовый
FROM node:12

# Установите файлы вашего Action
COPY . /

# Установите зависимости Node.js
RUN npm install

# Запустите файл action.js при запуске контейнера
ENTRYPOINT ["node", "/action.js"]
