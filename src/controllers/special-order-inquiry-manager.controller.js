import {
  SpecialOrderInquiryManagerRepository,
} from "../repositories/SpecialOrderInquiryManagerRepository.js";

function failure(res, error) {
  const status = error?.statusCode === 400 ? 400 : 500;

  if (status === 500) {
    console.error("Special-order manager API failure");
  }

  return res.status(status).json({
    success: false,
    code: status === 400
      ? error.code
      : "SPECIAL_ORDER_MANAGER_ERROR",
    error: status === 400
      ? error.message
      : "Не вдалося обробити запит",
  });
}

export function makeSpecialOrderManagerHandlers(
  repository = SpecialOrderInquiryManagerRepository
) {
  return {
    async list(req, res) {
      res.set("Cache-Control", "private, no-store");

      try {
        const result = await repository.list({
          status: req.query.status || null,
          page: req.query.page,
          limit: req.query.limit,
        });

        return res.json({ success: true, ...result });
      } catch (error) {
        return failure(res, error);
      }
    },

    async update(req, res) {
      res.set("Cache-Control", "private, no-store");

      try {
        const inquiry = await repository.updateStatus({
          id: req.params.id,
          status: req.body?.status,
        });

        if (!inquiry) {
          return res.status(404).json({
            success: false,
            code: "INQUIRY_NOT_FOUND",
            error: "Заявку не знайдено",
          });
        }

        return res.json({ success: true, inquiry });
      } catch (error) {
        return failure(res, error);
      }
    },
  };
}

export const specialOrderManagerHandlers =
  makeSpecialOrderManagerHandlers();
