// Почтовый транспорт для заказов. Пароль SMTP — только из переменных окружения, в код и репозиторий не попадает.
// ORDER_MAIL_OUTBOX=папка — вместо отправки письма сохраняются туда файлами .eml (проверка без почтового сервера).
const fs = require("node:fs/promises");
const path = require("node:path");
const nodemailer = require("nodemailer");

// Короткие таймауты: если почтовый сервер не отвечает, клиент не ждёт минутами, а заказ остаётся в базе с пометкой «не ушло».
const TIMEOUTS = { connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 20000 };

function createTransport(mail) {
  if (mail.smtpUrl) return nodemailer.createTransport({ url: mail.smtpUrl, ...TIMEOUTS });
  if (mail.host) {
    return nodemailer.createTransport({
      host: mail.host,
      port: mail.port,
      secure: mail.secure,
      auth: mail.user ? { user: mail.user, pass: mail.pass } : undefined,
      ...TIMEOUTS
    });
  }
  if (mail.outboxDir) {
    const stream = nodemailer.createTransport({ streamTransport: true, buffer: true });
    return {
      async sendMail(message) {
        const info = await stream.sendMail(message);
        await fs.mkdir(mail.outboxDir, { recursive: true });
        const name = `${new Date().toISOString().replace(/[:.]/g, "-")}-${info.messageId.replace(/[^\w.-]/g, "")}.eml`;
        await fs.writeFile(path.join(mail.outboxDir, name), info.message);
        return info;
      }
    };
  }
  return null;
}

module.exports = { createTransport };
