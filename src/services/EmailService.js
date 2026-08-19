const RESEND_ENDPOINT = "https://api.resend.com/emails";
const DEFAULT_FROM = "MAKA.com.ua <no-reply@maka.com.ua>";

function normalizeLocale(value) {
  return ["uk", "en", "ru"].includes(value) ? value : "uk";
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function greeting(firstName, locale) {
  const safeName = String(firstName || "").trim();
  if (locale === "en") return safeName ? `Hello, ${safeName}!` : "Hello!";
  if (locale === "ru") return safeName ? `${safeName}, здравствуйте!` : "Здравствуйте!";
  return safeName ? `${safeName}, вітаємо!` : "Вітаємо!";
}

async function send({ to, subject, text, html }) {
  const apiKey = String(process.env.RESEND_API_KEY || "").trim();
  const from = String(process.env.EMAIL_FROM || DEFAULT_FROM).trim();

  if (process.env.EMAIL_DELIVERY_DISABLED === "true") {
    return { sent: false, skipped: true };
  }

  if (!apiKey) {
    const error = new Error("RESEND_API_KEY не налаштований");
    error.code = "EMAIL_NOT_CONFIGURED";
    throw error;
  }

  const response = await fetch(RESEND_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from, to: [to], subject, text, html }),
  });

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    const error = new Error(data?.message || `Resend HTTP ${response.status}`);
    error.code = "EMAIL_DELIVERY_FAILED";
    throw error;
  }

  return { sent: true, id: data?.id || null };
}

export const EmailService = {
  isConfigured() {
    return Boolean(String(process.env.RESEND_API_KEY || "").trim());
  },

  async sendPasswordResetLink({ to, firstName, locale, resetUrl }) {
    const language = normalizeLocale(locale);
    const content = {
      uk: {
        subject: "Відновлення пароля MAKA.com.ua",
        intro: "Ми отримали запит на відновлення доступу до вашого акаунта.",
        action: "Створити новий пароль",
        expiry: "Посилання дійсне 30 хвилин і може бути використане лише один раз.",
        ignore: "Якщо ви не робили цей запит, просто проігноруйте лист.",
      },
      en: {
        subject: "Reset your MAKA.com.ua password",
        intro: "We received a request to restore access to your account.",
        action: "Create a new password",
        expiry: "This link is valid for 30 minutes and can only be used once.",
        ignore: "If you did not request this, you can ignore this email.",
      },
      ru: {
        subject: "Восстановление пароля MAKA.com.ua",
        intro: "Мы получили запрос на восстановление доступа к вашему аккаунту.",
        action: "Создать новый пароль",
        expiry: "Ссылка действует 30 минут и может быть использована только один раз.",
        ignore: "Если вы не отправляли запрос, просто проигнорируйте письмо.",
      },
    }[language];
    const hello = greeting(firstName, language);
    const safeUrl = escapeHtml(resetUrl);

    return send({
      to,
      subject: content.subject,
      text: `${hello}\n\n${content.intro}\n${content.action}: ${resetUrl}\n\n${content.expiry}\n${content.ignore}`,
      html: `<div style="font-family:Arial,sans-serif;line-height:1.6;color:#172033"><h2>${escapeHtml(hello)}</h2><p>${escapeHtml(content.intro)}</p><p><a href="${safeUrl}" style="display:inline-block;padding:12px 18px;border-radius:9px;background:#b77a3d;color:#fff;text-decoration:none;font-weight:700">${escapeHtml(content.action)}</a></p><p>${escapeHtml(content.expiry)}</p><p style="color:#667085">${escapeHtml(content.ignore)}</p></div>`,
    });
  },

  async sendTemporaryPassword({ to, firstName, locale, temporaryPassword }) {
    const language = normalizeLocale(locale);
    const content = {
      uk: {
        subject: "Тимчасовий пароль MAKA.com.ua",
        intro: "Для вашого акаунта створено тимчасовий пароль:",
        next: "Після входу сайт обов’язково попросить створити власний новий пароль.",
        warning: "Якщо ви не очікували цього листа, зверніться до адміністрації MAKA.com.ua.",
      },
      en: {
        subject: "Temporary MAKA.com.ua password",
        intro: "A temporary password was created for your account:",
        next: "After signing in, the website will require you to create your own new password.",
        warning: "If you did not expect this email, contact MAKA.com.ua support.",
      },
      ru: {
        subject: "Временный пароль MAKA.com.ua",
        intro: "Для вашего аккаунта создан временный пароль:",
        next: "После входа сайт обязательно попросит создать собственный новый пароль.",
        warning: "Если вы не ожидали это письмо, обратитесь к администрации MAKA.com.ua.",
      },
    }[language];
    const hello = greeting(firstName, language);

    return send({
      to,
      subject: content.subject,
      text: `${hello}\n\n${content.intro}\n${temporaryPassword}\n\n${content.next}\n${content.warning}`,
      html: `<div style="font-family:Arial,sans-serif;line-height:1.6;color:#172033"><h2>${escapeHtml(hello)}</h2><p>${escapeHtml(content.intro)}</p><p style="display:inline-block;padding:12px 18px;border:1px solid #d5a05d;border-radius:9px;background:#07131d;color:#f4b45e;font-size:20px;font-weight:800;letter-spacing:1px">${escapeHtml(temporaryPassword)}</p><p>${escapeHtml(content.next)}</p><p style="color:#667085">${escapeHtml(content.warning)}</p></div>`,
    });
  },
};
