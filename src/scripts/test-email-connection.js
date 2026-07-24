import "dotenv/config";
import { ImapFlow } from "imapflow";


const gmailUser =
  process.env.GMAIL_USER;

const gmailAppPassword =
  process.env.GMAIL_APP_PASSWORD;


if (!gmailUser) {
  throw new Error(
    "В .env отсутствует GMAIL_USER"
  );
}


if (!gmailAppPassword) {
  throw new Error(
    "В .env отсутствует GMAIL_APP_PASSWORD"
  );
}


const client =
  new ImapFlow({
    host: "imap.gmail.com",
    port: 993,
    secure: true,

    auth: {
      user: gmailUser,
      pass: gmailAppPassword,
    },

    logger: false,
  });


let connected = false;


try {

  console.log(
    "Подключаемся к Gmail..."
  );


  await client.connect();

  connected = true;


  const lock =
    await client.getMailboxLock(
      "INBOX"
    );


  try {

    console.log(
      "✅ Подключение к Gmail успешно"
    );

    console.log(
      `Писем во входящих: ${client.mailbox.exists}`
    );

  } finally {

    lock.release();

  }


} catch(error) {

  console.error(
    "❌ Ошибка подключения к Gmail:"
  );

  console.error(
    error.message
  );

  process.exitCode = 1;


} finally {

  if (connected) {
    await client
      .logout()
      .catch(() => {});
  }

}
