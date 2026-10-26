// Private supplier's real UNIT purchase cost. Never use for selling prices.
// A separate parser preserves up to six decimal places, unlike the 2-decimal
// public price parser (ImportNumericService).
export function parsePrivateUnitCost(value,{article="",rowNumber=0}={}) {
  const raw=String(value??"").trim().replace(/\s/g,"");
  if(!/^\d+(?:[,.]\d{1,6})?$/.test(raw)) {
    throw new Error("Строка "+rowNumber+": некорректная или отсутствует реальная входящая цена F для артикула "+article);
  }
  const normalized=raw.replace(",",".");
  const n=Number(normalized);
  if(!Number.isFinite(n)||n<=0||n>=100000000) {
    throw new Error("Строка "+rowNumber+": реальная входящая цена вне допустимого диапазона для "+article);
  }
  // Return decimal text, not Number, for exact Postgres NUMERIC(16,6).
  return normalized;
}
export function assertPrivateCostColumn(rows,settings) {
  const col=Number(settings?.internal_purchase_price_column||0);
  if(!col)return;
  if(!Number.isSafeInteger(col)||col<1||col>100)throw new Error("Некорректная колонка реальной входящей цены");
  const start=Number(settings.start_row)||2;
  for(let i=0;i<(rows||[]).length;i++){
    const row=rows[i];
    const article=String(row[Number(settings.article_column)-1]??"").trim();
    parsePrivateUnitCost(row[col-1],{article,rowNumber:start+i});
  }
}
export function parseRowPrivateCost(row,settings,rowNumber,article) {
  const col=Number(settings?.internal_purchase_price_column||0);
  if(!col)return null;
  return parsePrivateUnitCost(row[col-1],{article,rowNumber});
}
