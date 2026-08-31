import multer from "multer";


const storage = multer.memoryStorage();

export function normalizeUploadedFileName(fileName) {
  const value = String(fileName || "").trim();

  if (!value || !/[ÃÂÐÑ]/.test(value)) {
    return value;
  }

  const decoded = Buffer
    .from(value, "latin1")
    .toString("utf8");

  if (
    decoded.includes("\uFFFD") ||
    !/[А-Яа-яІіЇїЄєҐґ]/.test(decoded)
  ) {
    return value;
  }

  return decoded;
}


export const upload = multer({
  storage,
  fileFilter: (req, file, callback) => {
    file.originalname = normalizeUploadedFileName(
      file.originalname
    );

    callback(null, true);
  },
  limits: {
    fileSize: 10 * 1024 * 1024
  }
});
