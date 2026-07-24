import "dotenv/config";
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";


const gmailUser =
  process.env.GMAIL_USER;

const gmailAppPassword =
  process.env.GMAIL_APP_PASSWORD;


if (!gmailUser || !gmailAppPassword) {
  throw new Error(
    "В .env отсутствуют данные Gmail"
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
    "Ищем письмо «Прайс Автолайф»..."
  );


  await client.connect();

  connected = true;


  const lock =
    await client.getMailboxLock(
      "INBOX",
      {
        readOnly: true,
      }
    );


  try {

    const uids =
      await client.search(
        {
          subject:
            "Прайс Автолайф",
        },
        {
          uid: true,
        }
      );


    if (
      !uids ||
      uids.length === 0
    ) {
      throw new Error(
        "Письмо с темой «Прайс Автолайф» не найдено"
      );
    }


    const latestUid =
      Math.max(...uids);


    const message =
      await client.fetchOne(
        latestUid,
        {
          uid: true,
          envelope: true,
          source: true,
        },
        {
          uid: true,
        }
      );


    if (
      !message ||
      !message.source
    ) {
      throw new Error(
        "Не удалось получить содержимое письма"
      );
    }


    const mail =
      await simpleParser(
        message.source
      );


    const sender =
      mail.from?.value
        ?.map((item) => {
          if (item.name) {
            return `${item.name} <${item.address}>`;
          }

          return item.address;
        })
        .join(", ") ||
      "не указан";


    const attachments =
      mail.attachments || [];


    const priceFiles =
      attachments.filter(
        (attachment) =>
          /\.(csv|xlsx)$/i.test(
            attachment.filename || ""
          )
      );


    console.log("");
    console.log("✅ Письмо найдено");
    console.log(`Отправитель: ${sender}`);
    console.log(`Тема: ${mail.subject}`);
    console.log(
      `Всего вложений: ${attachments.length}`
    );


    if (priceFiles.length === 0) {
      console.log(
        "❌ Вложение CSV или XLSX не найдено"
      );
    } else {

      console.log(
        `✅ Найдено файлов прайса: ${priceFiles.length}`
      );


      for (
        const attachment
        of priceFiles
      ) {
        console.log(
          `- ${attachment.filename} (${attachment.size} байт)`
        );
      }

    }

  } finally {

    lock.release();

  }


} catch(error) {

  console.error("");
  console.error(
    `❌ Ошибка: ${error.message}`
  );

  process.exitCode = 1;


} finally {

  if (connected) {
    await client
      .logout()
      .catch(() => {});
  }

}
