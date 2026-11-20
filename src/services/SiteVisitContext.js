// Store only public navigation context. Never retain arbitrary URLs, query
// strings, account IDs, reset tokens, VIN form values or document titles.
export function trafficArticle(value) {
  if (typeof value !== 'string' || value.length > 64 || !/[0-9]/.test(value) || !/^[a-zA-ZаАвВеЕкКмМнНоОрРсСтТхХ0-9 ._\/-]+$/.test(value)) return null;
  const map = {А:'A',В:'B',Е:'E',К:'K',М:'M',Н:'H',О:'O',Р:'P',С:'C',Т:'T',Х:'X'};
  const normalized = value.toUpperCase().split('').map(c=>map[c]||c).join('').replace(/[^A-Z0-9]/g,'');
  return normalized.length >= 3 && normalized.length <= 64 ? normalized : null;
}

export function trafficPagePath(value, route, locale) {
  if (typeof value !== 'string' || value.length > 300 || /[?#\\\x00-\x20]/.test(value)) return null;
  let parts;
  try { parts = value.split('/').filter(Boolean).map(decodeURIComponent); } catch { return null; }
  if (!value.startsWith('/') || value.startsWith('//') || parts[0] !== locale || parts.some(p=>p==='.'||p==='..')) return null;
  const base = `/${locale}`, family = parts[1] || 'home';
  if (route === 'search' && (family === 'home' || family === 'search')) return family === 'home' ? base : `${base}/search`;
  if (family !== route) return null;
  if (route === 'home') return parts.length === 1 ? base : null;
  if (route === 'product') {
    const article = parts.length === 3 ? trafficArticle(parts[2]) : null;
    return article ? `${base}/product/${article}` : null;
  }
  if (route === 'catalog' || route === 'brand') {
    if (parts.length > 3 || (parts[2] && !/^[a-z0-9][a-z0-9-]{0,119}$/.test(parts[2]))) return null;
    return `${base}/${route}${parts[2] ? `/${parts[2]}` : ''}`;
  }
  if (route === 'account') {
    const section = ['orders','profile','vin-requests','telegram','recently-viewed'].includes(parts[2]) ? `/${parts[2]}` : '';
    return `${base}/account${section}`;
  }
  return `${base}/${route}`;
}

export function trafficDevice(userAgent, hint) {
  if (['phone','tablet','desktop'].includes(hint)) return hint;
  const ua = typeof userAgent === 'string' ? userAgent.slice(0,1000) : '';
  if (/iPad|Tablet|Android(?!.*Mobile)/i.test(ua)) return 'tablet';
  if (/iPhone|iPod|Android.*Mobile|Windows Phone|Mobile/i.test(ua)) return 'phone';
  return ua ? 'desktop' : 'unknown';
}

export function journalPage(value, maximum = 10000) {
  if (value === undefined || value === '') return 1;
  if (!/^\d+$/.test(String(value)) || Number(value) < 1 || Number(value) > maximum) {
    throw Object.assign(new Error('Некоректний номер сторінки'), {statusCode:400});
  }
  return Number(value);
}
